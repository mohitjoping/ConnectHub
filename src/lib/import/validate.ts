import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import {
  MAX_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CONTACT,
  type ColumnMapping,
  type ContactFieldKey,
} from "./fields";

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type PhoneResult =
  | { ok: true; e164: string; country: string | null }
  | { ok: false; reason: string };

export function isCountryCode(value: string): value is CountryCode {
  return /^[A-Z]{2}$/.test(value) && isSupportedCountry(value as CountryCode);
}

/**
 * Normalise a phone number typed by a human or exported from a spreadsheet
 * into E.164. Handles spaces, dashes, brackets, "00" international prefixes,
 * leading apostrophes and ".0" float artefacts from Excel.
 */
export function normalizePhone(raw: string, defaultCountry?: string | null): PhoneResult {
  let value = (raw ?? "").toString().trim();
  if (!value) return { ok: false, reason: "Phone number is empty" };

  value = value.replace(/^'+/, "");
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(value)) {
    return {
      ok: false,
      reason: "Number is in scientific notation (format the column as Text in Excel and re-export)",
    };
  }
  value = value.replace(/^(\+?\d+)\.0+$/, "$1");
  // Drop extensions; we can't dial them.
  value = value.replace(/\s*(ext\.?|x|#)\s*\d+$/i, "");
  value = value.replace(/^00(?=[1-9])/, "+");

  const digits = value.replace(/\D/g, "");
  if (/[a-z]/i.test(value) && digits.length >= 3) return { ok: false, reason: "Phone number contains letters" };
  if (digits.length < 6) return { ok: false, reason: "Phone number is too short" };
  if (digits.length > 15) return { ok: false, reason: "Phone number is too long" };

  const country = defaultCountry && isCountryCode(defaultCountry) ? defaultCountry : undefined;
  let parsed = parsePhoneNumberFromString(value, country);
  // A bare international number without "+" (e.g. 919876543210) is common in exports.
  if ((!parsed || !parsed.isValid()) && !value.startsWith("+")) {
    const asIntl = parsePhoneNumberFromString(`+${digits}`);
    if (asIntl?.isValid()) parsed = asIntl;
  }
  if (!parsed) return { ok: false, reason: "Not a recognisable phone number" };
  if (!parsed.isValid()) {
    return {
      ok: false,
      reason: country
        ? `Not a valid ${country} or international number`
        : "Not a valid international number (add a country code or pick a default country)",
    };
  }
  return { ok: true, e164: parsed.number, country: parsed.country ?? null };
}

const TRUE_VALUES = new Set(["yes", "y", "true", "t", "1", "opted in", "opt in", "optin", "subscribed", "consented", "x", "✓", "✔"]);
const FALSE_VALUES = new Set(["no", "n", "false", "f", "0", "opted out", "opt out", "optout", "unsubscribed", "declined", "none", "-"]);

/** Returns null for an empty cell, undefined for something unrecognisable. */
export function parseBoolean(raw: string): boolean | null | undefined {
  const value = (raw ?? "").toString().trim().toLowerCase().replace(/[-_]+/g, " ");
  if (!value) return null;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return undefined;
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[,;|]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, MAX_TAGS_PER_CONTACT);
}

export function splitFullName(full: string): { firstName: string | null; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export interface ContactInput {
  firstName: string | null;
  lastName: string | null;
  phoneE164: string;
  email: string | null;
  countryCode: string | null;
  tags: string[];
  /** null = the file didn't say; keep existing value / default to false */
  voiceConsent: boolean | null;
  whatsappOptIn: boolean | null;
  attributes: Record<string, string>;
}

export interface RowIssue {
  field: ContactFieldKey | "row";
  message: string;
}

export interface ValidatedRow {
  /** 1-based row number as the user sees it in their file (header = row 1) */
  rowNumber: number;
  contact: ContactInput | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface ValidationOptions {
  defaultCountry?: string | null;
  /** Columns not mapped to a field are kept in contacts.attributes */
  keepUnmappedAsAttributes?: boolean;
  headers?: string[];
  /** Extra tags applied to every imported contact */
  extraTags?: string[];
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined || index < 0) return "";
  return (row[index] ?? "").toString().trim();
}

function clampName(value: string, field: ContactFieldKey, warnings: RowIssue[]): string | null {
  if (!value) return null;
  if (value.length > MAX_NAME_LENGTH) {
    warnings.push({ field, message: `Truncated to ${MAX_NAME_LENGTH} characters` });
    return value.slice(0, MAX_NAME_LENGTH);
  }
  return value;
}

export function validateRow(
  row: string[],
  rowNumber: number,
  mapping: ColumnMapping,
  options: ValidationOptions = {},
): ValidatedRow {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  if (row.every((value) => !value || !value.toString().trim())) {
    return { rowNumber, contact: null, errors: [{ field: "row", message: "Row is empty" }], warnings };
  }

  // Country first: it changes how the phone number is read.
  let countryCode: string | null = null;
  const rawCountry = cell(row, mapping.countryCode).toUpperCase();
  if (rawCountry) {
    if (isCountryCode(rawCountry)) countryCode = rawCountry;
    else warnings.push({ field: "countryCode", message: `Ignored unknown country code "${rawCountry}"` });
  }

  let phoneE164 = "";
  if (mapping.phone === undefined) {
    errors.push({ field: "phone", message: "No column is mapped to Phone number" });
  } else {
    const result = normalizePhone(cell(row, mapping.phone), countryCode ?? options.defaultCountry);
    if (result.ok) {
      phoneE164 = result.e164;
      countryCode = countryCode ?? result.country;
    } else {
      errors.push({ field: "phone", message: result.reason });
    }
  }

  let email: string | null = cell(row, mapping.email).toLowerCase() || null;
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push({ field: "email", message: `"${email}" is not a valid email address` });
    email = null;
  }

  let firstName = clampName(cell(row, mapping.firstName), "firstName", warnings);
  let lastName = clampName(cell(row, mapping.lastName), "lastName", warnings);
  const fullName = cell(row, mapping.fullName);
  if (fullName && !firstName && !lastName) {
    const split = splitFullName(fullName);
    firstName = clampName(split.firstName ?? "", "firstName", warnings);
    lastName = clampName(split.lastName ?? "", "lastName", warnings);
  }

  const consent = (field: "voiceConsent" | "whatsappOptIn"): boolean | null => {
    if (mapping[field] === undefined) return null;
    const parsed = parseBoolean(cell(row, mapping[field]));
    if (parsed === undefined) {
      errors.push({ field, message: `"${cell(row, mapping[field])}" is not yes/no` });
      return null;
    }
    return parsed;
  };
  const voiceConsent = consent("voiceConsent");
  const whatsappOptIn = consent("whatsappOptIn");

  const tags = parseTags([cell(row, mapping.tags), ...(options.extraTags ?? [])].join(","));

  const attributes: Record<string, string> = {};
  if (options.keepUnmappedAsAttributes && options.headers) {
    const mapped = new Set(Object.values(mapping));
    options.headers.forEach((header, index) => {
      if (mapped.has(index)) return;
      const value = cell(row, index);
      const key = header.trim() || `column_${index + 1}`;
      if (value) attributes[key.slice(0, 60)] = value.slice(0, 500);
    });
  }

  if (errors.length > 0) return { rowNumber, contact: null, errors, warnings };

  return {
    rowNumber,
    contact: {
      firstName,
      lastName,
      phoneE164,
      email,
      countryCode,
      tags,
      voiceConsent,
      whatsappOptIn,
      attributes,
    },
    errors,
    warnings,
  };
}
