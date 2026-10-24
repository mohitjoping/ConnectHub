"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { CampaignRunError, dispatchDueCampaigns, estimateAudience, preflight, runCampaign, type AudienceEstimate } from "@/lib/campaigns/engine";
import { TEMPLATE_FIELDS } from "@/lib/campaigns/logic";
import { configuredProvider, getLiveReadiness } from "@/lib/compliance/readiness";
import { defaultPhoneCountry } from "@/lib/env";
import { normalizePhone } from "@/lib/import/validate";
import type { ActionResult, Campaign } from "@/lib/types";
import { dbError, withSession, zodMessage } from "./helpers";

const channelPath = (channel: string) => (channel === "voice" ? "/calls" : "/whatsapp");

function revalidateCampaign(campaign: Pick<Campaign, "id" | "channel">) {
  revalidatePath(channelPath(campaign.channel));
  revalidatePath(`${channelPath(campaign.channel)}/${campaign.id}`);
  revalidatePath("/history");
  revalidatePath("/dashboard");
}

const templateVariable = z.discriminatedUnion("source", [
  z.object({ source: z.literal("field"), field: z.enum(TEMPLATE_FIELDS), fallback: z.string().max(200) }),
  z.object({ source: z.literal("static"), value: z.string().min(1, "Static values can't be empty").max(1000) }),
]);

const campaignInput = z.object({
  id: z.uuid().optional(),
  channel: z.enum(["voice", "whatsapp"]),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(1000).optional().default(""),
  segment: z.object({
    tags: z.array(z.string().max(40)).max(20),
    match: z.enum(["any", "all"]),
  }),
  mode: z.enum(["simulation", "live"]),
  mediaAssetId: z.uuid().nullable(),
  callerId: z.string().trim().max(32).optional().default(""),
  templateName: z.string().max(200).nullable(),
  templateLanguage: z.string().max(20).nullable(),
  templateVariables: z.array(templateVariable).max(20),
});

export async function saveCampaign(input: z.input<typeof campaignInput>): Promise<ActionResult<{ id: string }>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = campaignInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;

    if (v.mode === "live") {
      const readiness = await getLiveReadiness(supabase, userId, v.channel);
      if (!readiness.ready) {
        const missing = readiness.checks.filter((c) => !c.ok).map((c) => c.label);
        return { ok: false, error: `Live mode is locked. Missing: ${missing.join(", ")}.` };
      }
    }

    let callerId: string | null = null;
    if (v.channel === "voice" && v.callerId) {
      const parsedCaller = normalizePhone(v.callerId, defaultPhoneCountry);
      if (!parsedCaller.ok) return { ok: false, error: `Caller ID: ${parsedCaller.reason}` };
      callerId = parsedCaller.e164;
    }

    const row = {
      owner_id: userId,
      channel: v.channel,
      name: v.name,
      description: v.description || null,
      segment: v.segment,
      mode: v.mode,
      provider: v.mode === "live" ? configuredProvider(v.channel) : "mock",
      media_asset_id: v.mediaAssetId,
      caller_id: callerId,
      whatsapp_template_name: v.channel === "whatsapp" ? v.templateName : null,
      whatsapp_template_language: v.channel === "whatsapp" ? v.templateLanguage : null,
      template_variables: v.channel === "whatsapp" ? v.templateVariables : [],
    };

    if (v.id) {
      const { data: current } = await supabase.from("campaigns").select("status").eq("id", v.id).maybeSingle();
      if (!current) return { ok: false, error: "Campaign not found" };
      if (current.status !== "draft") return { ok: false, error: "Only draft campaigns can be edited. Unschedule it first." };
      const { error } = await supabase.from("campaigns").update(row).eq("id", v.id);
      if (error) return dbError(error);
      await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.updated", entityType: "campaign", entityId: v.id, metadata: { mode: v.mode } });
      revalidateCampaign({ id: v.id, channel: v.channel });
      return { ok: true, data: { id: v.id }, message: "Draft saved" };
    }

    const { data, error } = await supabase.from("campaigns").insert(row).select("id").single();
    if (error) return dbError(error);
    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: "campaign.created",
      entityType: "campaign",
      entityId: data.id,
      metadata: { channel: v.channel, mode: v.mode },
    });
    revalidateCampaign({ id: data.id, channel: v.channel });
    return { ok: true, data: { id: data.id }, message: "Draft created" };
  });
}

async function loadCampaign(supabase: Parameters<Parameters<typeof withSession>[0]>[0]["supabase"], id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { data } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  return (data as Campaign | null) ?? null;
}

export async function scheduleCampaign(id: string, scheduledAtIso: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const campaign = await loadCampaign(supabase, id);
    if (!campaign) return { ok: false, error: "Campaign not found" };
    if (campaign.status !== "draft") return { ok: false, error: "Only drafts can be scheduled" };
    const when = new Date(scheduledAtIso);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date" };
    if (when.getTime() < Date.now() + 60_000) return { ok: false, error: "Schedule at least a minute in the future" };
    const check = await preflight(supabase, campaign);
    if (check.problems.length) return { ok: false, error: check.problems.join(" ") };

    const { error } = await supabase.from("campaigns").update({ status: "scheduled", scheduled_at: when.toISOString() }).eq("id", id).eq("status", "draft");
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.scheduled", entityType: "campaign", entityId: id, metadata: { scheduled_at: when.toISOString(), mode: campaign.mode } });
    revalidateCampaign(campaign);
    return { ok: true, message: "Campaign scheduled" };
  });
}

export async function unscheduleCampaign(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const campaign = await loadCampaign(supabase, id);
    if (!campaign || campaign.status !== "scheduled") return { ok: false, error: "Campaign is not scheduled" };
    const { error } = await supabase.from("campaigns").update({ status: "draft", scheduled_at: null }).eq("id", id).eq("status", "scheduled");
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.unscheduled", entityType: "campaign", entityId: id });
    revalidateCampaign(campaign);
    return { ok: true, message: "Moved back to draft" };
  });
}

export async function runCampaignNow(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const campaign = await loadCampaign(supabase, id);
    if (!campaign) return { ok: false, error: "Campaign not found" };
    try {
      const stats = await runCampaign(supabase, id, { actorId: userId, trigger: "manual" });
      revalidateCampaign(campaign);
      const verb = campaign.mode === "live" ? "Sent" : "Simulated";
      return { ok: true, message: `${verb}: ${stats.succeeded} succeeded, ${stats.failed} failed, ${stats.skipped} skipped` };
    } catch (error) {
      revalidateCampaign(campaign);
      return { ok: false, error: error instanceof CampaignRunError ? error.message : "Run failed" };
    }
  });
}

export async function cancelCampaign(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const campaign = await loadCampaign(supabase, id);
    if (!campaign || !["draft", "scheduled"].includes(campaign.status)) return { ok: false, error: "Only draft or scheduled campaigns can be cancelled" };
    const { error } = await supabase.from("campaigns").update({ status: "cancelled" }).eq("id", id).in("status", ["draft", "scheduled"]);
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.cancelled", entityType: "campaign", entityId: id });
    revalidateCampaign(campaign);
    return { ok: true, message: "Campaign cancelled" };
  });
}

export async function duplicateCampaign(id: string): Promise<ActionResult<{ id: string }>> {
  return withSession(async ({ supabase, userId }) => {
    const c = await loadCampaign(supabase, id);
    if (!c) return { ok: false, error: "Campaign not found" };
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        owner_id: userId,
        channel: c.channel,
        name: `${c.name} (copy)`.slice(0, 120),
        description: c.description,
        segment: c.segment,
        mode: "simulation",
        provider: "mock",
        media_asset_id: c.media_asset_id,
        caller_id: c.caller_id,
        whatsapp_template_name: c.whatsapp_template_name,
        whatsapp_template_language: c.whatsapp_template_language,
        template_variables: c.template_variables,
      })
      .select("id")
      .single();
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.duplicated", entityType: "campaign", entityId: data.id, metadata: { from: id } });
    revalidateCampaign({ id: data.id, channel: c.channel });
    return { ok: true, data: { id: data.id }, message: "Copied as a new simulation draft" };
  });
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const c = await loadCampaign(supabase, id);
    if (!c) return { ok: false, error: "Campaign not found" };
    if (c.started_at) return { ok: false, error: "Campaigns that have run are kept for the audit trail and can't be deleted." };
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "campaign.deleted", entityType: "campaign", entityId: id, metadata: { name: c.name } });
    revalidateCampaign(c);
    return { ok: true, message: "Campaign deleted" };
  });
}

export async function previewAudience(channel: "voice" | "whatsapp", segment: { tags: string[]; match: "any" | "all" }): Promise<ActionResult<AudienceEstimate>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = campaignInput.shape.segment.safeParse(segment);
    if (!parsed.success || !["voice", "whatsapp"].includes(channel)) return { ok: false, error: "Invalid segment" };
    return { ok: true, data: await estimateAudience(supabase, userId, channel, parsed.data) };
  });
}

export async function runDueCampaigns(): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const results = await dispatchDueCampaigns(supabase, userId, userId, 10);
    revalidatePath("/calls");
    revalidatePath("/whatsapp");
    revalidatePath("/history");
    revalidatePath("/dashboard");
    if (results.length === 0) return { ok: true, message: "No scheduled campaigns are due yet" };
    const failed = results.filter((r) => !r.ok).length;
    return { ok: true, message: `Ran ${results.length} due campaign(s)${failed ? `, ${failed} failed` : ""}` };
  });
}
