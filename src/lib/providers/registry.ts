import type { LiveReadiness } from "@/lib/compliance/requirements";
import { mockVoiceProvider } from "./voice/mock";
import { mockWhatsAppProvider } from "./whatsapp/mock";
import { LiveModeBlockedError, type DeliveryMode, type VoiceProvider, type WhatsAppProvider } from "./types";

/**
 * Live adapters are registered here by provider id. None ship enabled: to add
 * one, implement VoiceProvider / WhatsAppProvider (see README "Adding a live
 * provider"), register a factory below, and set VOICE_PROVIDER / WHATSAPP_PROVIDER.
 * Factories run only after the full live-readiness gate passes.
 */
const liveVoiceAdapters: Record<string, () => VoiceProvider> = {
  // twilio: () => createTwilioVoiceProvider({ accountSid, authToken, from }),
};

const liveWhatsAppAdapters: Record<string, () => WhatsAppProvider> = {
  // meta_cloud: () => createMetaCloudProvider({ phoneNumberId, accessToken, wabaId }),
};

export function hasLiveAdapter(channel: "voice" | "whatsapp", providerId: string): boolean {
  const registry = channel === "voice" ? liveVoiceAdapters : liveWhatsAppAdapters;
  return Object.hasOwn(registry, providerId);
}

export function getVoiceProvider(mode: DeliveryMode, providerId: string, readiness?: LiveReadiness): VoiceProvider {
  if (mode === "simulation") return mockVoiceProvider;
  if (!readiness?.ready || readiness.channel !== "voice") {
    throw new LiveModeBlockedError("Live calling is disabled: the live-readiness checklist is not complete.");
  }
  const factory = liveVoiceAdapters[providerId];
  if (!factory) throw new LiveModeBlockedError(`No live voice adapter registered for "${providerId}".`);
  return factory();
}

export function getWhatsAppProvider(mode: DeliveryMode, providerId: string, readiness?: LiveReadiness): WhatsAppProvider {
  if (mode === "simulation") return mockWhatsAppProvider;
  if (!readiness?.ready || readiness.channel !== "whatsapp") {
    throw new LiveModeBlockedError("Live WhatsApp messaging is disabled: the live-readiness checklist is not complete.");
  }
  const factory = liveWhatsAppAdapters[providerId];
  if (!factory) throw new LiveModeBlockedError(`No live WhatsApp adapter registered for "${providerId}".`);
  return factory();
}

/** Template catalogue always comes from the configured provider's account. */
export async function listWhatsAppTemplates(mode: DeliveryMode, providerId: string, readiness?: LiveReadiness) {
  return getWhatsAppProvider(mode, providerId, readiness).listTemplates();
}
