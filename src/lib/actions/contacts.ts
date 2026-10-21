"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { defaultPhoneCountry } from "@/lib/env";
import { EMAIL_PATTERN, isCountryCode, normalizePhone, parseTags } from "@/lib/import/validate";
import type { ActionResult } from "@/lib/types";
import { dbError, withSession, zodMessage } from "./helpers";

const contactInput = z.object({
  firstName: z.string().trim().max(100).optional().default(""),
  lastName: z.string().trim().max(100).optional().default(""),
  phone: z.string().trim().min(1, "Phone is required"),
  email: z.string().trim().max(254).optional().default(""),
  countryCode: z.string().trim().toUpperCase().optional().default(""),
  tags: z.string().optional().default(""),
  voiceConsent: z.boolean().default(false),
  whatsappOptIn: z.boolean().default(false),
  consentSource: z.string().trim().max(200).optional().default(""),
});

export async function createContact(input: z.input<typeof contactInput>): Promise<ActionResult<{ id: string }>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = contactInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    const country = v.countryCode && isCountryCode(v.countryCode) ? v.countryCode : defaultPhoneCountry;
    const phone = normalizePhone(v.phone, country);
    if (!phone.ok) return { ok: false, error: phone.reason };
    if (v.email && !EMAIL_PATTERN.test(v.email)) return { ok: false, error: "Email address is not valid" };
    const consented = v.voiceConsent || v.whatsappOptIn;
    if (consented && !v.consentSource) return { ok: false, error: "Record where consent came from (e.g. web form, signed paper form)." };

    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: userId,
        first_name: v.firstName || null,
        last_name: v.lastName || null,
        phone_e164: phone.e164,
        email: v.email.toLowerCase() || null,
        country_code: phone.country ?? (isCountryCode(v.countryCode) ? v.countryCode : null),
        tags: parseTags(v.tags),
        voice_consent: v.voiceConsent,
        whatsapp_opt_in: v.whatsappOptIn,
        consent_source: v.consentSource || null,
        consent_at: consented ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) return error.code === "23505" ? { ok: false, error: `${phone.e164} is already in your contacts.` } : dbError(error);

    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "contact.created", entityType: "contact", entityId: data.id, metadata: { phone: phone.e164 } });
    revalidatePath("/contacts");
    return { ok: true, data: { id: data.id }, message: "Contact added" };
  });
}

const consentInput = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
  channel: z.enum(["voice", "whatsapp"]),
  value: z.boolean(),
  source: z.string().trim().max(200).optional(),
});

export async function setConsent(input: z.input<typeof consentInput>): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = consentInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const { ids, channel, value, source } = parsed.data;
    if (value && !source) return { ok: false, error: "Record where consent came from before granting it." };
    const patch: Record<string, unknown> = channel === "voice" ? { voice_consent: value } : { whatsapp_opt_in: value };
    if (value) {
      patch.consent_source = source;
      patch.consent_at = new Date().toISOString();
    }
    const { error } = await supabase.from("contacts").update(patch).in("id", ids);
    if (error) return dbError(error);
    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: value ? "contact.consent_granted" : "contact.consent_revoked",
      entityType: "contact",
      entityId: ids.length === 1 ? ids[0] : null,
      metadata: { channel, count: ids.length, source: source ?? null },
    });
    revalidatePath("/contacts");
    return { ok: true, message: `Updated ${ids.length} contact(s)` };
  });
}

export async function addTags(input: { ids: string[]; tags: string }): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const ids = z.array(z.uuid()).min(1).max(1000).safeParse(input.ids);
    const tags = parseTags(input.tags);
    if (!ids.success || tags.length === 0) return { ok: false, error: "Select contacts and enter at least one tag" };
    const { data, error } = await supabase.from("contacts").select("id, tags").in("id", ids.data);
    if (error) return dbError(error);
    for (const row of data ?? []) {
      const merged = [...new Set([...(row.tags as string[]), ...tags])];
      const { error: updateError } = await supabase.from("contacts").update({ tags: merged }).eq("id", row.id);
      if (updateError) return dbError(updateError);
    }
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "contact.tagged", entityType: "contact", metadata: { count: ids.data.length, tags } });
    revalidatePath("/contacts");
    return { ok: true, message: `Tagged ${ids.data.length} contact(s)` };
  });
}

export async function deleteContacts(ids: string[]): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = z.array(z.uuid()).min(1).max(1000).safeParse(ids);
    if (!parsed.success) return { ok: false, error: "Nothing selected" };
    const { error } = await supabase.from("contacts").delete().in("id", parsed.data);
    if (error) return dbError(error);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "contact.deleted", entityType: "contact", metadata: { count: parsed.data.length, ids: parsed.data.slice(0, 50) } });
    revalidatePath("/contacts");
    return { ok: true, message: `Deleted ${parsed.data.length} contact(s)` };
  });
}
