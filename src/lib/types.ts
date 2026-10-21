// Row shapes for the tables in supabase/migrations. Regenerate a full typed
// client with `supabase gen types typescript` if you prefer generated types.
import type { RecipientStatus } from "@/lib/campaigns/logic";
import type { ComplianceRecordType, ComplianceStatus } from "@/lib/compliance/requirements";
import type { MediaKind } from "@/lib/media/rules";
import type { Channel, DeliveryMode } from "@/lib/providers/types";

export type CampaignStatus = "draft" | "scheduled" | "running" | "completed" | "cancelled" | "failed";
export type SuppressionReason = "opt_out" | "dnc_registry" | "complaint" | "invalid_number" | "manual";
export type UserRole = "owner" | "admin" | "operator" | "viewer";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
}

export interface Contact {
  id: string;
  owner_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string;
  email: string | null;
  country_code: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  voice_consent: boolean;
  whatsapp_opt_in: boolean;
  consent_source: string | null;
  consent_at: string | null;
  import_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactImport {
  id: string;
  file_name: string | null;
  source: "csv" | "xlsx" | "paste";
  status: "processing" | "completed" | "partial" | "failed";
  total_rows: number;
  imported_rows: number;
  updated_rows: number;
  duplicate_rows: number;
  invalid_rows: number;
  column_mapping: Record<string, unknown>;
  errors: { row: number; field: string; message: string }[];
  created_at: string;
  completed_at: string | null;
}

export interface MediaAsset {
  id: string;
  owner_id: string;
  kind: MediaKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  owner_id: string;
  channel: Channel;
  name: string;
  description: string | null;
  status: CampaignStatus;
  mode: DeliveryMode;
  provider: string;
  segment: unknown;
  media_asset_id: string | null;
  caller_id: string | null;
  whatsapp_template_name: string | null;
  whatsapp_template_language: string | null;
  template_variables: unknown;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  stats: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  phone_e164: string;
  display_name: string | null;
  status: RecipientStatus;
  status_reason: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
}

export interface DeliveryAttempt {
  id: string;
  campaign_id: string;
  recipient_id: string;
  channel: Channel;
  provider: string;
  mode: DeliveryMode;
  attempt_number: number;
  status: RecipientStatus;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_seconds: number | null;
  response_payload: Record<string, unknown>;
  created_at: string;
}

export interface SuppressionRecord {
  id: string;
  phone_e164: string;
  channel: Channel | "all";
  reason: SuppressionReason;
  source: string | null;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ComplianceRecord {
  id: string;
  channel: Channel;
  record_type: ComplianceRecordType;
  title: string;
  status: ComplianceStatus;
  reference: string | null;
  details: Record<string, unknown>;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
