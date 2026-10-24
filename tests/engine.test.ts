import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignRunError, dispatchDueCampaigns, estimateAudience, preflight, runCampaign } from "@/lib/campaigns/engine";
import { REQUIRED_COMPLIANCE } from "@/lib/compliance/requirements";
import type { Campaign } from "@/lib/types";
import { createFakeSupabase, type FakeDb } from "./helpers/fake-supabase";

const OWNER = "owner-1";

const contact = (id: string, phone: string, over: Record<string, unknown> = {}) => ({
  id,
  owner_id: OWNER,
  phone_e164: phone,
  first_name: id.toUpperCase(),
  last_name: null,
  email: null,
  tags: ["vip"],
  voice_consent: true,
  whatsapp_opt_in: true,
  created_at: `2026-10-01T00:00:0${id.slice(1)}Z`,
  ...over,
});

const campaign = (over: Partial<Campaign> & { id: string; channel: Campaign["channel"] }) => ({
  owner_id: OWNER,
  name: over.id,
  description: null,
  status: "draft",
  mode: "simulation",
  provider: "mock",
  segment: { tags: ["vip"], match: "any" },
  media_asset_id: null,
  caller_id: null,
  whatsapp_template_name: null,
  whatsapp_template_language: null,
  template_variables: [],
  scheduled_at: null,
  started_at: null,
  completed_at: null,
  stats: {},
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

function seed() {
  return createFakeSupabase({
    contacts: [
      contact("c1", "+919876540001"), // forced answered / read
      contact("c2", "+919876540002", { whatsapp_opt_in: false }), // no_answer / skipped
      contact("c3", "+919876540003", { voice_consent: false }), // skipped / sent
      contact("c4", "+919876540009", { first_name: null, tags: ["vip", "mumbai"] }), // failed / failed
      contact("c5", "+919876540004"), // suppressed in both channels
      contact("c6", "+919876549999", { tags: ["other"] }), // outside the segment
    ],
    suppression_records: [{ id: "s1", owner_id: OWNER, phone_e164: "+919876540004", channel: "all", expires_at: null }],
    media_assets: [
      { id: "a1", owner_id: OWNER, kind: "audio", file_name: "msg.mp3", storage_path: `${OWNER}/audio/a1-msg.mp3`, duration_seconds: 30 },
      { id: "a2", owner_id: OWNER, kind: "audio", file_name: "gone.mp3", storage_path: `${OWNER}/audio/missing.mp3`, duration_seconds: 10 },
      { id: "i1", owner_id: OWNER, kind: "image", file_name: "offer.png", storage_path: `${OWNER}/image/i1-offer.png` },
    ],
    campaigns: [
      campaign({ id: "voice-1", channel: "voice", media_asset_id: "a1", caller_id: "+912212345678" }),
      campaign({
        id: "wa-1",
        channel: "whatsapp",
        media_asset_id: "i1",
        whatsapp_template_name: "seasonal_offer_image",
        whatsapp_template_language: "en",
        template_variables: [
          { source: "field", field: "first_name", fallback: "there" },
          { source: "static", value: "Diwali" },
        ],
      }),
    ],
    compliance_records: [],
    campaign_recipients: [],
    delivery_attempts: [],
    audit_logs: [],
  });
}

const row = (db: FakeDb, table: string, id: string) => db.tables[table].find((r) => r.id === id) as Record<string, unknown>;
const recipientsByPhone = (db: FakeDb, campaignId: string) =>
  Object.fromEntries(db.tables.campaign_recipients.filter((r) => r.campaign_id === campaignId).map((r) => [r.phone_e164, r.status]));

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCampaign — phone calls", () => {
  it("snapshots the segment, skips ineligible contacts and records every attempt", async () => {
    const db = seed();
    const stats = await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" });

    expect(recipientsByPhone(db, "voice-1")).toEqual({
      "+919876540001": "answered",
      "+919876540002": "no_answer",
      "+919876540003": "skipped_no_consent",
      "+919876540009": "failed",
      "+919876540004": "skipped_suppressed",
    });
    expect(stats).toMatchObject({ total: 5, attempted: 3, succeeded: 1, failed: 2, skipped: 2 });

    const attempts = db.tables.delivery_attempts;
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.mode === "simulation" && a.provider === "mock" && a.channel === "voice")).toBe(true);
    const answered = attempts.find((a) => (a.request_payload as { to: string }).to === "+919876540001")!;
    expect(answered.duration_seconds).toBeGreaterThan(0);
    expect(answered.request_payload).toMatchObject({ from: "+912212345678", media_asset_id: "a1" });
    expect(attempts.find((a) => a.status === "failed")?.error_code).toBe("SIM-503");

    const done = row(db, "campaigns", "voice-1");
    expect(done.status).toBe("completed");
    expect(done.started_at).toBeTruthy();
    expect(done.stats).toMatchObject({ provider: "mock", mode: "simulation", trigger: "manual", total: 5 });

    expect(db.tables.audit_logs).toEqual([
      expect.objectContaining({ action: "campaign.run_simulation", entity_id: "voice-1", actor_id: OWNER, owner_id: OWNER }),
    ]);
  });

  it("records a skip reason on skipped recipients", async () => {
    const db = seed();
    await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" });
    const skipped = db.tables.campaign_recipients.find((r) => r.phone_e164 === "+919876540003")!;
    expect(skipped.status_reason).toMatch(/voice call consent/);
    expect(skipped.attempt_count).toBe(0);
  });

  it("refuses to run a campaign twice", async () => {
    const db = seed();
    await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" });
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/completed/);
    expect(db.tables.delivery_attempts).toHaveLength(3);
  });

  it("lets only one of two simultaneous runs claim the campaign", async () => {
    const db = seed();
    const results = await Promise.allSettled([
      runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" }),
      runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "schedule" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CampaignRunError);
    expect(db.tables.delivery_attempts).toHaveLength(3);
  });

  it("requires an audio file", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").media_asset_id = null;
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/audio file/);
    expect(row(db, "campaigns", "voice-1").status).toBe("draft");
  });

  it("rejects an image where audio is required", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").media_asset_id = "i1";
    const check = await preflight(db.client, row(db, "campaigns", "voice-1") as unknown as Campaign);
    expect(check.problems).toContain("Voice campaigns need an audio file.");
  });

  it("marks the campaign failed when the media file is gone from storage", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").media_asset_id = "a2";
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/missing from storage/);
    expect(row(db, "campaigns", "voice-1")).toMatchObject({ status: "failed", stats: { error: expect.stringMatching(/missing/) } });
    expect(db.tables.audit_logs.at(-1)).toMatchObject({ action: "campaign.run_failed" });
    expect(db.tables.delivery_attempts).toHaveLength(0);
  });

  it("fails cleanly when nobody matches the segment", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").segment = { tags: ["nobody"], match: "any" };
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/No contacts match/);
    expect(row(db, "campaigns", "voice-1").status).toBe("failed");
  });

  it("marks the campaign failed if attempts can't be saved", async () => {
    const db = seed();
    db.failNextWrite.delivery_attempts = "disk full";
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/disk full/);
    expect(row(db, "campaigns", "voice-1").status).toBe("failed");
  });

  it("honours 'match all' segments", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").segment = { tags: ["vip", "mumbai"], match: "all" };
    const stats = await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" });
    expect(stats.total).toBe(1);
    expect(Object.keys(recipientsByPhone(db, "voice-1"))).toEqual(["+919876540009"]);
  });

  it("targets everyone when the segment has no tags", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").segment = { tags: [], match: "any" };
    expect((await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).total).toBe(6);
  });

  it("ignores expired suppressions", async () => {
    const db = seed();
    db.tables.suppression_records[0].expires_at = "2020-01-01T00:00:00Z";
    await runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" });
    expect(recipientsByPhone(db, "voice-1")["+919876540004"]).not.toBe("skipped_suppressed");
  });
});

describe("runCampaign — WhatsApp", () => {
  it("sends the template with resolved variables and the header image", async () => {
    const db = seed();
    const stats = await runCampaign(db.client, "wa-1", { actorId: OWNER, trigger: "manual" });

    expect(recipientsByPhone(db, "wa-1")).toEqual({
      "+919876540001": "read",
      "+919876540002": "skipped_no_consent",
      "+919876540003": "sent",
      "+919876540009": "failed",
      "+919876540004": "skipped_suppressed",
    });
    expect(stats).toMatchObject({ total: 5, attempted: 3, succeeded: 2, failed: 1, skipped: 2 });

    const byTo = (to: string) => db.tables.delivery_attempts.find((a) => (a.request_payload as { to: string }).to === to)!;
    expect(byTo("+919876540001").request_payload).toMatchObject({ template: "seasonal_offer_image", params: ["C1", "Diwali"] });
    expect(byTo("+919876540009").request_payload).toMatchObject({ params: ["there", "Diwali"] }); // fallback for missing name
    expect((byTo("+919876540001").response_payload as { events: { status: string }[] }).events.map((e) => e.status)).toEqual(["sent", "delivered", "read"]);
    expect((byTo("+919876540001").response_payload as { media: string }).media).toBe("image");
    expect(String(byTo("+919876540001").provider_message_id)).toMatch(/^wamid\.SIM_/);
  });

  it("blocks a template whose variables don't line up", async () => {
    const db = seed();
    row(db, "campaigns", "wa-1").template_variables = [{ source: "static", value: "x" }];
    await expect(runCampaign(db.client, "wa-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/needs 2 variable/);
    expect(row(db, "campaigns", "wa-1").status).toBe("draft");
  });

  it("blocks a missing header image and an unapproved template", async () => {
    const db = seed();
    row(db, "campaigns", "wa-1").media_asset_id = null;
    expect((await preflight(db.client, row(db, "campaigns", "wa-1") as unknown as Campaign)).problems).toContain("This template needs an image header.");

    Object.assign(row(db, "campaigns", "wa-1"), { whatsapp_template_name: "festival_greetings_hi", whatsapp_template_language: "hi", media_asset_id: "i1", template_variables: [{ source: "static", value: "x" }] });
    expect((await preflight(db.client, row(db, "campaigns", "wa-1") as unknown as Campaign)).problems.join(" ")).toMatch(/pending, not approved/);
  });
});

describe("live mode stays locked", () => {
  it("refuses a live campaign by default and sends nothing", async () => {
    const db = seed();
    row(db, "campaigns", "voice-1").mode = "live";
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(/Live mode is not permitted/);
    expect(row(db, "campaigns", "voice-1").status).toBe("draft");
    expect(db.tables.campaign_recipients).toHaveLength(0);
    expect(db.tables.delivery_attempts).toHaveLength(0);
  });

  it("stays locked even with the env flag on and every record verified, because no live adapter exists", async () => {
    vi.stubEnv("LIVE_VOICE_ENABLED", "true");
    vi.stubEnv("VOICE_PROVIDER", "twilio");
    const db = seed();
    db.tables.compliance_records = REQUIRED_COMPLIANCE.voice.map((record_type, i) => ({ id: `r${i}`, owner_id: OWNER, channel: "voice", record_type, status: "verified", expires_at: null }));
    Object.assign(row(db, "campaigns", "voice-1"), { mode: "live", provider: "twilio" });
    await expect(runCampaign(db.client, "voice-1", { actorId: OWNER, trigger: "manual" })).rejects.toThrow(CampaignRunError);
    expect(db.tables.delivery_attempts).toHaveLength(0);
  });
});

describe("estimateAudience", () => {
  it("counts eligible, unconsented and suppressed contacts per channel", async () => {
    const db = seed();
    expect(await estimateAudience(db.client, OWNER, "voice", { tags: ["vip"], match: "any" })).toEqual({ total: 5, eligible: 3, suppressed: 1, noConsent: 1, overLimit: false });
    expect(await estimateAudience(db.client, OWNER, "whatsapp", { tags: ["vip"], match: "any" })).toEqual({ total: 5, eligible: 3, suppressed: 1, noConsent: 1, overLimit: false });
    expect((await estimateAudience(db.client, OWNER, "voice", null)).total).toBe(6);
  });
});

describe("dispatchDueCampaigns", () => {
  it("runs only scheduled campaigns whose time has passed", async () => {
    const db = seed();
    Object.assign(row(db, "campaigns", "voice-1"), { status: "scheduled", scheduled_at: "2026-01-01T00:00:00Z" });
    Object.assign(row(db, "campaigns", "wa-1"), { status: "scheduled", scheduled_at: "2999-01-01T00:00:00Z" });
    const results = await dispatchDueCampaigns(db.client, null, null);
    expect(results).toEqual([{ id: "voice-1", ok: true }]);
    expect(row(db, "campaigns", "voice-1").status).toBe("completed");
    expect(row(db, "campaigns", "wa-1").status).toBe("scheduled");
    expect(db.tables.audit_logs[0]).toMatchObject({ action: "campaign.run_simulation", actor_id: null, metadata: expect.objectContaining({ trigger: "schedule" }) });
  });

  it("reports a failing due campaign without stopping the others", async () => {
    const db = seed();
    Object.assign(row(db, "campaigns", "voice-1"), { status: "scheduled", scheduled_at: "2026-01-01T00:00:00Z", media_asset_id: "a2" });
    Object.assign(row(db, "campaigns", "wa-1"), { status: "scheduled", scheduled_at: "2026-01-02T00:00:00Z" });
    const results = await dispatchDueCampaigns(db.client, OWNER, null);
    expect(results).toEqual([
      { id: "voice-1", ok: false, error: expect.stringMatching(/missing/) },
      { id: "wa-1", ok: true },
    ]);
  });
});
