"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { CONTACT_FIELD_KEYS, type ColumnMapping } from "@/lib/import/fields";
import { mappingProblems } from "@/lib/import/detect";
import { buildImportPreview, firstErrors, mergeIntoExisting, type ExistingContact } from "@/lib/import/preview";
import { isCountryCode } from "@/lib/import/validate";
import type { ActionResult } from "@/lib/types";
import { dbError, withSession, zodMessage } from "./helpers";

const mappingSchema = z
  .record(z.string(), z.number().int().min(0).max(199))
  .transform((m) => Object.fromEntries(Object.entries(m).filter(([k]) => (CONTACT_FIELD_KEYS as readonly string[]).includes(k))) as ColumnMapping);

const startInput = z.object({
  fileName: z.string().trim().max(255).nullable(),
  source: z.enum(["csv", "xlsx", "paste"]),
  totalRows: z.number().int().min(1).max(50_000),
  mapping: mappingSchema,
});

export async function startImport(input: z.input<typeof startInput>): Promise<ActionResult<{ importId: string }>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = startInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const problems = mappingProblems(parsed.data.mapping);
    if (problems.length) return { ok: false, error: problems[0] };
    const { data, error } = await supabase
      .from("contact_imports")
      .insert({
        owner_id: userId,
        file_name: parsed.data.fileName,
        source: parsed.data.source,
        total_rows: parsed.data.totalRows,
        column_mapping: parsed.data.mapping,
      })
      .select("id")
      .single();
    if (error) return dbError(error);
    return { ok: true, data: { importId: data.id } };
  });
}

const chunkInput = z.object({
  importId: z.uuid(),
  fileName: z.string().max(255).nullable(),
  headers: z.array(z.string().max(500)).max(200),
  rows: z.array(z.array(z.string().max(2000)).max(200)).min(1).max(2000),
  firstRowNumber: z.number().int().min(1),
  /** rows the browser already identified as repeats of an earlier row in the file */
  skipRowNumbers: z.array(z.number().int()).max(2000).default([]),
  mapping: mappingSchema,
  defaultCountry: z.string().nullable(),
  keepUnmappedAsAttributes: z.boolean(),
  extraTags: z.array(z.string().max(40)).max(10),
  strategy: z.enum(["skip", "update"]),
  /** bulk attestation for rows whose file has no consent value */
  consentAttestation: z.object({
    voice: z.boolean(),
    whatsapp: z.boolean(),
    source: z.string().trim().max(200),
  }),
});

export interface ChunkResult {
  imported: number;
  updated: number;
  duplicates: number;
  invalid: number;
  errors: { row: number; field: string; message: string }[];
}

/**
 * Validates and writes one chunk of rows. Everything the browser previewed is
 * re-validated here — the client is never trusted with what gets stored.
 */
export async function importChunk(input: z.input<typeof chunkInput>): Promise<ActionResult<ChunkResult>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = chunkInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    if ((v.consentAttestation.voice || v.consentAttestation.whatsapp) && !v.consentAttestation.source) {
      return { ok: false, error: "Describe where consent was collected before attesting to it." };
    }

    const { data: importRow } = await supabase.from("contact_imports").select("id, status").eq("id", v.importId).maybeSingle();
    if (!importRow || importRow.status !== "processing") return { ok: false, error: "Import not found or already finished" };

    const preview = buildImportPreview(v.rows, v.mapping, {
      defaultCountry: v.defaultCountry && isCountryCode(v.defaultCountry) ? v.defaultCountry : null,
      keepUnmappedAsAttributes: v.keepUnmappedAsAttributes,
      headers: v.headers,
      extraTags: v.extraTags,
      firstRowNumber: v.firstRowNumber,
    });

    const skip = new Set(v.skipRowNumbers);
    let duplicates = 0;
    let invalid = 0;
    const candidates = preview.rows.filter((r) => {
      if (r.status === "invalid") {
        invalid++;
        return false;
      }
      if (r.status === "duplicate_in_file" || skip.has(r.rowNumber)) {
        duplicates++;
        return false;
      }
      return true;
    });
    const phones = candidates.map((r) => r.contact!.phoneE164);
    type Existing = ExistingContact & { consent_source: string | null; consent_at: string | null };
    const existing = new Map<string, Existing>();
    for (let i = 0; i < phones.length; i += 300) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, phone_e164, first_name, last_name, email, country_code, tags, attributes, voice_consent, whatsapp_opt_in, consent_source, consent_at")
        .eq("owner_id", userId)
        .in("phone_e164", phones.slice(i, i + 300));
      if (error) return dbError(error);
      for (const row of data ?? []) existing.set(row.phone_e164 as string, row as unknown as Existing);
    }

    const now = new Date().toISOString();
    const attest = v.consentAttestation;
    const consentSource = (fileValue: boolean | null, attested: boolean) => fileValue ?? (attested ? true : null);

    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];

    for (const row of candidates) {
      const c = row.contact!;
      const voice = consentSource(c.voiceConsent, attest.voice);
      const whatsapp = consentSource(c.whatsappOptIn, attest.whatsapp);
      const consentNote = voice || whatsapp ? attest.source || `Import: ${v.fileName ?? "pasted data"}` : null;
      const found = existing.get(c.phoneE164);
      if (found) {
        if (v.strategy === "skip") {
          duplicates++;
          continue;
        }
        const merged = mergeIntoExisting(found, { ...c, voiceConsent: voice, whatsappOptIn: whatsapp });
        const newlyConsented = (merged.voice_consent && !found.voice_consent) || (merged.whatsapp_opt_in && !found.whatsapp_opt_in);
        // Every upserted object must carry the same columns, or PostgREST nulls the missing ones.
        updates.push({
          ...merged,
          owner_id: userId,
          phone_e164: c.phoneE164,
          consent_source: newlyConsented && consentNote ? consentNote : found.consent_source,
          consent_at: newlyConsented && consentNote ? now : found.consent_at,
        });
      } else {
        inserts.push({
          owner_id: userId,
          import_id: v.importId,
          first_name: c.firstName,
          last_name: c.lastName,
          phone_e164: c.phoneE164,
          email: c.email,
          country_code: c.countryCode,
          tags: c.tags,
          attributes: c.attributes,
          voice_consent: voice ?? false,
          whatsapp_opt_in: whatsapp ?? false,
          consent_source: consentNote,
          consent_at: consentNote ? now : null,
        });
      }
    }

    if (inserts.length) {
      // ignoreDuplicates guards against a race with another import.
      const { error } = await supabase.from("contacts").upsert(inserts, { onConflict: "owner_id,phone_e164", ignoreDuplicates: true });
      if (error) return dbError(error);
    }
    if (updates.length) {
      const { error } = await supabase.from("contacts").upsert(updates, { onConflict: "id" });
      if (error) return dbError(error);
    }

    return {
      ok: true,
      data: {
        imported: inserts.length,
        updated: updates.length,
        duplicates,
        invalid,
        errors: firstErrors(preview.rows, 100),
      },
    };
  });
}

const finishInput = z.object({
  importId: z.uuid(),
  imported: z.number().int().min(0),
  updated: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  invalid: z.number().int().min(0),
  errors: z.array(z.object({ row: z.number(), field: z.string(), message: z.string() })).max(500),
  failed: z.boolean().optional(),
});

export async function finishImport(input: z.input<typeof finishInput>): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = finishInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    const status = v.failed ? "failed" : v.invalid > 0 ? "partial" : "completed";
    const { error } = await supabase
      .from("contact_imports")
      .update({
        status,
        imported_rows: v.imported,
        updated_rows: v.updated,
        duplicate_rows: v.duplicates,
        invalid_rows: v.invalid,
        errors: v.errors.slice(0, 200),
        completed_at: new Date().toISOString(),
      })
      .eq("id", v.importId);
    if (error) return dbError(error);
    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: "contacts.imported",
      entityType: "contact_import",
      entityId: v.importId,
      metadata: { status, imported: v.imported, updated: v.updated, duplicates: v.duplicates, invalid: v.invalid },
    });
    revalidatePath("/contacts");
    return { ok: true };
  });
}

/** Which of these numbers are already in the user's contacts (for the preview). */
export async function findExistingPhones(phones: string[]): Promise<ActionResult<string[]>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = z.array(z.string().regex(/^\+[1-9]\d{6,14}$/)).max(50_000).safeParse(phones);
    if (!parsed.success) return { ok: false, error: "Invalid phone list" };
    const found: string[] = [];
    for (let i = 0; i < parsed.data.length; i += 300) {
      const { data, error } = await supabase.from("contacts").select("phone_e164").eq("owner_id", userId).in("phone_e164", parsed.data.slice(i, i + 300));
      if (error) return dbError(error);
      found.push(...(data ?? []).map((r) => r.phone_e164 as string));
    }
    return { ok: true, data: found };
  });
}
