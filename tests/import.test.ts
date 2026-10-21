import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { detectColumnMapping, headerScore, mappingProblems, normalizeHeader } from "@/lib/import/detect";
import { MAX_IMPORT_ROWS } from "@/lib/import/fields";
import { ImportParseError, parseDelimitedText, parsePastedText, parseWorkbook, tableFromGrid } from "@/lib/import/parse";
import { buildImportPreview, firstErrors, mergeIntoExisting } from "@/lib/import/preview";

describe("parsing", () => {
  it("parses CSV with quotes, BOM and blank lines", () => {
    const csv = '﻿Name,Phone,Notes\n"Verma, Asha",+919876543210,"says ""hi"""\n\n Ravi ,9876501234,\n';
    const table = parseDelimitedText(csv);
    expect(table.headers).toEqual(["Name", "Phone", "Notes"]);
    expect(table.rows).toEqual([
      ["Verma, Asha", "+919876543210", 'says "hi"'],
      ["Ravi", "9876501234", ""],
    ]);
    expect(table.generatedHeaders).toBe(false);
  });

  it("auto-detects semicolon delimiters (European Excel)", () => {
    const table = parseDelimitedText("name;phone\nAsha;+919876543210");
    expect(table.rows[0]).toEqual(["Asha", "+919876543210"]);
  });

  it("parses tab-separated text pasted from Excel", () => {
    const table = parsePastedText("First Name\tMobile\tTags\nAsha\t98765 43210\tvip, mumbai\n");
    expect(table.headers).toEqual(["First Name", "Mobile", "Tags"]);
    expect(table.rows[0][2]).toBe("vip, mumbai");
  });

  it("generates headers when the first row is data", () => {
    const table = parsePastedText("Asha\t+919876543210\nRavi\t+919876501234");
    expect(table.generatedHeaders).toBe(true);
    expect(table.headers).toEqual(["Column 1", "Column 2"]);
    expect(table.rows).toHaveLength(2);
  });

  it("pads ragged rows and drops empty trailing columns", () => {
    const table = tableFromGrid([["a", "b", "", ""], ["1"], ["2", "3", ""]]);
    expect(table.headers).toEqual(["a", "b"]);
    expect(table.rows).toEqual([["1", ""], ["2", "3"]]);
  });

  it("rejects empty input and header-only files", () => {
    expect(() => parseDelimitedText("   ")).toThrow(ImportParseError);
    expect(() => parseDelimitedText("name,phone\n")).toThrow(/no data rows/);
  });

  it("truncates beyond the row limit", () => {
    const grid = [["phone"], ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => [`+1415555${String(i).padStart(4, "0")}`])];
    const table = tableFromGrid(grid);
    expect(table.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(table.truncatedRows).toBe(5);
  });

  it("reads xlsx and keeps numeric phone numbers intact", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "Phone", "Joined"],
      ["Asha", 919876543210, new Date("2026-01-15T00:00:00Z")],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Leads");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["x"], ["y"]]), "Other");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const table = parseWorkbook(bytes);
    expect(table.sheetNames).toEqual(["Leads", "Other"]);
    expect(table.sheetName).toBe("Leads");
    expect(table.rows[0][1]).toBe("919876543210");
    expect(table.rows[0][2]).toMatch(/^2026-01-1/);

    expect(parseWorkbook(bytes, "Other").headers).toEqual(["x"]);
  });

  it("rejects garbage workbook bytes", () => {
    expect(() => parseWorkbook(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe("column detection", () => {
  it("normalises header spellings", () => {
    expect(normalizeHeader(" Phone_Number ")).toBe("phone number");
    expect(normalizeHeader("firstName")).toBe("first name");
    expect(normalizeHeader("E-mail")).toBe("e mail");
  });

  it("prefers the most specific synonym", () => {
    expect(headerScore("WhatsApp Opt-In", "whatsappOptIn")).toBe(100);
    expect(headerScore("WhatsApp Opt-In", "phone")).toBeLessThan(headerScore("WhatsApp Opt-In", "whatsappOptIn"));
    expect(headerScore("Customer Mobile No", "phone")).toBeGreaterThan(50);
    expect(headerScore("Notes", "phone")).toBe(0);
  });

  it("maps a typical CRM export", () => {
    const headers = ["First Name", "Last Name", "Mobile Number", "Email Address", "Tags", "Call Consent", "WhatsApp Opt-in", "Notes"];
    const rows = [["Asha", "Verma", "9876543210", "a@x.com", "vip", "yes", "no", "hi"]];
    const { mapping, confidence, unmappedColumns } = detectColumnMapping(headers, rows, "IN");
    expect(mapping).toEqual({ firstName: 0, lastName: 1, phone: 2, email: 3, tags: 4, voiceConsent: 5, whatsappOptIn: 6 });
    expect(confidence.phone).toBe("header");
    expect(unmappedColumns).toEqual([7]);
  });

  it("maps a bare WhatsApp column to phone", () => {
    const { mapping } = detectColumnMapping(["Name", "WhatsApp"], [["Asha", "+919876543210"]]);
    expect(mapping).toEqual({ fullName: 0, phone: 1 });
  });

  it("falls back to sniffing content when headers are generic", () => {
    const headers = ["Column 1", "Column 2", "Column 3"];
    const rows = [
      ["Asha", "asha@x.com", "+919876543210"],
      ["Ravi", "ravi@x.com", "+919876501234"],
    ];
    const { mapping, confidence } = detectColumnMapping(headers, rows);
    expect(mapping.phone).toBe(2);
    expect(mapping.email).toBe(1);
    expect(confidence.phone).toBe("content");
  });

  it("does not map a consent header whose values are not yes/no", () => {
    const { mapping } = detectColumnMapping(["phone", "voice consent"], [["+14155552671", "ask later"]]);
    expect(mapping.voiceConsent).toBeUndefined();
  });

  it("drops full name when first and last are present", () => {
    const { mapping } = detectColumnMapping(["Name", "First Name", "Last Name", "Phone"], [["A B", "A", "B", "+14155552671"]]);
    expect(mapping.fullName).toBeUndefined();
    expect(mapping.firstName).toBe(1);
  });

  it("reports mapping problems", () => {
    expect(mappingProblems({})).toHaveLength(1);
    expect(mappingProblems({ phone: 0, email: 0 })[0]).toMatch(/more than one/);
    expect(mappingProblems({ phone: 0 })).toEqual([]);
  });
});

describe("import preview & duplicates", () => {
  const mapping = { fullName: 0, phone: 1 };
  const rows = [
    ["Asha", "+91 98765 43210"],
    ["Asha again", "098765 43210"], // same number, local format
    ["Bad", "123"],
    ["Ravi", "+919876501234"], // already in the database
    ["Meera", "+14155552671"],
  ];

  it("classifies valid, invalid, in-file and existing duplicates", () => {
    const preview = buildImportPreview(rows, mapping, { defaultCountry: "IN" }, new Set(["+919876501234"]));
    expect(preview.rows.map((r) => r.status)).toEqual(["valid", "duplicate_in_file", "invalid", "duplicate_existing", "valid"]);
    expect(preview.rows[1].duplicateOf).toBe(2);
    expect(preview.rows[2].rowNumber).toBe(4);
    expect(preview.summary).toEqual({ total: 5, valid: 2, invalid: 1, duplicateInFile: 1, duplicateExisting: 1, warnings: 0 });
  });

  it("honours firstRowNumber for chunked server-side validation", () => {
    const preview = buildImportPreview([["X", "1"]], mapping, { firstRowNumber: 2002 });
    expect(firstErrors(preview.rows)).toEqual([{ row: 2002, field: "phone", message: expect.any(String) }]);
  });

  it("caps collected errors", () => {
    const bad = Array.from({ length: 50 }, () => ["x", "1"]);
    expect(firstErrors(buildImportPreview(bad, mapping).rows, 10)).toHaveLength(10);
  });

  it("merges into an existing contact without losing data or consent", () => {
    const existing = {
      id: "c1",
      first_name: "Ravi",
      last_name: "Kumar",
      email: "ravi@x.com",
      country_code: "IN",
      tags: ["vip"],
      attributes: { plan: "gold" },
      voice_consent: true,
      whatsapp_opt_in: true,
    };
    const merged = mergeIntoExisting(existing, {
      firstName: null,
      lastName: "K.",
      phoneE164: "+919876501234",
      email: null,
      countryCode: null,
      tags: ["mumbai"],
      voiceConsent: null, // column absent: keep existing consent
      whatsappOptIn: false, // explicit opt-out: honour it
      attributes: { source: "expo" },
    });
    expect(merged).toEqual({
      id: "c1",
      first_name: "Ravi",
      last_name: "K.",
      email: "ravi@x.com",
      country_code: "IN",
      tags: ["vip", "mumbai"],
      attributes: { plan: "gold", source: "expo" },
      voice_consent: true,
      whatsapp_opt_in: false,
    });
  });
});
