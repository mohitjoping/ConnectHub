import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliveryEnv } from "@/lib/env";
import { hasLiveAdapter } from "@/lib/providers/registry";
import type { Channel } from "@/lib/providers/types";
import { evaluateLiveReadiness, type ComplianceRecordLike, type LiveReadiness } from "./requirements";

export async function getLiveReadiness(supabase: SupabaseClient, ownerId: string, channel: Channel): Promise<LiveReadiness> {
  const env = deliveryEnv();
  const providerId = channel === "voice" ? env.voiceProvider : env.whatsappProvider;
  const { data } = await supabase
    .from("compliance_records")
    .select("channel, record_type, status, expires_at")
    .eq("owner_id", ownerId)
    .eq("channel", channel);

  return evaluateLiveReadiness({
    channel,
    envFlagEnabled: channel === "voice" ? env.liveVoiceEnabled : env.liveWhatsAppEnabled,
    providerId,
    liveAdapterAvailable: hasLiveAdapter(channel, providerId),
    records: (data ?? []) as ComplianceRecordLike[],
  });
}

export async function getAllReadiness(supabase: SupabaseClient, ownerId: string) {
  const [voice, whatsapp] = await Promise.all([
    getLiveReadiness(supabase, ownerId, "voice"),
    getLiveReadiness(supabase, ownerId, "whatsapp"),
  ]);
  return { voice, whatsapp };
}

export function configuredProvider(channel: Channel): string {
  const env = deliveryEnv();
  return channel === "voice" ? env.voiceProvider : env.whatsappProvider;
}
