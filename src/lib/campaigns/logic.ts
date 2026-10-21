// Pure campaign rules shared by the run engine, the UI and the tests.
import type { Channel } from "@/lib/providers/types";

export type RecipientStatus =
  | "pending"
  | "skipped_suppressed"
  | "skipped_no_consent"
  | "skipped_invalid"
  | "answered"
  | "voicemail"
  | "no_answer"
  | "busy"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export interface Segment {
  tags: string[];
  match: "any" | "all";
}

export interface SegmentContact {
  id: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  tags: string[];
  voice_consent: boolean;
  whatsapp_opt_in: boolean;
}

export interface SuppressionLike {
  phone_e164: string;
  channel: Channel | "all";
  expires_at: string | null;
}

export function parseSegment(value: unknown): Segment {
  const v = (value ?? {}) as Partial<Segment>;
  return {
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string") : [],
    match: v.match === "all" ? "all" : "any",
  };
}

/** An empty tag list means "all contacts". */
export function matchesSegment(contactTags: string[], segment: Segment): boolean {
  if (segment.tags.length === 0) return true;
  return segment.match === "all"
    ? segment.tags.every((t) => contactTags.includes(t))
    : segment.tags.some((t) => contactTags.includes(t));
}

export function buildSuppressionIndex(records: SuppressionLike[], channel: Channel, now = new Date()): Set<string> {
  const set = new Set<string>();
  for (const r of records) {
    if (r.channel !== "all" && r.channel !== channel) continue;
    if (r.expires_at && new Date(r.expires_at) <= now) continue;
    set.add(r.phone_e164);
  }
  return set;
}

export function hasChannelConsent(contact: Pick<SegmentContact, "voice_consent" | "whatsapp_opt_in">, channel: Channel): boolean {
  return channel === "voice" ? contact.voice_consent : contact.whatsapp_opt_in;
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; status: "skipped_suppressed" | "skipped_no_consent"; reason: string };

/** Suppression beats consent: an opted-out number is never contacted. */
export function checkEligibility(contact: SegmentContact, channel: Channel, suppressed: ReadonlySet<string>): Eligibility {
  if (suppressed.has(contact.phone_e164)) {
    return { eligible: false, status: "skipped_suppressed", reason: "Number is on the suppression list" };
  }
  if (!hasChannelConsent(contact, channel)) {
    return {
      eligible: false,
      status: "skipped_no_consent",
      reason: channel === "voice" ? "No voice call consent on record" : "No WhatsApp opt-in on record",
    };
  }
  return { eligible: true };
}

export interface CampaignStats {
  total: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  byStatus: Partial<Record<RecipientStatus, number>>;
}

const SUCCESS: RecipientStatus[] = ["answered", "voicemail", "delivered", "read", "sent"];
const FAILURE: RecipientStatus[] = ["failed", "no_answer", "busy"];

export function computeStats(statuses: RecipientStatus[]): CampaignStats {
  const byStatus: CampaignStats["byStatus"] = {};
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of statuses) {
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (SUCCESS.includes(s)) succeeded++;
    else if (FAILURE.includes(s)) failed++;
    else if (s.startsWith("skipped")) skipped++;
  }
  return { total: statuses.length, attempted: succeeded + failed, succeeded, failed, skipped, byStatus };
}

// ---------------------------------------------------------------------------
// WhatsApp template variables
// ---------------------------------------------------------------------------
export const TEMPLATE_FIELDS = ["first_name", "last_name", "full_name", "phone_e164", "email"] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export type TemplateVariable =
  | { source: "field"; field: TemplateField; fallback: string }
  | { source: "static"; value: string };

export function resolveTemplateParams(variables: TemplateVariable[], contact: Partial<SegmentContact>): string[] {
  return variables.map((v) => {
    if (v.source === "static") return v.value;
    const value =
      v.field === "full_name"
        ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
        : ((contact[v.field] as string | null | undefined) ?? "");
    return value.trim() || v.fallback;
  });
}

export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, index) => params[Number(index) - 1] ?? match);
}

export function parseTemplateVariables(value: unknown): TemplateVariable[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v): TemplateVariable[] => {
    if (v && v.source === "static" && typeof v.value === "string") return [{ source: "static", value: v.value }];
    if (v && v.source === "field" && TEMPLATE_FIELDS.includes(v.field)) {
      return [{ source: "field", field: v.field, fallback: typeof v.fallback === "string" ? v.fallback : "" }];
    }
    return [];
  });
}

export function displayName(contact: Pick<SegmentContact, "first_name" | "last_name">): string | null {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null;
}
