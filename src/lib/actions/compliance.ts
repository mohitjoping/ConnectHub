"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { defaultPhoneCountry } from "@/lib/env";
import { normalizePhone } from "@/lib/import/validate";
import type { ActionResult } from "@/lib/types";
import { dbError, withSession, zodMessage } from "./helpers";

// ---------------------------------------------------------------------------
// Suppression list
// ---------------------------------------------------------------------------
const suppressionInput = z.object({
  phones: z.string().min(1, "Enter at least one number").max(200_000),
  channel: z.enum(["voice", "whatsapp", "all"]),
  reason: z.enum(["opt_out", "dnc_registry", "complaint", "invalid_number", "manual"]),
  notes: z.string().trim().max(500).optional().default(""),
  expiresAt: z.string().optional().default(""),
});

export async function addSuppressions(input: z.input<typeof suppressionInput>): Promise<ActionResult<{ added: number; invalid: string[] }>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = suppressionInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    const entries = v.phones.split(/[\n,;\t]+/).map((p) => p.trim()).filter(Boolean);
    if (entries.length > 10_000) return { ok: false, error: "Add at most 10,000 numbers at a time" };

    const valid = new Set<string>();
    const invalid: string[] = [];
    for (const entry of entries) {
      const r = normalizePhone(entry, defaultPhoneCountry);
      if (r.ok) valid.add(r.e164);
      else invalid.push(entry);
    }
    if (valid.size === 0) return { ok: false, error: "None of those numbers are valid" };

    const expires = v.expiresAt ? new Date(v.expiresAt) : null;
    if (expires && Number.isNaN(expires.getTime())) return { ok: false, error: "Invalid expiry date" };
    const rows = [...valid].map((phone) => ({
      owner_id: userId,
      phone_e164: phone,
      channel: v.channel,
      reason: v.reason,
      source: "manual",
      notes: v.notes || null,
      expires_at: expires?.toISOString() ?? null,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await supabase.from("suppression_records").upsert(rows.slice(i, i + 1000), { onConflict: "owner_id,phone_e164,channel" });
      if (error) return dbError(error);
    }
    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: "suppression.added",
      entityType: "suppression_record",
      metadata: { count: valid.size, channel: v.channel, reason: v.reason, invalid: invalid.length },
    });
    revalidatePath("/suppression");
    return { ok: true, data: { added: valid.size, invalid: invalid.slice(0, 50) }, message: `Suppressed ${valid.size} number(s)` };
  });
}

export async function removeSuppression(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid id" };
    const { data, error } = await supabase.from("suppression_records").delete().eq("id", id).select("phone_e164, channel, reason").maybeSingle();
    if (error) return dbError(error);
    if (!data) return { ok: false, error: "Record not found" };
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "suppression.removed", entityType: "suppression_record", entityId: id, metadata: data });
    revalidatePath("/suppression");
    return { ok: true, message: `${data.phone_e164} can be contacted again` };
  });
}

// ---------------------------------------------------------------------------
// Compliance records
// ---------------------------------------------------------------------------
const recordInput = z.object({
  channel: z.enum(["voice", "whatsapp"]),
  recordType: z.enum(["provider_approval", "live_mode_attestation", "consent_policy", "template_approval", "business_verification", "dnc_registry_check"]),
  title: z.string().trim().min(1, "Title is required").max(200),
  reference: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  expiresAt: z.string().optional().default(""),
});

export async function createComplianceRecord(input: z.input<typeof recordInput>): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = recordInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    const expires = v.expiresAt ? new Date(v.expiresAt) : null;
    if (expires && Number.isNaN(expires.getTime())) return { ok: false, error: "Invalid expiry date" };
    const { data, error } = await supabase
      .from("compliance_records")
      .insert({
        owner_id: userId,
        channel: v.channel,
        record_type: v.recordType,
        title: v.title,
        reference: v.reference || null,
        details: v.notes ? { notes: v.notes } : {},
        expires_at: expires?.toISOString() ?? null,
      })
      .select("id")
      .single();
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "compliance.created", entityType: "compliance_record", entityId: data.id, metadata: { channel: v.channel, type: v.recordType } });
    revalidatePath("/compliance");
    return { ok: true, message: "Record added as pending" };
  });
}

export async function setComplianceStatus(id: string, status: "pending" | "verified" | "rejected" | "expired"): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    if (!z.uuid().safeParse(id).success || !["pending", "verified", "rejected", "expired"].includes(status)) {
      return { ok: false, error: "Invalid input" };
    }
    // The database trigger stamps verified_by/verified_at and enforces role.
    const { data, error } = await supabase.from("compliance_records").update({ status }).eq("id", id).select("channel, record_type").maybeSingle();
    if (error) return dbError(error);
    if (!data) return { ok: false, error: "Record not found" };
    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: `compliance.${status}`,
      entityType: "compliance_record",
      entityId: id,
      metadata: data,
    });
    revalidatePath("/compliance");
    revalidatePath("/", "layout");
    return { ok: true, message: `Marked ${status}` };
  });
}

export async function updateProfileName(fullName: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const name = z.string().trim().min(1).max(100).safeParse(fullName);
    if (!name.success) return { ok: false, error: "Enter a name" };
    const { error } = await supabase.from("profiles").update({ full_name: name.data }).eq("id", userId);
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved" };
  });
}
