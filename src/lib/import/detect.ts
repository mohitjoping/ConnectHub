import { CONTACT_FIELDS, CONTACT_FIELD_KEYS, type ColumnMapping, type ContactFieldKey } from "./fields";
import { EMAIL_PATTERN, normalizePhone, parseBoolean } from "./validate";

export function normalizeHeader(header: string): string {
  const raw = (header ?? "").trim();
  // Split camelCase identifiers ("firstName") but not brand words ("WhatsApp").
  const split = /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(raw) ? raw.replace(/([a-z])([A-Z])/g, "$1 $2") : raw;
  return split
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Score how well a header names a field: 100 exact, 50+len partial, 0 none. */
export function headerScore(header: string, field: ContactFieldKey): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const synonym of CONTACT_FIELDS[field].synonyms) {
    if (h === synonym || h.replace(/ /g, "") === synonym.replace(/ /g, "")) return 100;
    if (synonym.length >= 3 && ` ${h} `.includes(` ${synonym} `)) {
      best = Math.max(best, 50 + synonym.length);
    }
  }
  return best;
}

export function headerMatchesAnyField(header: string): boolean {
  return CONTACT_FIELD_KEYS.some((field) => headerScore(header, field) >= 100);
}

function ratio(values: string[], predicate: (v: string) => boolean): number {
  const filled = values.filter((v) => v.trim() !== "");
  if (filled.length === 0) return 0;
  return filled.filter(predicate).length / filled.length;
}

/** Content-based score used when headers are missing or unhelpful. */
export function contentScore(values: string[], field: ContactFieldKey, defaultCountry?: string | null): number {
  switch (field) {
    case "phone":
      return ratio(values, (v) => normalizePhone(v, defaultCountry).ok) >= 0.6 ? 40 : 0;
    case "email":
      return ratio(values, (v) => EMAIL_PATTERN.test(v.trim())) >= 0.6 ? 40 : 0;
    default:
      return 0;
  }
}

export interface DetectionResult {
  mapping: ColumnMapping;
  /** how each mapped field was matched, for the UI */
  confidence: Partial<Record<ContactFieldKey, "header" | "content">>;
  unmappedColumns: number[];
}

/**
 * Propose a column for each field. Header matches beat content sniffing;
 * each column and each field is used at most once (greedy by score).
 */
export function detectColumnMapping(
  headers: string[],
  sampleRows: string[][],
  defaultCountry?: string | null,
): DetectionResult {
  const candidates: { field: ContactFieldKey; column: number; score: number; via: "header" | "content" }[] = [];

  headers.forEach((header, column) => {
    const values = sampleRows.slice(0, 50).map((row) => row[column] ?? "");
    for (const field of CONTACT_FIELD_KEYS) {
      const hs = headerScore(header, field);
      if (hs > 0) candidates.push({ field, column, score: hs, via: "header" });
      const cs = contentScore(values, field, defaultCountry);
      if (cs > 0) candidates.push({ field, column, score: cs, via: "content" });
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: ColumnMapping = {};
  const confidence: DetectionResult["confidence"] = {};
  const usedColumns = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedColumns.has(c.column)) continue;
    // A header-matched consent column must actually contain yes/no values.
    if ((c.field === "voiceConsent" || c.field === "whatsappOptIn") && sampleRows.length > 0) {
      const values = sampleRows.slice(0, 50).map((row) => row[c.column] ?? "");
      if (ratio(values, (v) => parseBoolean(v) !== undefined) < 0.8) continue;
    }
    mapping[c.field] = c.column;
    confidence[c.field] = c.via;
    usedColumns.add(c.column);
  }

  // Full name is redundant when both first and last are mapped.
  if (mapping.fullName !== undefined && mapping.firstName !== undefined && mapping.lastName !== undefined) {
    usedColumns.delete(mapping.fullName);
    delete mapping.fullName;
    delete confidence.fullName;
  }

  return {
    mapping,
    confidence,
    unmappedColumns: headers.map((_, i) => i).filter((i) => !usedColumns.has(i)),
  };
}

export function mappingProblems(mapping: ColumnMapping): string[] {
  const problems: string[] = [];
  if (mapping.phone === undefined) problems.push("Map a column to Phone number — it is required.");
  const columns = Object.values(mapping).filter((v): v is number => v !== undefined);
  if (new Set(columns).size !== columns.length) problems.push("The same column is mapped to more than one field.");
  return problems;
}
