import type { ColumnMapping } from "./fields";
import { validateRow, type ContactInput, type RowIssue, type ValidatedRow, type ValidationOptions } from "./validate";

export type PreviewRowStatus = "valid" | "invalid" | "duplicate_in_file" | "duplicate_existing";

export interface PreviewRow extends ValidatedRow {
  status: PreviewRowStatus;
  /** for in-file duplicates: the row number that was kept */
  duplicateOf?: number;
}

export interface ImportSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicateInFile: number;
  duplicateExisting: number;
  warnings: number;
}

export interface ImportPreview {
  rows: PreviewRow[];
  summary: ImportSummary;
}

/**
 * Validate every row and classify duplicates. The first occurrence of a phone
 * number in the file wins; later ones are reported as in-file duplicates.
 * `existingPhones` holds E.164 numbers already in the contact list.
 */
export function buildImportPreview(
  rows: string[][],
  mapping: ColumnMapping,
  options: ValidationOptions & { firstRowNumber?: number } = {},
  existingPhones: ReadonlySet<string> = new Set(),
): ImportPreview {
  // Row 1 is the header in the user's file, so data starts on row 2.
  const firstRowNumber = options.firstRowNumber ?? 2;
  const seen = new Map<string, number>();
  const out: PreviewRow[] = [];

  rows.forEach((row, index) => {
    const validated = validateRow(row, firstRowNumber + index, mapping, options);
    if (!validated.contact) {
      out.push({ ...validated, status: "invalid" });
      return;
    }
    const phone = validated.contact.phoneE164;
    const firstSeen = seen.get(phone);
    if (firstSeen !== undefined) {
      out.push({ ...validated, status: "duplicate_in_file", duplicateOf: firstSeen });
      return;
    }
    seen.set(phone, validated.rowNumber);
    out.push({ ...validated, status: existingPhones.has(phone) ? "duplicate_existing" : "valid" });
  });

  return { rows: out, summary: summarize(out) };
}

export function summarize(rows: PreviewRow[]): ImportSummary {
  const summary: ImportSummary = { total: rows.length, valid: 0, invalid: 0, duplicateInFile: 0, duplicateExisting: 0, warnings: 0 };
  for (const row of rows) {
    if (row.status === "valid") summary.valid++;
    else if (row.status === "invalid") summary.invalid++;
    else if (row.status === "duplicate_in_file") summary.duplicateInFile++;
    else summary.duplicateExisting++;
    if (row.warnings.length) summary.warnings++;
  }
  return summary;
}

export interface ExistingContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  country_code: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  voice_consent: boolean;
  whatsapp_opt_in: boolean;
}

/**
 * Merge an imported row into an existing contact ("update existing" strategy):
 * non-empty imported values win, tags are unioned, and consent only changes
 * when the file states it explicitly (an explicit "no" is an opt-out).
 */
export function mergeIntoExisting(existing: ExistingContact, incoming: ContactInput) {
  return {
    id: existing.id,
    first_name: incoming.firstName ?? existing.first_name,
    last_name: incoming.lastName ?? existing.last_name,
    email: incoming.email ?? existing.email,
    country_code: incoming.countryCode ?? existing.country_code,
    tags: [...new Set([...(existing.tags ?? []), ...incoming.tags])],
    attributes: { ...(existing.attributes ?? {}), ...incoming.attributes },
    voice_consent: incoming.voiceConsent ?? existing.voice_consent,
    whatsapp_opt_in: incoming.whatsappOptIn ?? existing.whatsapp_opt_in,
  };
}

export function firstErrors(rows: PreviewRow[], limit = 200): { row: number; field: RowIssue["field"]; message: string }[] {
  const out: { row: number; field: RowIssue["field"]; message: string }[] = [];
  for (const row of rows) {
    for (const error of row.errors) {
      out.push({ row: row.rowNumber, field: error.field, message: error.message });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
