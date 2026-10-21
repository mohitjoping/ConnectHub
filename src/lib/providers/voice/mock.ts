import { bucket, fakeId, weightedPick } from "../deterministic";
import type { VoiceCallRequest, VoiceCallResult, VoiceOutcome, VoiceProvider } from "../types";

// Outcome mix for simulated calls (weights sum to 100).
const OUTCOMES: readonly (readonly [VoiceOutcome, number])[] = [
  ["answered", 62],
  ["voicemail", 8],
  ["no_answer", 17],
  ["busy", 7],
  ["failed", 6],
];

/**
 * Magic suffixes force an outcome so demos and tests are predictable:
 *   …0001 answered · …0002 no_answer · …0003 busy · …0004 voicemail · …0009 failed
 */
const FORCED: Record<string, VoiceOutcome> = {
  "0001": "answered",
  "0002": "no_answer",
  "0003": "busy",
  "0004": "voicemail",
  "0009": "failed",
};

export function simulateVoiceOutcome(request: Pick<VoiceCallRequest, "to" | "campaignId">): VoiceOutcome {
  return FORCED[request.to.slice(-4)] ?? weightedPick(`${request.campaignId}:${request.to}`, OUTCOMES);
}

export const mockVoiceProvider: VoiceProvider = {
  id: "mock",
  displayName: "Mock voice provider (simulation)",
  mode: "simulation",

  async placeCall(request: VoiceCallRequest): Promise<VoiceCallResult> {
    const seed = `${request.campaignId}:${request.to}`;
    const status = simulateVoiceOutcome(request);
    const audioLength = Math.max(5, Math.round(request.audioDurationSeconds ?? 30));
    const durationSeconds =
      status === "answered"
        ? Math.max(3, Math.round(audioLength * (0.4 + bucket(`${seed}:listen`) / 166)))
        : status === "voicemail"
          ? audioLength
          : 0;

    const failure =
      status === "failed"
        ? { errorCode: "SIM-503", errorMessage: "Simulated carrier failure" }
        : status === "busy"
          ? { errorCode: "SIM-486", errorMessage: "Simulated busy signal" }
          : {};

    return {
      status,
      providerCallId: fakeId("simcall", seed),
      durationSeconds,
      ...failure,
      raw: { simulated: true, to: request.to, from: request.from, audio: Boolean(request.audioUrl) },
    };
  },
};
