import { describe, expect, it } from "vitest";
import { normalizePhone, parseBoolean, parseTags, splitFullName, validateRow } from "@/lib/import/validate";

describe("normalizePhone", () => {
  it.each([
    ["+91 98765 43210", null, "+919876543210"],
    ["098765 43210", "IN", "+919876543210"],
    ["9876543210", "IN", "+919876543210"],
    ["919876543210", null, "+919876543210"],
    ["0091-98765-43210", null, "+919876543210"],
    ["(415) 555-2671", "US", "+14155552671"],
    ["+1 415.555.2671", "IN", "+14155552671"],
    ["'+447911123456", null, "+447911123456"],
    ["919876543210.0", null, "+919876543210"],
    ["+1 415 555 2671 ext. 22", null, "+14155552671"],
  ])("normalises %s (default %s) to %s", (raw, country, expected) => {
    const result = normalizePhone(raw, country);
    expect(result).toMatchObject({ ok: true, e164: expected });
  });

  it.each([
    ["", "empty"],
    ["12345", "too short"],
    ["9.19877E+11", "scientific notation"],
    ["call me maybe", "too short"],
    ["1234567890123456", "too long"],
    ["555-CALL-NOW", "letters"],
  ])("rejects %s (%s)", (raw, reason) => {
    const result = normalizePhone(raw, "US");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.toLowerCase()).toContain(reason);
  });

  it("explains a local number with no default country", () => {
    const result = normalizePhone("98765 43210", null);
    expect(result.ok).toBe(false);
  });

  it("ignores an unsupported default country", () => {
    expect(normalizePhone("+14155552671", "ZZ")).toMatchObject({ ok: true, e164: "+14155552671" });
  });
});

describe("parseBoolean", () => {
  it.each(["yes", "Y", "TRUE", "1", "opt-in", "Opted In", "subscribed", "x", "✓"])("%s is true", (v) => {
    expect(parseBoolean(v)).toBe(true);
  });
  it.each(["no", "N", "false", "0", "opt_out", "unsubscribed", "declined"])("%s is false", (v) => {
    expect(parseBoolean(v)).toBe(false);
  });
  it("empty is null, nonsense is undefined", () => {
    expect(parseBoolean("  ")).toBeNull();
    expect(parseBoolean("maybe")).toBeUndefined();
  });
});

describe("parseTags", () => {
  it("splits on , ; | and normalises", () => {
    expect(parseTags("VIP, Mumbai Leads;vip | ,  new")).toEqual(["vip", "mumbai-leads", "new"]);
  });
  it("caps tag count and length", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
    expect(parseTags(many)).toHaveLength(20);
    expect(parseTags("x".repeat(80))[0]).toHaveLength(40);
  });
});

describe("splitFullName", () => {
  it("splits first and rest", () => {
    expect(splitFullName("  Asha  Rani Verma ")).toEqual({ firstName: "Asha", lastName: "Rani Verma" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitFullName("")).toEqual({ firstName: null, lastName: null });
  });
});

describe("validateRow", () => {
  const mapping = { fullName: 0, phone: 1, email: 2, tags: 3, voiceConsent: 4, whatsappOptIn: 5 };

  it("builds a contact from a good row", () => {
    const result = validateRow(["Asha Verma", "98765 43210", "ASHA@Example.com", "vip", "yes", "no"], 2, mapping, {
      defaultCountry: "IN",
    });
    expect(result.errors).toEqual([]);
    expect(result.contact).toEqual({
      firstName: "Asha",
      lastName: "Verma",
      phoneE164: "+919876543210",
      email: "asha@example.com",
      countryCode: "IN",
      tags: ["vip"],
      voiceConsent: true,
      whatsappOptIn: false,
      attributes: {},
    });
  });

  it("collects every error on a bad row", () => {
    const result = validateRow(["X", "12", "not-an-email", "", "perhaps", ""], 7, mapping, { defaultCountry: "IN" });
    expect(result.contact).toBeNull();
    expect(result.rowNumber).toBe(7);
    expect(result.errors.map((e) => e.field).sort()).toEqual(["email", "phone", "voiceConsent"]);
  });

  it("leaves consent null when the column is not mapped", () => {
    const result = validateRow(["+14155552671"], 2, { phone: 0 });
    expect(result.contact?.voiceConsent).toBeNull();
    expect(result.contact?.whatsappOptIn).toBeNull();
  });

  it("uses the row's country column to read local numbers", () => {
    const result = validateRow(["(415) 555-2671", "us"], 2, { phone: 0, countryCode: 1 }, { defaultCountry: "IN" });
    expect(result.contact?.phoneE164).toBe("+14155552671");
    expect(result.contact?.countryCode).toBe("US");
  });

  it("warns about an unknown country but still imports", () => {
    const result = validateRow(["+14155552671", "Narnia"], 2, { phone: 0, countryCode: 1 });
    expect(result.contact).not.toBeNull();
    expect(result.warnings[0].field).toBe("countryCode");
  });

  it("keeps unmapped columns as attributes when asked", () => {
    const result = validateRow(["+14155552671", "Gold", ""], 2, { phone: 0 }, {
      keepUnmappedAsAttributes: true,
      headers: ["Phone", "Plan", "Empty"],
    });
    expect(result.contact?.attributes).toEqual({ Plan: "Gold" });
  });

  it("applies extra tags", () => {
    const result = validateRow(["+14155552671", "a"], 2, { phone: 0, tags: 1 }, { extraTags: ["Import 2026"] });
    expect(result.contact?.tags).toEqual(["a", "import-2026"]);
  });

  it("flags an empty row and a missing phone mapping", () => {
    expect(validateRow(["", " "], 3, { phone: 0 }).errors[0].message).toMatch(/empty/);
    expect(validateRow(["a"], 3, {}).errors[0].field).toBe("phone");
  });

  it("truncates very long names with a warning", () => {
    const result = validateRow(["+14155552671", "A".repeat(150)], 2, { phone: 0, firstName: 1 });
    expect(result.contact?.firstName).toHaveLength(100);
    expect(result.warnings).toHaveLength(1);
  });
});
