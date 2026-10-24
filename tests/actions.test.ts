import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeDb } from "./helpers/fake-supabase";

// Server actions read the session from cookies and revalidate Next's cache;
// both are swapped for test doubles so the action bodies run as written.
let db: FakeDb;
const OWNER = "owner-1";
vi.mock("@/lib/auth", () => ({
  getSessionOrNull: async () => ({ supabase: db.client, userId: OWNER, email: "owner@example.com" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { importChunk, startImport, finishImport, findExistingPhones } = await import("@/lib/actions/imports");
const { addSuppressions, removeSuppression } = await import("@/lib/actions/compliance");
const { saveCampaign, cancelCampaign, deleteCampaign } = await import("@/lib/actions/campaigns");
const { createContact, setConsent } = await import("@/lib/actions/contacts");

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const baseChunk = {
  importId: IMPORT_ID,
  fileName: "leads.csv",
  headers: ["Name", "Phone", "Tags", "WhatsApp"],
  firstRowNumber: 2,
  skipRowNumbers: [] as number[],
  mapping: { fullName: 0, phone: 1, tags: 2, whatsappOptIn: 3 },
  defaultCountry: "IN",
  keepUnmappedAsAttributes: false,
  extraTags: [] as string[],
  strategy: "skip" as "skip" | "update",
  consentAttestation: { voice: false, whatsapp: false, source: "" },
};

beforeEach(() => {
  db = createFakeSupabase({
    contacts: [
      {
        id: "existing-1",
        owner_id: OWNER,
        phone_e164: "+919876501234",
        first_name: "Ravi",
        last_name: "Kumar",
        email: "ravi@x.com",
        country_code: "IN",
        tags: ["vip"],
        attributes: {},
        voice_consent: true,
        whatsapp_opt_in: true,
        consent_source: "Signed form",
        consent_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    contact_imports: [{ id: IMPORT_ID, owner_id: OWNER, status: "processing" }],
    audit_logs: [],
    suppression_records: [],
    campaigns: [],
    compliance_records: [],
  });
});

const contactByPhone = (phone: string) => db.tables.contacts.find((c) => c.phone_e164 === phone) as Record<string, unknown> | undefined;

describe("import actions", () => {
  const rows = [
    ["Asha Verma", "98765 43210", "new", "yes"],
    ["Ravi K.", "+91 98765 01234", "mumbai", "no"], // already a contact
    ["Broken", "123", "", ""],
    ["Asha dup", "09876543210", "", ""], // same as row 2
  ];

  it("starts an import only with a phone mapping", async () => {
    expect(await startImport({ fileName: "x.csv", source: "csv", totalRows: 3, mapping: { email: 0 } })).toMatchObject({ ok: false, error: expect.stringMatching(/Phone/) });
    const ok = await startImport({ fileName: "x.csv", source: "csv", totalRows: 3, mapping: { phone: 0, bogus: 1 } as never });
    expect(ok.ok).toBe(true);
    expect(db.tables.contact_imports.at(-1)?.column_mapping).toEqual({ phone: 0 });
  });

  it("skip strategy: inserts new rows, leaves existing contacts alone, counts problems", async () => {
    const r = await importChunk({ ...baseChunk, rows });
    expect(r).toMatchObject({ ok: true, data: { imported: 1, updated: 0, duplicates: 2, invalid: 1 } });
    expect(r.ok && r.data?.errors[0]).toMatchObject({ row: 4, field: "phone" });

    expect(contactByPhone("+919876543210")).toMatchObject({ first_name: "Asha", last_name: "Verma", tags: ["new"], whatsapp_opt_in: true, voice_consent: false, import_id: IMPORT_ID });
    expect(contactByPhone("+919876501234")).toMatchObject({ first_name: "Ravi", tags: ["vip"], whatsapp_opt_in: true });
  });

  it("update strategy: merges into existing contacts and honours an explicit opt-out", async () => {
    const r = await importChunk({ ...baseChunk, rows, strategy: "update" });
    expect(r).toMatchObject({ ok: true, data: { imported: 1, updated: 1, duplicates: 1 } });
    expect(contactByPhone("+919876501234")).toMatchObject({
      first_name: "Ravi",
      last_name: "K.",
      tags: ["vip", "mumbai"],
      voice_consent: true, // column not in file → unchanged
      whatsapp_opt_in: false, // file said "no"
      consent_source: "Signed form", // not newly consented → kept
      email: "ravi@x.com",
    });
  });

  it("applies bulk consent attestation only where the file is silent", async () => {
    const r = await importChunk({
      ...baseChunk,
      rows: [
        ["A", "+14155552671", "", ""],
        ["B", "+14155552672", "", "no"],
      ],
      consentAttestation: { voice: true, whatsapp: true, source: "Expo sign-up sheet" },
    });
    expect(r.ok).toBe(true);
    expect(contactByPhone("+14155552671")).toMatchObject({ voice_consent: true, whatsapp_opt_in: true, consent_source: "Expo sign-up sheet" });
    expect(contactByPhone("+14155552672")).toMatchObject({ voice_consent: true, whatsapp_opt_in: false });
  });

  it("requires a consent source before attesting", async () => {
    const r = await importChunk({ ...baseChunk, rows, consentAttestation: { voice: true, whatsapp: false, source: "" } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/where consent was collected/) });
    expect(db.tables.contacts).toHaveLength(1);
  });

  it("treats rows the browser flagged as cross-chunk duplicates as duplicates", async () => {
    const r = await importChunk({ ...baseChunk, rows: [["Late dup", "+14155552679", "", ""]], firstRowNumber: 1002, skipRowNumbers: [1002] });
    expect(r).toMatchObject({ ok: true, data: { imported: 0, duplicates: 1 } });
  });

  it("rejects chunks for finished imports and oversized payloads", async () => {
    db.tables.contact_imports[0].status = "completed";
    expect(await importChunk({ ...baseChunk, rows })).toMatchObject({ ok: false, error: expect.stringMatching(/already finished/) });
    expect((await importChunk({ ...baseChunk, rows: Array.from({ length: 2001 }, () => ["a", "1"]) })).ok).toBe(false);
  });

  it("finishes with a status and an audit entry", async () => {
    await finishImport({ importId: IMPORT_ID, imported: 5, updated: 0, duplicates: 1, invalid: 2, errors: [] });
    expect(db.tables.contact_imports[0]).toMatchObject({ status: "partial", imported_rows: 5, invalid_rows: 2 });
    expect(db.tables.audit_logs[0]).toMatchObject({ action: "contacts.imported", actor_id: OWNER });
  });

  it("looks up existing phones and validates the list", async () => {
    expect(await findExistingPhones(["+919876501234", "+14155550000"])).toEqual({ ok: true, data: ["+919876501234"] });
    expect((await findExistingPhones(["not-a-phone"])).ok).toBe(false);
  });
});

describe("contact actions", () => {
  it("requires a consent source when consent is granted", async () => {
    expect(await createContact({ phone: "98765 11111", voiceConsent: true })).toMatchObject({ ok: false });
    const ok = await createContact({ phone: "98765 11111", voiceConsent: true, consentSource: "Web form" });
    expect(ok.ok).toBe(true);
    expect(contactByPhone("+919876511111")).toMatchObject({ voice_consent: true, consent_source: "Web form" });
  });

  it("reports duplicates by number", async () => {
    expect(await createContact({ phone: "+91 98765 01234" })).toMatchObject({ ok: false, error: expect.stringMatching(/already in your contacts/) });
  });

  it("revokes consent without a source and audits it", async () => {
    const r = await setConsent({ ids: ["00000000-0000-4000-8000-000000000999"], channel: "voice", value: false });
    expect(r.ok).toBe(true);
    expect(db.tables.audit_logs.at(-1)).toMatchObject({ action: "contact.consent_revoked" });
    expect((await setConsent({ ids: ["00000000-0000-4000-8000-000000000999"], channel: "voice", value: true })).ok).toBe(false);
  });
});

describe("suppression actions", () => {
  it("normalises, de-duplicates and reports invalid numbers", async () => {
    const r = await addSuppressions({ phones: "+91 98765 43210\n9876543210, 12\n+14155552671", channel: "whatsapp", reason: "opt_out" });
    expect(r).toMatchObject({ ok: true, data: { added: 2, invalid: ["12"] } });
    expect(db.tables.suppression_records.map((s) => s.phone_e164).sort()).toEqual(["+14155552671", "+919876543210"]);
    expect(db.tables.audit_logs.at(-1)).toMatchObject({ action: "suppression.added" });
  });

  it("removes a record and audits the removal", async () => {
    await addSuppressions({ phones: "+14155552671", channel: "all", reason: "manual" });
    const id = db.tables.suppression_records[0].id as string;
    expect(await removeSuppression(id)).toMatchObject({ ok: true });
    expect(db.tables.suppression_records).toHaveLength(0);
    expect(db.tables.audit_logs.at(-1)).toMatchObject({ action: "suppression.removed" });
  });
});

describe("campaign actions", () => {
  const draft = {
    channel: "voice" as const,
    name: "Test",
    segment: { tags: [], match: "any" as const },
    mode: "simulation" as const,
    mediaAssetId: null,
    templateName: null,
    templateLanguage: null,
    templateVariables: [],
  };

  it("saves simulation drafts on the mock provider", async () => {
    const r = await saveCampaign({ ...draft, callerId: "022 1234 5678" });
    expect(r.ok).toBe(true);
    expect(db.tables.campaigns[0]).toMatchObject({ mode: "simulation", provider: "mock", caller_id: expect.stringMatching(/^\+/) });
  });

  it("refuses to save a live campaign while live mode is locked", async () => {
    const r = await saveCampaign({ ...draft, mode: "live" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Live mode is locked/) });
    expect(db.tables.campaigns).toHaveLength(0);
  });

  it("won't delete a campaign that has run", async () => {
    const created = await saveCampaign(draft);
    const id = created.ok ? created.data!.id : "";
    db.tables.campaigns[0].started_at = "2026-10-01T00:00:00Z";
    db.tables.campaigns[0].status = "completed";
    expect(await deleteCampaign(id)).toMatchObject({ ok: false, error: expect.stringMatching(/audit trail/) });
    expect(await cancelCampaign(id)).toMatchObject({ ok: false });
  });
});
