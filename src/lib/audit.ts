import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  ownerId: string;
  /** null for system actions (scheduled runs) */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append to audit_logs. Failures are logged but never block the action that
 * triggered them — except that callers can await and inspect if they need to.
 */
export async function writeAudit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    owner_id: entry.ownerId,
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("audit log write failed", entry.action, error.message);
}
