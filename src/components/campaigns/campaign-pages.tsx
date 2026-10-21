import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileAudio } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { ModeBadge } from "@/components/mode";
import { PageHeader, Pager, StatCard } from "@/components/page";
import { ChannelBadge, StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { estimateAudience, preflight } from "@/lib/campaigns/engine";
import { parseSegment, parseTemplateVariables, resolveTemplateParams } from "@/lib/campaigns/logic";
import { configuredProvider, getLiveReadiness } from "@/lib/compliance/readiness";
import { formatDuration, formatNumber, humanize, pageParams, param, percent } from "@/lib/format";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { getWhatsAppProvider } from "@/lib/providers/registry";
import type { Channel } from "@/lib/providers/types";
import type { Campaign, CampaignRecipient, DeliveryAttempt, MediaAsset } from "@/lib/types";
import { CampaignActions } from "./campaign-actions";
import { CampaignForm } from "./campaign-form";
import { CHANNEL_META } from "./campaign-list";
import { ReadinessChecklist } from "./readiness-card";
import { WhatsAppPreview } from "./whatsapp-preview";

async function signedUrls(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], assets: MediaAsset[]) {
  const urls: Record<string, string> = {};
  if (!assets.length) return urls;
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(assets.map((a) => a.storage_path), 3600);
  for (const s of data ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  return urls;
}

export async function CampaignFormPage({ channel, id }: { channel: Channel; id?: string }) {
  const meta = CHANNEL_META[channel];
  const { supabase, userId } = await requireUser();

  let campaign: Campaign | undefined;
  if (id) {
    const { data } = await supabase.from("campaigns").select("*").eq("id", id).eq("channel", channel).maybeSingle();
    if (!data) notFound();
    campaign = data as Campaign;
    if (campaign.status !== "draft") {
      return (
        <Alert>
          <AlertTitle>This campaign can&apos;t be edited</AlertTitle>
          <AlertDescription>
            Only drafts are editable. <Link href={`${meta.path}/${id}`} className="underline">Back to campaign</Link>
          </AlertDescription>
        </Alert>
      );
    }
  }

  const kinds = channel === "voice" ? ["audio"] : ["image", "video"];
  const [tagsResult, assetsResult, readiness] = await Promise.all([
    supabase.rpc("contact_tag_counts"),
    supabase.from("media_assets").select("*").eq("owner_id", userId).in("kind", kinds).order("created_at", { ascending: false }).limit(100),
    getLiveReadiness(supabase, userId, channel),
  ]);
  const assets = (assetsResult.data ?? []) as MediaAsset[];
  const templates =
    channel === "whatsapp"
      ? await getWhatsAppProvider(readiness.ready ? "live" : "simulation", configuredProvider("whatsapp"), readiness).listTemplates()
      : [];

  return (
    <>
      <PageHeader
        title={campaign ? `Edit ${campaign.name}` : `New ${meta.noun}`}
        eyebrow={<ChannelBadge channel={channel} />}
        actions={
          <Button variant="ghost" asChild>
            <Link href={campaign ? `${meta.path}/${campaign.id}` : meta.path}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      <CampaignForm
        channel={channel}
        basePath={meta.path}
        campaign={campaign}
        tags={((tagsResult.data ?? []) as { tag: string; contact_count: number }[]).map((t) => ({ tag: t.tag, count: Number(t.contact_count) }))}
        assets={assets}
        mediaUrls={await signedUrls(supabase, assets)}
        templates={templates}
        readiness={readiness}
      />
    </>
  );
}

type SP = Record<string, string | string[] | undefined>;

export async function CampaignDetailPage({ channel, id, searchParams }: { channel: Channel; id: string; searchParams: SP }) {
  const meta = CHANNEL_META[channel];
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("campaigns").select("*").eq("id", id).eq("channel", channel).maybeSingle();
  if (!data) notFound();
  const campaign = data as Campaign;
  const segment = parseSegment(campaign.segment);
  const { page, from, to } = pageParams(searchParams);
  const statusFilter = param(searchParams, "status");

  let recipientsQuery = supabase
    .from("campaign_recipients")
    .select("*", { count: "exact" })
    .eq("campaign_id", id)
    .order("created_at")
    .range(from, to);
  if (statusFilter) recipientsQuery = recipientsQuery.eq("status", statusFilter);

  const editable = campaign.status === "draft" || campaign.status === "scheduled";
  const [check, recipientsResult, readiness, estimate] = await Promise.all([
    preflight(supabase, campaign),
    recipientsQuery,
    getLiveReadiness(supabase, userId, channel),
    editable ? estimateAudience(supabase, userId, channel, campaign.segment) : Promise.resolve(null),
  ]);
  const recipients = (recipientsResult.data ?? []) as CampaignRecipient[];
  const recipientIds = recipients.map((r) => r.id);
  const { data: attemptRows } = recipientIds.length
    ? await supabase.from("delivery_attempts").select("*").in("recipient_id", recipientIds)
    : { data: [] };
  const attempts = new Map(((attemptRows ?? []) as DeliveryAttempt[]).map((a) => [a.recipient_id, a]));
  const mediaUrl = check.media ? (await signedUrls(supabase, [check.media]))[check.media.storage_path] : null;

  const stats = campaign.stats as Record<string, unknown>;
  const byStatus = (stats.byStatus ?? {}) as Record<string, number>;
  const ran = Boolean(campaign.started_at);
  const blocked = check.problems.length > 0 || (campaign.mode === "live" && !readiness.ready);

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        eyebrow={
          <>
            <ChannelBadge channel={channel} />
            <ModeBadge mode={campaign.mode} size="lg" />
            <StatusBadge status={campaign.status} />
          </>
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href={meta.path}>
              <ArrowLeft /> All {meta.title}
            </Link>
          </Button>
        }
      />

      <div className="mb-6">
        <CampaignActions campaign={campaign} basePath={meta.path} blocked={blocked} />
      </div>

      {editable && check.problems.length ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Fix these before running</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {campaign.status === "failed" && typeof stats.error === "string" ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Run failed</AlertTitle>
          <AlertDescription>{stats.error}</AlertDescription>
        </Alert>
      ) : null}

      {campaign.status === "scheduled" ? (
        <Alert className="mb-6">
          <AlertTitle>
            Scheduled for <LocalTime iso={campaign.scheduled_at} />
          </AlertTitle>
          <AlertDescription>It will run in {campaign.mode} mode when due. Unschedule to edit it.</AlertDescription>
        </Alert>
      ) : null}

      {ran && campaign.status === "completed" ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Recipients" value={formatNumber(Number(stats.total) || 0)} />
          <StatCard label={channel === "voice" ? "Answered / voicemail" : "Delivered / read"} value={formatNumber(Number(stats.succeeded) || 0)} hint={percent(Number(stats.succeeded) || 0, Number(stats.attempted) || 0) + " of attempts"} />
          <StatCard label="Failed / unreachable" value={formatNumber(Number(stats.failed) || 0)} />
          <StatCard label="Skipped" value={formatNumber(Number(stats.skipped) || 0)} hint="No consent or suppressed" />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {ran ? (
            <Card>
              <CardHeader>
                <CardTitle>Recipients &amp; delivery attempts</CardTitle>
                <div className="flex flex-wrap gap-1 pt-2">
                  <Button size="xs" variant={statusFilter ? "ghost" : "secondary"} asChild>
                    <Link href={`${meta.path}/${id}`}>All</Link>
                  </Button>
                  {Object.entries(byStatus).map(([s, n]) => (
                    <Button key={s} size="xs" variant={statusFilter === s ? "secondary" : "ghost"} asChild>
                      <Link href={`${meta.path}/${id}?status=${s}`}>
                        {humanize(s)} <span className="text-muted-foreground">{n}</span>
                      </Link>
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Mode</th>
                        <th className="py-2 pr-3 font-medium">{channel === "voice" ? "Duration" : "Message ID"}</th>
                        <th className="py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {recipients.map((r) => {
                        const a = attempts.get(r.id);
                        return (
                          <tr key={r.id}>
                            <td className="py-2 pr-3">
                              <p className="font-mono text-xs">{r.phone_e164}</p>
                              {r.display_name ? <p className="text-xs text-muted-foreground">{r.display_name}</p> : null}
                            </td>
                            <td className="py-2 pr-3">
                              <StatusBadge status={r.status} />
                            </td>
                            <td className="py-2 pr-3">{a ? <ModeBadge mode={a.mode} /> : <span className="text-xs text-muted-foreground">not sent</span>}</td>
                            <td className="max-w-40 truncate py-2 pr-3 font-mono text-xs text-muted-foreground">
                              {a ? (channel === "voice" ? formatDuration(a.duration_seconds) : a.provider_message_id) : "—"}
                            </td>
                            <td className="py-2 text-xs text-muted-foreground">
                              {a?.error_code ? <span className="font-mono">{a.error_code} </span> : null}
                              {r.status_reason ?? (a ? <LocalTime iso={a.created_at} /> : "")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} hasMore={(recipientsResult.count ?? 0) > to + 1} basePath={`${meta.path}/${id}`} searchParams={searchParams} total={recipientsResult.count} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Audience preview</CardTitle>
              </CardHeader>
              <CardContent>
                {estimate ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Matching" value={formatNumber(estimate.total)} />
                    <StatCard label="Will receive" value={formatNumber(estimate.eligible)} />
                    <StatCard label="No consent" value={formatNumber(estimate.noConsent)} />
                    <StatCard label="Suppressed" value={formatNumber(estimate.suppressed)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">This campaign did not run.</p>
                )}
                <p className="mt-3 text-xs text-muted-foreground">The audience is snapshotted at run time, so contacts added later are included if they match.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Provider">
                <span className="font-mono text-xs">{campaign.provider}</span>
              </Row>
              <Row label="Segment">{segment.tags.length ? `${segment.match === "all" ? "All of" : "Any of"}: ${segment.tags.join(", ")}` : "All contacts"}</Row>
              {channel === "voice" ? <Row label="Caller ID">{campaign.caller_id ?? "Provider default"}</Row> : null}
              {channel === "whatsapp" ? (
                <Row label="Template">
                  <span className="font-mono text-xs">
                    {campaign.whatsapp_template_name ?? "—"} ({campaign.whatsapp_template_language ?? "—"})
                  </span>
                </Row>
              ) : null}
              <Row label="Created">
                <LocalTime iso={campaign.created_at} />
              </Row>
              {campaign.started_at ? (
                <Row label="Ran">
                  <LocalTime iso={campaign.started_at} />
                </Row>
              ) : null}
              {check.media && channel === "voice" ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="flex items-center gap-2 text-xs font-medium">
                    <FileAudio className="size-4 text-voice" /> {check.media.file_name} · {formatDuration(check.media.duration_seconds)}
                  </p>
                  {mediaUrl ? <audio src={mediaUrl} controls preload="none" className="w-full" /> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {channel === "whatsapp" ? (
            <WhatsAppPreview
              template={check.template}
              params={resolveTemplateParams(parseTemplateVariables(campaign.template_variables), { first_name: "Asha", last_name: "Verma", phone_e164: "+919876543210" })}
              mediaUrl={mediaUrl}
              mediaKind={check.media?.kind === "video" ? "video" : "image"}
            />
          ) : null}

          {campaign.mode === "live" || editable ? <ReadinessChecklist readiness={readiness} compact /> : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
