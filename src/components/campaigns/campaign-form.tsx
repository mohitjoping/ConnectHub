"use client";

import { FileAudio, FlaskConical, Loader2, Lock, Radio, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { previewAudience, saveCampaign } from "@/lib/actions/campaigns";
import type { AudienceEstimate } from "@/lib/campaigns/engine";
import { parseSegment, parseTemplateVariables, resolveTemplateParams, TEMPLATE_FIELDS, type TemplateField, type TemplateVariable } from "@/lib/campaigns/logic";
import type { LiveReadiness } from "@/lib/compliance/requirements";
import { formatDuration, humanize } from "@/lib/format";
import type { Channel, DeliveryMode, WhatsAppTemplate } from "@/lib/providers/types";
import { countPlaceholders } from "@/lib/providers/whatsapp/mock";
import type { Campaign, MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WhatsAppPreview } from "./whatsapp-preview";

const SAMPLE = { first_name: "Asha", last_name: "Verma", phone_e164: "+919876543210", email: "asha@example.com" };

export interface CampaignFormProps {
  channel: Channel;
  basePath: string;
  campaign?: Campaign;
  tags: { tag: string; count: number }[];
  assets: MediaAsset[];
  mediaUrls: Record<string, string>;
  templates: WhatsAppTemplate[];
  readiness: LiveReadiness;
}

export function CampaignForm({ channel, basePath, campaign, tags, assets, mediaUrls, templates, readiness }: CampaignFormProps) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [name, setName] = useState(campaign?.name ?? "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [segment, setSegment] = useState(() => parseSegment(campaign?.segment));
  const [mode, setMode] = useState<DeliveryMode>(campaign?.mode === "live" && readiness.ready ? "live" : "simulation");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(campaign?.media_asset_id ?? null);
  const [callerId, setCallerId] = useState(campaign?.caller_id ?? "");
  const [templateKey, setTemplateKey] = useState(
    campaign?.whatsapp_template_name ? `${campaign.whatsapp_template_name}|${campaign.whatsapp_template_language ?? "en"}` : "",
  );
  const [variables, setVariables] = useState<TemplateVariable[]>(() => parseTemplateVariables(campaign?.template_variables));
  const [estimate, setEstimate] = useState<AudienceEstimate | null>(null);

  const template = templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const placeholderCount = template ? countPlaceholders(template.body) : 0;
  const neededMedia = channel === "voice" ? "audio" : template?.headerType === "IMAGE" ? "image" : template?.headerType === "VIDEO" ? "video" : null;
  const mediaChoices = assets.filter((a) => a.kind === neededMedia);
  const selectedMedia = assets.find((a) => a.id === mediaAssetId) ?? null;

  // Keep variables in step with the chosen template's placeholders.
  const pickTemplate = (key: string) => {
    setTemplateKey(key);
    const next = templates.find((t) => `${t.name}|${t.language}` === key);
    const n = next ? countPlaceholders(next.body) : 0;
    setVariables((prev) =>
      Array.from({ length: n }, (_, i) => prev[i] ?? (i === 0 ? { source: "field", field: "first_name", fallback: "there" } : { source: "static", value: "" })),
    );
    if (next && selectedMedia && (next.headerType === "IMAGE" ? "image" : next.headerType === "VIDEO" ? "video" : null) !== selectedMedia.kind) {
      setMediaAssetId(null);
    }
  };

  const segmentKey = JSON.stringify(segment);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await previewAudience(channel, segment);
      if (!cancelled && r.ok && r.data) setEstimate(r.data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentKey, channel]);

  const params = useMemo(() => resolveTemplateParams(variables, SAMPLE), [variables]);

  const toggleTag = (tag: string) =>
    setSegment((s) => ({ ...s, tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag] }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startSaving(async () => {
      const [templateName, templateLanguage] = templateKey ? templateKey.split("|") : [null, null];
      const result = await saveCampaign({
        id: campaign?.id,
        channel,
        name,
        description,
        segment,
        mode,
        mediaAssetId,
        callerId,
        templateName,
        templateLanguage,
        templateVariables: variables,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.push(`${basePath}/${result.data!.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Campaign name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder={channel === "voice" ? "Diwali appointment reminder" : "October offer – Mumbai"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Internal notes</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
            </div>
            {channel === "voice" ? (
              <div className="space-y-1.5">
                <Label htmlFor="caller">Caller ID</Label>
                <Input id="caller" value={callerId} onChange={(e) => setCallerId(e.target.value)} placeholder="+91 22 1234 5678" inputMode="tel" />
                <p className="text-xs text-muted-foreground">The number recipients see. Live providers only allow numbers you own and have verified.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audience</CardTitle>
            <CardDescription>Pick tags, or leave empty for all contacts. Contacts without {channel === "voice" ? "voice consent" : "WhatsApp opt-in"} or on the suppression list are skipped automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = segment.tags.includes(t.tag);
                  return (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => toggleTag(t.tag)}
                      aria-pressed={on}
                      className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                    >
                      {t.tag} <span className="opacity-60">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No tags yet — the campaign will target all contacts. <Link href="/contacts" className="underline">Tag contacts</Link> to build segments.
              </p>
            )}
            {segment.tags.length > 1 ? (
              <div className="flex items-center gap-2 text-sm">
                Match
                <Select value={segment.match} onValueChange={(v) => setSegment((s) => ({ ...s, match: v as "any" | "all" }))}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any selected tag</SelectItem>
                    <SelectItem value="all">all selected tags</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
              <Est label="Matching" value={estimate?.total} />
              <Est label="Will receive" value={estimate?.eligible} strong />
              <Est label="No consent" value={estimate?.noConsent} />
              <Est label="Suppressed" value={estimate?.suppressed} />
            </div>
            {estimate?.overLimit ? (
              <Alert variant="destructive">
                <AlertDescription>More than 5,000 contacts match. Narrow the segment with tags.</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {channel === "whatsapp" ? (
          <Card>
            <CardHeader>
              <CardTitle>Template</CardTitle>
              <CardDescription>Business-initiated WhatsApp messages must use a template approved by Meta. Templates come from your provider account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((t) => {
                  const key = `${t.name}|${t.language}`;
                  const approved = t.status === "APPROVED";
                  return (
                    <button
                      type="button"
                      key={key}
                      disabled={!approved}
                      onClick={() => pickTemplate(key)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        templateKey === key ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs">{t.name}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-medium", approved ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>
                          {t.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                      <p className="mt-1 text-[0.65rem] text-muted-foreground uppercase">
                        {t.category} · {t.language} · {t.headerType === "NONE" ? "no header" : `${t.headerType.toLowerCase()} header`}
                      </p>
                    </button>
                  );
                })}
              </div>

              {template && placeholderCount > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Variables</p>
                  {variables.map((v, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[60px_160px_1fr] sm:items-center">
                      <span className="font-mono text-xs text-muted-foreground">{`{{${i + 1}}}`}</span>
                      <Select
                        value={v.source === "static" ? "static" : v.field}
                        onValueChange={(val) =>
                          setVariables((vs) =>
                            vs.map((x, j) =>
                              j !== i ? x : val === "static" ? { source: "static", value: x.source === "static" ? x.value : "" } : { source: "field", field: val as TemplateField, fallback: x.source === "field" ? x.fallback : "" },
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-full" aria-label={`Source for variable ${i + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TEMPLATE_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              Contact: {humanize(f)}
                            </SelectItem>
                          ))}
                          <SelectItem value="static">Fixed text</SelectItem>
                        </SelectContent>
                      </Select>
                      {v.source === "static" ? (
                        <Input value={v.value} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i ? { source: "static", value: e.target.value } : x)))} placeholder="Text for every recipient" />
                      ) : (
                        <Input value={v.fallback} onChange={(e) => setVariables((vs) => vs.map((x, j) => (j === i && x.source === "field" ? { ...x, fallback: e.target.value } : x)))} placeholder="Fallback if empty" />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {neededMedia ? (
          <Card>
            <CardHeader>
              <CardTitle>{channel === "voice" ? "Audio message" : `Header ${neededMedia}`}</CardTitle>
              <CardDescription>
                {channel === "voice" ? "Played when the call is answered (or left as voicemail)." : `This template needs a ${neededMedia}.`}{" "}
                <Link href="/media" className="underline">
                  Upload in the media library
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mediaChoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {neededMedia} files uploaded yet.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {mediaChoices.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => setMediaAssetId(a.id)}
                      className={cn("flex items-center gap-3 rounded-lg border p-2 text-left", mediaAssetId === a.id ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50")}
                    >
                      {a.kind === "image" && mediaUrls[a.storage_path] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                        <img src={mediaUrls[a.storage_path]} alt="" className="size-12 rounded object-cover" />
                      ) : (
                        <span className="grid size-12 place-items-center rounded bg-muted">
                          <FileAudio className="size-5 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.file_name}</span>
                        <span className="text-xs text-muted-foreground">{a.duration_seconds ? formatDuration(a.duration_seconds) : a.kind}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedMedia?.kind === "audio" && mediaUrls[selectedMedia.storage_path] ? (
                <audio src={mediaUrls[selectedMedia.storage_path]} controls className="mt-3 w-full" preload="none" />
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6 lg:sticky lg:top-16 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Delivery mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ModeOption
              selected={mode === "simulation"}
              onSelect={() => setMode("simulation")}
              icon={<FlaskConical className="size-4" />}
              title="Simulation"
              body="Mock provider. Nobody is contacted; outcomes are simulated and recorded."
            />
            <ModeOption
              selected={mode === "live"}
              disabled={!readiness.ready}
              onSelect={() => setMode("live")}
              icon={readiness.ready ? <Radio className="size-4 text-live" /> : <Lock className="size-4" />}
              title="Live"
              body={readiness.ready ? "Real delivery through your configured provider." : `Locked: ${readiness.checks.filter((c) => !c.ok).length} readiness check(s) outstanding.`}
            />
            {!readiness.ready ? (
              <Link href="/compliance" className="block pt-1 text-xs text-muted-foreground underline">
                View the live-readiness checklist
              </Link>
            ) : null}
          </CardContent>
        </Card>

        {channel === "whatsapp" ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Preview with sample contact &ldquo;{SAMPLE.first_name}&rdquo;</p>
            <WhatsAppPreview template={template} params={params} mediaUrl={selectedMedia ? mediaUrls[selectedMedia.storage_path] : null} mediaKind={selectedMedia?.kind === "video" ? "video" : "image"} />
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {campaign ? "Save draft" : "Create draft"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Drafts never send anything. You choose to run or schedule on the next screen.</p>
      </div>
    </form>
  );
}

function Est({ label, value, strong }: { label: string; value: number | undefined; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong && "font-semibold")}>{value === undefined ? <Users className="size-4 animate-pulse text-muted-foreground" /> : value.toLocaleString()}</p>
    </div>
  );
}

function ModeOption({ selected, disabled, onSelect, icon, title, body }: { selected: boolean; disabled?: boolean; onSelect: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}
