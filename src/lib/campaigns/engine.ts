import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { getLiveReadiness } from "@/lib/compliance/readiness";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { getVoiceProvider, getWhatsAppProvider } from "@/lib/providers/registry";
import type { WhatsAppTemplate } from "@/lib/providers/types";
import { countPlaceholders } from "@/lib/providers/whatsapp/mock";
import type { Campaign, MediaAsset } from "@/lib/types";
import {
  buildSuppressionIndex,
  checkEligibility,
  computeStats,
  displayName,
  parseSegment,
  parseTemplateVariables,
  resolveTemplateParams,
  type CampaignStats,
  type RecipientStatus,
  type Segment,
  type SegmentContact,
  type SuppressionLike,
} from "./logic";

/** Upper bound per run so a simulation finishes inside a serverless request. */
export const MAX_RECIPIENTS_PER_RUN = 5000;
const SEND_CONCURRENCY = 20;
const CHUNK = 500;

export class CampaignRunError extends Error {}

const CONTACT_COLUMNS = "id, phone_e164, first_name, last_name, email, tags, voice_consent, whatsapp_opt_in";

export async function loadAudience(supabase: SupabaseClient, ownerId: string, segment: Segment): Promise<SegmentContact[]> {
  const out: SegmentContact[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let query = supabase.from("contacts").select(CONTACT_COLUMNS).eq("owner_id", ownerId).order("created_at").range(from, from + page - 1);
    if (segment.tags.length) {
      query = segment.match === "all" ? query.contains("tags", segment.tags) : query.overlaps("tags", segment.tags);
    }
    const { data, error } = await query;
    if (error) throw new CampaignRunError(`Could not load contacts: ${error.message}`);
    out.push(...((data ?? []) as SegmentContact[]));
    if (!data || data.length < page) break;
    if (out.length > MAX_RECIPIENTS_PER_RUN) break;
  }
  return out;
}

async function loadSuppression(supabase: SupabaseClient, ownerId: string): Promise<SuppressionLike[]> {
  const { data, error } = await supabase.from("suppression_records").select("phone_e164, channel, expires_at").eq("owner_id", ownerId);
  if (error) throw new CampaignRunError(`Could not load suppression list: ${error.message}`);
  return (data ?? []) as SuppressionLike[];
}

export interface AudienceEstimate {
  total: number;
  eligible: number;
  suppressed: number;
  noConsent: number;
  overLimit: boolean;
}

export async function estimateAudience(
  supabase: SupabaseClient,
  ownerId: string,
  channel: Campaign["channel"],
  segmentValue: unknown,
): Promise<AudienceEstimate> {
  const [audience, suppression] = await Promise.all([
    loadAudience(supabase, ownerId, parseSegment(segmentValue)),
    loadSuppression(supabase, ownerId),
  ]);
  const index = buildSuppressionIndex(suppression, channel);
  const estimate: AudienceEstimate = { total: audience.length, eligible: 0, suppressed: 0, noConsent: 0, overLimit: audience.length > MAX_RECIPIENTS_PER_RUN };
  for (const contact of audience) {
    const e = checkEligibility(contact, channel, index);
    if (e.eligible) estimate.eligible++;
    else if (e.status === "skipped_suppressed") estimate.suppressed++;
    else estimate.noConsent++;
  }
  return estimate;
}

export interface Preflight {
  problems: string[];
  media: MediaAsset | null;
  template: WhatsAppTemplate | null;
}

/** Everything that must be true before a campaign may be scheduled or run. */
export async function preflight(supabase: SupabaseClient, campaign: Campaign): Promise<Preflight> {
  const problems: string[] = [];
  let media: MediaAsset | null = null;
  let template: WhatsAppTemplate | null = null;

  const readiness = campaign.mode === "live" ? await getLiveReadiness(supabase, campaign.owner_id, campaign.channel) : undefined;
  if (readiness) {
    if (!readiness.ready) problems.push("Live mode is not permitted: complete the live-readiness checklist or switch to simulation.");
  }

  if (campaign.media_asset_id) {
    const { data } = await supabase.from("media_assets").select("*").eq("id", campaign.media_asset_id).maybeSingle();
    media = (data as MediaAsset | null) ?? null;
    if (!media) problems.push("The selected media file no longer exists.");
  }

  if (campaign.channel === "voice") {
    if (!media) problems.push("Choose an audio file for the call.");
    else if (media.kind !== "audio") problems.push("Voice campaigns need an audio file.");
  } else {
    if (!campaign.whatsapp_template_name) {
      problems.push("Choose an approved WhatsApp template.");
    } else {
      try {
        // Templates come from the account of the provider that will send.
        const provider = getWhatsAppProvider(campaign.mode, campaign.provider, readiness);
        const templates = await provider.listTemplates();
        template =
          templates.find((t) => t.name === campaign.whatsapp_template_name && t.language === campaign.whatsapp_template_language) ?? null;
      } catch {
        template = null;
      }
      if (!template) problems.push("The selected template is not available from the provider.");
      else {
        if (template.status !== "APPROVED") problems.push(`Template "${template.name}" is ${template.status.toLowerCase()}, not approved.`);
        const needed = countPlaceholders(template.body);
        const vars = parseTemplateVariables(campaign.template_variables);
        if (vars.length !== needed) problems.push(`Template needs ${needed} variable(s); ${vars.length} configured.`);
        if (template.headerType === "IMAGE" && media?.kind !== "image") problems.push("This template needs an image header.");
        if (template.headerType === "VIDEO" && media?.kind !== "video") problems.push("This template needs a video header.");
      }
    }
  }
  return { problems, media, template };
}

export interface RunOptions {
  actorId: string | null;
  trigger: "manual" | "schedule";
}

export async function runCampaign(supabase: SupabaseClient, campaignId: string, options: RunOptions): Promise<CampaignStats> {
  const { data: row, error } = await supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error || !row) throw new CampaignRunError("Campaign not found");
  const campaign = row as Campaign;
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new CampaignRunError(`Campaign is ${campaign.status}; only draft or scheduled campaigns can run.`);
  }

  const check = await preflight(supabase, campaign);
  if (check.problems.length) throw new CampaignRunError(check.problems.join(" "));

  // Resolve the provider before touching anything. Live mode throws here
  // unless the env flag, a live adapter and verified compliance all line up.
  const readiness = campaign.mode === "live" ? await getLiveReadiness(supabase, campaign.owner_id, campaign.channel) : undefined;
  const voice = campaign.channel === "voice" ? getVoiceProvider(campaign.mode, campaign.provider, readiness) : null;
  const whatsapp = campaign.channel === "whatsapp" ? getWhatsAppProvider(campaign.mode, campaign.provider, readiness) : null;
  const providerId = (voice ?? whatsapp)!.id;

  // Claim it atomically so two clicks (or cron + click) can't double-send.
  const startedAt = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("campaigns")
    .update({ status: "running", started_at: startedAt })
    .eq("id", campaign.id)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (!claimed?.length) throw new CampaignRunError("Campaign is already running or finished.");

  try {
    const [audience, suppression] = await Promise.all([
      loadAudience(supabase, campaign.owner_id, parseSegment(campaign.segment)),
      loadSuppression(supabase, campaign.owner_id),
    ]);
    if (audience.length === 0) throw new CampaignRunError("No contacts match this campaign's segment.");
    if (audience.length > MAX_RECIPIENTS_PER_RUN) {
      throw new CampaignRunError(`Segment has more than ${MAX_RECIPIENTS_PER_RUN} contacts; narrow it with tags.`);
    }
    const suppressed = buildSuppressionIndex(suppression, campaign.channel);

    let mediaUrl: string | null = null;
    if (check.media) {
      const { data: signed, error: signError } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(check.media.storage_path, 3600);
      if (signError || !signed) throw new CampaignRunError("The media file is missing from storage.");
      mediaUrl = signed.signedUrl;
    }

    // 1. Snapshot the audience as recipients (skips recorded with a reason).
    const contactsById = new Map(audience.map((c) => [c.id, c]));
    const recipientRows = audience.map((contact) => {
      const eligibility = checkEligibility(contact, campaign.channel, suppressed);
      return {
        owner_id: campaign.owner_id,
        campaign_id: campaign.id,
        contact_id: contact.id,
        phone_e164: contact.phone_e164,
        display_name: displayName(contact),
        status: (eligibility.eligible ? "pending" : eligibility.status) as RecipientStatus,
        status_reason: eligibility.eligible ? null : eligibility.reason,
      };
    });
    type Inserted = { id: string; contact_id: string; phone_e164: string; display_name: string | null; status: RecipientStatus; status_reason: string | null };
    const inserted: Inserted[] = [];
    for (let i = 0; i < recipientRows.length; i += CHUNK) {
      const { data, error: insertError } = await supabase
        .from("campaign_recipients")
        .insert(recipientRows.slice(i, i + CHUNK))
        .select("id, contact_id, phone_e164, display_name, status, status_reason");
      if (insertError) throw new CampaignRunError(`Could not save recipients: ${insertError.message}`);
      inserted.push(...((data ?? []) as Inserted[]));
    }

    // 2. Deliver to eligible recipients through the provider adapter.
    const variables = parseTemplateVariables(campaign.template_variables);
    const headerType = check.template?.headerType;
    const attempts: Record<string, unknown>[] = [];
    const updates: (Inserted & { attempt_count: number; last_attempt_at: string })[] = [];
    const pending = inserted.filter((r) => r.status === "pending");

    for (let i = 0; i < pending.length; i += SEND_CONCURRENCY) {
      await Promise.all(
        pending.slice(i, i + SEND_CONCURRENCY).map(async (recipient) => {
          const contact = contactsById.get(recipient.contact_id)!;
          const base = {
            owner_id: campaign.owner_id,
            campaign_id: campaign.id,
            recipient_id: recipient.id,
            channel: campaign.channel,
            provider: providerId,
            mode: campaign.mode,
            attempt_number: 1,
          };
          let status: RecipientStatus;
          let reason: string | null = null;
          try {
            if (voice) {
              const result = await voice.placeCall({
                to: recipient.phone_e164,
                from: campaign.caller_id,
                audioUrl: mediaUrl,
                audioDurationSeconds: check.media?.duration_seconds ?? null,
                campaignId: campaign.id,
                recipientId: recipient.id,
              });
              status = result.status;
              reason = result.errorMessage ?? null;
              attempts.push({
                ...base,
                status,
                provider_message_id: result.providerCallId,
                error_code: result.errorCode ?? null,
                error_message: result.errorMessage ?? null,
                duration_seconds: result.durationSeconds,
                request_payload: { to: recipient.phone_e164, from: campaign.caller_id, media_asset_id: check.media?.id ?? null },
                response_payload: result.raw,
              });
            } else {
              const params = resolveTemplateParams(variables, contact);
              const result = await whatsapp!.sendTemplate({
                to: recipient.phone_e164,
                template: { name: campaign.whatsapp_template_name!, language: campaign.whatsapp_template_language ?? "en" },
                bodyParams: params,
                headerMedia:
                  mediaUrl && (headerType === "IMAGE" || headerType === "VIDEO")
                    ? { type: headerType === "IMAGE" ? "image" : "video", url: mediaUrl }
                    : null,
                campaignId: campaign.id,
                recipientId: recipient.id,
              });
              status = result.status;
              reason = result.errorMessage ?? null;
              attempts.push({
                ...base,
                status,
                provider_message_id: result.providerMessageId,
                error_code: result.errorCode ?? null,
                error_message: result.errorMessage ?? null,
                request_payload: { to: recipient.phone_e164, template: campaign.whatsapp_template_name, params },
                response_payload: { ...result.raw, events: result.events },
              });
            }
          } catch (sendError) {
            status = "failed";
            reason = sendError instanceof Error ? sendError.message : "Provider error";
            attempts.push({ ...base, status, error_code: "ADAPTER_ERROR", error_message: reason });
          }
          updates.push({ ...recipient, status, status_reason: reason, attempt_count: 1, last_attempt_at: new Date().toISOString() });
        }),
      );
    }

    for (let i = 0; i < attempts.length; i += CHUNK) {
      const { error: attemptError } = await supabase.from("delivery_attempts").insert(attempts.slice(i, i + CHUNK));
      if (attemptError) throw new CampaignRunError(`Could not record delivery attempts: ${attemptError.message}`);
    }
    for (let i = 0; i < updates.length; i += CHUNK) {
      const { error: updateError } = await supabase.from("campaign_recipients").upsert(
        updates.slice(i, i + CHUNK).map((u) => ({
          id: u.id,
          owner_id: campaign.owner_id,
          campaign_id: campaign.id,
          contact_id: u.contact_id,
          phone_e164: u.phone_e164,
          display_name: u.display_name,
          status: u.status,
          status_reason: u.status_reason,
          attempt_count: u.attempt_count,
          last_attempt_at: u.last_attempt_at,
        })),
        { onConflict: "id" },
      );
      if (updateError) throw new CampaignRunError(`Could not update recipients: ${updateError.message}`);
    }

    // 3. Summarise.
    const finalStatuses = new Map(inserted.map((r) => [r.id, r.status]));
    for (const u of updates) finalStatuses.set(u.id, u.status);
    const stats = computeStats([...finalStatuses.values()]);
    await supabase
      .from("campaigns")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        stats: { ...stats, provider: providerId, mode: campaign.mode, trigger: options.trigger },
      })
      .eq("id", campaign.id);

    await writeAudit(supabase, {
      ownerId: campaign.owner_id,
      actorId: options.actorId,
      action: campaign.mode === "live" ? "campaign.run_live" : "campaign.run_simulation",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { channel: campaign.channel, trigger: options.trigger, provider: providerId, ...stats },
    });
    return stats;
  } catch (runError) {
    const message = runError instanceof Error ? runError.message : "Unknown error";
    await supabase
      .from("campaigns")
      .update({ status: "failed", completed_at: new Date().toISOString(), stats: { error: message } })
      .eq("id", campaign.id);
    await writeAudit(supabase, {
      ownerId: campaign.owner_id,
      actorId: options.actorId,
      action: "campaign.run_failed",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { error: message, trigger: options.trigger },
    });
    throw runError instanceof CampaignRunError ? runError : new CampaignRunError(message);
  }
}

/** Run scheduled campaigns whose time has come (optionally for one owner). */
export async function dispatchDueCampaigns(supabase: SupabaseClient, ownerId: string | null, actorId: string | null, limit = 5) {
  let query = supabase
    .from("campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(limit);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data } = await query;
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const { id } of data ?? []) {
    try {
      await runCampaign(supabase, id, { actorId, trigger: "schedule" });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
