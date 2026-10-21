import { describe, expect, it } from "vitest";
import {
  buildSuppressionIndex,
  checkEligibility,
  computeStats,
  matchesSegment,
  parseSegment,
  parseTemplateVariables,
  renderTemplate,
  resolveTemplateParams,
  type SegmentContact,
} from "@/lib/campaigns/logic";
import { evaluateLiveReadiness, REQUIRED_COMPLIANCE, type ComplianceRecordLike } from "@/lib/compliance/requirements";
import { buildStoragePath, isPathOwnedBy, validateMedia } from "@/lib/media/rules";
import { getVoiceProvider, getWhatsAppProvider } from "@/lib/providers/registry";
import { LiveModeBlockedError } from "@/lib/providers/types";
import { mockVoiceProvider, simulateVoiceOutcome } from "@/lib/providers/voice/mock";
import { countPlaceholders, mockWhatsAppProvider } from "@/lib/providers/whatsapp/mock";

const contact = (over: Partial<SegmentContact> = {}): SegmentContact => ({
  id: "c1",
  phone_e164: "+919876543210",
  first_name: "Asha",
  last_name: "Verma",
  email: null,
  tags: ["vip"],
  voice_consent: true,
  whatsapp_opt_in: true,
  ...over,
});

describe("segments", () => {
  it("parses defensively", () => {
    expect(parseSegment(null)).toEqual({ tags: [], match: "any" });
    expect(parseSegment({ tags: ["a", 3], match: "all" })).toEqual({ tags: ["a"], match: "all" });
  });
  it("matches any/all and treats no tags as everyone", () => {
    expect(matchesSegment(["a"], { tags: [], match: "any" })).toBe(true);
    expect(matchesSegment(["a"], { tags: ["a", "b"], match: "any" })).toBe(true);
    expect(matchesSegment(["a"], { tags: ["a", "b"], match: "all" })).toBe(false);
  });
});

describe("eligibility", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const suppressed = buildSuppressionIndex(
    [
      { phone_e164: "+911", channel: "all", expires_at: null },
      { phone_e164: "+912", channel: "whatsapp", expires_at: null },
      { phone_e164: "+913", channel: "voice", expires_at: "2026-01-01T00:00:00Z" },
    ],
    "voice",
    now,
  );

  it("indexes by channel and drops expired suppressions", () => {
    expect([...suppressed]).toEqual(["+911"]);
  });
  it("suppression beats consent", () => {
    expect(checkEligibility(contact({ phone_e164: "+911" }), "voice", suppressed)).toMatchObject({ status: "skipped_suppressed" });
  });
  it("requires channel-specific consent", () => {
    expect(checkEligibility(contact({ voice_consent: false }), "voice", suppressed)).toMatchObject({ status: "skipped_no_consent" });
    expect(checkEligibility(contact({ voice_consent: false }), "whatsapp", new Set())).toEqual({ eligible: true });
    expect(checkEligibility(contact({ whatsapp_opt_in: false }), "whatsapp", new Set())).toMatchObject({ status: "skipped_no_consent" });
  });
});

describe("stats", () => {
  it("buckets outcomes", () => {
    const stats = computeStats(["answered", "voicemail", "busy", "no_answer", "failed", "skipped_suppressed", "skipped_no_consent", "pending"]);
    expect(stats).toMatchObject({ total: 8, attempted: 5, succeeded: 2, failed: 3, skipped: 2 });
    expect(stats.byStatus.busy).toBe(1);
  });
});

describe("templates", () => {
  it("resolves variables with fallbacks and renders", () => {
    const vars = parseTemplateVariables([
      { source: "field", field: "first_name", fallback: "there" },
      { source: "static", value: "Friday 5pm" },
      { source: "field", field: "drop_table" },
    ]);
    expect(vars).toHaveLength(2);
    expect(resolveTemplateParams(vars, contact())).toEqual(["Asha", "Friday 5pm"]);
    expect(resolveTemplateParams(vars, contact({ first_name: null }))).toEqual(["there", "Friday 5pm"]);
    expect(renderTemplate("Hi {{1}}, see you {{2}} {{3}}", ["Asha", "Friday"])).toBe("Hi Asha, see you Friday {{3}}");
    expect(countPlaceholders("{{1}} {{2}} {{1}}")).toBe(2);
  });
});

describe("live-mode gate", () => {
  const verified = (channel: "voice" | "whatsapp"): ComplianceRecordLike[] =>
    REQUIRED_COMPLIANCE[channel].map((record_type) => ({ channel, record_type, status: "verified", expires_at: null }));

  it("is blocked by default", () => {
    const r = evaluateLiveReadiness({ channel: "voice", envFlagEnabled: false, providerId: "mock", liveAdapterAvailable: false, records: [] });
    expect(r.ready).toBe(false);
    expect(r.checks.filter((c) => !c.ok)).toHaveLength(2 + REQUIRED_COMPLIANCE.voice.length);
  });

  it("needs the flag AND an adapter AND every record", () => {
    const base = { channel: "voice" as const, providerId: "twilio", records: verified("voice") };
    expect(evaluateLiveReadiness({ ...base, envFlagEnabled: true, liveAdapterAvailable: true }).ready).toBe(true);
    expect(evaluateLiveReadiness({ ...base, envFlagEnabled: false, liveAdapterAvailable: true }).ready).toBe(false);
    expect(evaluateLiveReadiness({ ...base, envFlagEnabled: true, liveAdapterAvailable: false }).ready).toBe(false);
    expect(evaluateLiveReadiness({ ...base, records: verified("voice").slice(1), envFlagEnabled: true, liveAdapterAvailable: true }).ready).toBe(false);
  });

  it("does not accept the other channel's records or expired ones", () => {
    const input = { channel: "whatsapp" as const, envFlagEnabled: true, providerId: "meta", liveAdapterAvailable: true };
    expect(evaluateLiveReadiness({ ...input, records: verified("voice") }).ready).toBe(false);
    const expired = verified("whatsapp").map((r) => ({ ...r, expires_at: "2020-01-01T00:00:00Z" }));
    const result = evaluateLiveReadiness({ ...input, records: expired });
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === "provider_approval")?.detail).toMatch(/expired/);
  });

  it("registry refuses live providers without readiness", () => {
    expect(getVoiceProvider("simulation", "twilio").id).toBe("mock");
    expect(() => getVoiceProvider("live", "twilio")).toThrow(LiveModeBlockedError);
    const ready = { channel: "whatsapp" as const, ready: true, checks: [] };
    // Even a "ready" gate can't conjure an adapter that isn't registered.
    expect(() => getWhatsAppProvider("live", "meta_cloud", ready)).toThrow(/No live WhatsApp adapter/);
    expect(() => getVoiceProvider("live", "x", ready as never)).toThrow(LiveModeBlockedError);
  });
});

describe("mock providers", () => {
  it("voice outcomes are deterministic and honour magic suffixes", async () => {
    const req = { to: "+919876543210", from: null, audioUrl: null, audioDurationSeconds: 40, campaignId: "camp", recipientId: "r" };
    const a = await mockVoiceProvider.placeCall(req);
    const b = await mockVoiceProvider.placeCall(req);
    expect(a).toEqual(b);
    expect(a.raw.simulated).toBe(true);
    expect(simulateVoiceOutcome({ to: "+14155550003", campaignId: "x" })).toBe("busy");
    expect((await mockVoiceProvider.placeCall({ ...req, to: "+14155550009" })).errorCode).toBe("SIM-503");
  });

  it("voice outcome mix is roughly as configured", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const o = simulateVoiceOutcome({ to: `+9198765${String(i).padStart(5, "0")}`, campaignId: "mix" });
      counts[o] = (counts[o] ?? 0) + 1;
    }
    expect(counts.answered / 2000).toBeGreaterThan(0.5);
    expect(counts.answered / 2000).toBeLessThan(0.75);
  });

  it("whatsapp validates templates like the Cloud API", async () => {
    const base = { to: "+919876540001", campaignId: "c", recipientId: "r", headerMedia: null };
    const ok = await mockWhatsAppProvider.sendTemplate({ ...base, template: { name: "order_update", language: "en" }, bodyParams: ["A", "B", "C"] });
    expect(ok.status).toBe("read");
    expect(ok.events.map((e) => e.status)).toEqual(["sent", "delivered", "read"]);

    const wrongParams = await mockWhatsAppProvider.sendTemplate({ ...base, template: { name: "order_update", language: "en" }, bodyParams: ["A"] });
    expect(wrongParams.errorCode).toBe("132000");

    const missingMedia = await mockWhatsAppProvider.sendTemplate({ ...base, template: { name: "seasonal_offer_image", language: "en" }, bodyParams: ["A", "B"] });
    expect(missingMedia.errorCode).toBe("132012");

    const pending = await mockWhatsAppProvider.sendTemplate({ ...base, template: { name: "festival_greetings_hi", language: "hi" }, bodyParams: ["A"], headerMedia: { type: "image", url: "x" } });
    expect(pending.errorCode).toBe("132015");
  });
});

describe("media rules", () => {
  it("validates kind, extension, size and duration", () => {
    expect(validateMedia({ fileName: "msg.mp3", mimeType: "audio/mpeg", sizeBytes: 1000, durationSeconds: 30 })).toEqual({ ok: true, kind: "audio" });
    expect(validateMedia({ fileName: "msg.mp3", mimeType: "audio/mpeg", sizeBytes: 1000 }, "image").ok).toBe(false);
    expect(validateMedia({ fileName: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 10 }).ok).toBe(false);
    expect(validateMedia({ fileName: "pic.gif", mimeType: "image/png", sizeBytes: 10 }).ok).toBe(false);
    expect(validateMedia({ fileName: "pic.png", mimeType: "image/png", sizeBytes: 6 * 1024 * 1024 }).ok).toBe(false);
    expect(validateMedia({ fileName: "a.wav", mimeType: "audio/wav", sizeBytes: 10, durationSeconds: 301 }).ok).toBe(false);
    expect(validateMedia({ fileName: "v.mp4", mimeType: "video/mp4", sizeBytes: 0 }).ok).toBe(false);
  });

  it("builds owner-scoped storage paths", () => {
    const path = buildStoragePath("u1", "image", "../../My Photo (1).PNG", "abc");
    expect(path).toBe("u1/image/abc-My-Photo-1.png");
    expect(isPathOwnedBy(path, "u1")).toBe(true);
    expect(isPathOwnedBy(path, "u2")).toBe(false);
    expect(isPathOwnedBy("u1/../u2/image/x.png", "u1")).toBe(false);
  });
});
