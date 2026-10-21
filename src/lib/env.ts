// Central place for environment variables. NEXT_PUBLIC_* values are inlined
// at build time; everything else is read on the server only.

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Supabase's new "publishable" key and the legacy "anon" key both work.
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const defaultPhoneCountry = (process.env.NEXT_PUBLIC_DEFAULT_PHONE_COUNTRY ?? "IN").toUpperCase();

const flag = (value: string | undefined) => value?.trim().toLowerCase() === "true";

/** Server-only: live delivery switches. Both default to OFF. */
export function deliveryEnv() {
  return {
    liveVoiceEnabled: flag(process.env.LIVE_VOICE_ENABLED),
    liveWhatsAppEnabled: flag(process.env.LIVE_WHATSAPP_ENABLED),
    voiceProvider: process.env.VOICE_PROVIDER?.trim() || "mock",
    whatsappProvider: process.env.WHATSAPP_PROVIDER?.trim() || "mock",
  };
}
