import type { Channel } from "@/lib/providers/types";

export type ComplianceRecordType =
  | "provider_approval"
  | "live_mode_attestation"
  | "consent_policy"
  | "template_approval"
  | "business_verification"
  | "dnc_registry_check";

export type ComplianceStatus = "pending" | "verified" | "rejected" | "expired";

export const COMPLIANCE_TYPES: Record<ComplianceRecordType, { label: string; description: string }> = {
  provider_approval: {
    label: "Provider approval",
    description: "Written approval from the voice/WhatsApp provider for this use case (account ID, approval ticket).",
  },
  consent_policy: {
    label: "Consent policy",
    description: "How consent is collected and stored, and how recipients opt out (link to policy).",
  },
  dnc_registry_check: {
    label: "Do-not-call registry check",
    description: "Evidence that numbers are scrubbed against the national DNC/DND registry (e.g. TRAI NCPR, FTC DNC).",
  },
  business_verification: {
    label: "Meta business verification",
    description: "Business Manager verification for the WhatsApp Business Account.",
  },
  template_approval: {
    label: "Template approval",
    description: "Message templates approved by Meta for the categories you send.",
  },
  live_mode_attestation: {
    label: "Live mode attestation",
    description: "An owner/admin confirms they accept responsibility for real outbound traffic.",
  },
};

// Mirrors public.required_compliance_types() in the database — keep in sync.
export const REQUIRED_COMPLIANCE: Record<Channel, ComplianceRecordType[]> = {
  voice: ["provider_approval", "consent_policy", "dnc_registry_check", "live_mode_attestation"],
  whatsapp: ["provider_approval", "business_verification", "template_approval", "consent_policy", "live_mode_attestation"],
};

export interface ComplianceRecordLike {
  channel: Channel;
  record_type: ComplianceRecordType;
  status: ComplianceStatus;
  expires_at: string | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface LiveReadiness {
  channel: Channel;
  ready: boolean;
  checks: ReadinessCheck[];
}

export interface LiveReadinessInput {
  channel: Channel;
  envFlagEnabled: boolean;
  /** configured provider id, and whether a live adapter exists for it */
  providerId: string;
  liveAdapterAvailable: boolean;
  records: ComplianceRecordLike[];
  now?: Date;
}

export function isRecordCurrent(record: ComplianceRecordLike, now: Date): boolean {
  return record.status === "verified" && (!record.expires_at || new Date(record.expires_at) > now);
}

/**
 * Live delivery needs ALL of: the server env flag, a real provider adapter,
 * and every required compliance record verified and unexpired. The database
 * re-checks the compliance part (public.live_mode_ready).
 */
export function evaluateLiveReadiness(input: LiveReadinessInput): LiveReadiness {
  const now = input.now ?? new Date();
  const flagName = input.channel === "voice" ? "LIVE_VOICE_ENABLED" : "LIVE_WHATSAPP_ENABLED";
  const providerVar = input.channel === "voice" ? "VOICE_PROVIDER" : "WHATSAPP_PROVIDER";

  const checks: ReadinessCheck[] = [
    {
      key: "env_flag",
      label: "Server flag enabled",
      ok: input.envFlagEnabled,
      detail: input.envFlagEnabled ? `${flagName}=true` : `${flagName} is not "true" (default: disabled)`,
    },
    {
      key: "provider",
      label: "Live provider configured",
      ok: input.providerId !== "mock" && input.liveAdapterAvailable,
      detail:
        input.providerId === "mock"
          ? `${providerVar}=mock — only simulation is possible`
          : input.liveAdapterAvailable
            ? `${providerVar}=${input.providerId}`
            : `No live adapter registered for ${providerVar}=${input.providerId}`,
    },
  ];

  for (const type of REQUIRED_COMPLIANCE[input.channel]) {
    const matching = input.records.filter((r) => r.channel === input.channel && r.record_type === type);
    const current = matching.some((r) => isRecordCurrent(r, now));
    const expired = matching.some((r) => r.status === "verified" && !isRecordCurrent(r, now));
    checks.push({
      key: type,
      label: COMPLIANCE_TYPES[type].label,
      ok: current,
      detail: current ? "Verified" : expired ? "Verified record has expired" : matching.length ? "Not verified yet" : "No record on file",
    });
  }

  return { channel: input.channel, ready: checks.every((c) => c.ok), checks };
}
