import Papa from "papaparse";
import * as XLSX from "xlsx";
import { MAX_IMPORT_ROWS } from "./fields";
import { headerMatchesAnyField } from "./detect";
import { normalizePhone } from "./validate";

export interface RawTable {
  headers: string[];
  rows: string[][];
  /** true when the first row was data, so headers were generated */
  generatedHeaders: boolean;
  /** rows dropped because the file exceeded MAX_IMPORT_ROWS */
  truncatedRows: number;
  sheetNames?: string[];
  sheetName?: string;
}

export class ImportParseError extends Error {}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    // Keep long integers (phone numbers) out of scientific notation.
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  }
  return String(value).trim();
}

/** A row "looks like data" if it has no recognised header and a phone-like cell. */
function looksLikeDataRow(row: string[]): boolean {
  if (row.some((value) => headerMatchesAnyField(value))) return false;
  return row.some((value) => /\d{6,}/.test(value.replace(/\D/g, "")) && normalizePhone(value).ok);
}

/** Turn a 2-D grid into headers + rows, trimming empty rows and ragged edges. */
export function tableFromGrid(grid: unknown[][]): RawTable {
  const rows = grid
    .map((row) => (Array.isArray(row) ? row.map(cellToString) : []))
    .filter((row) => row.some((value) => value !== ""));

  if (rows.length === 0) throw new ImportParseError("The file has no rows");

  const width = Math.max(...rows.map((row) => row.length));
  // Drop trailing columns that are empty in every row.
  let effectiveWidth = width;
  while (effectiveWidth > 0 && rows.every((row) => !row[effectiveWidth - 1])) effectiveWidth--;
  const normalized = rows.map((row) => {
    const out = row.slice(0, effectiveWidth);
    while (out.length < effectiveWidth) out.push("");
    return out;
  });

  const generatedHeaders = looksLikeDataRow(normalized[0]);
  const headers = generatedHeaders
    ? normalized[0].map((_, i) => `Column ${i + 1}`)
    : normalized[0].map((h, i) => h || `Column ${i + 1}`);
  const body = generatedHeaders ? normalized : normalized.slice(1);

  if (body.length === 0) throw new ImportParseError("The file has a header row but no data rows");

  const truncatedRows = Math.max(0, body.length - MAX_IMPORT_ROWS);
  return {
    headers,
    rows: truncatedRows ? body.slice(0, MAX_IMPORT_ROWS) : body,
    generatedHeaders,
    truncatedRows,
  };
}

/** CSV/TSV/semicolon-separated text; delimiter is auto-detected. */
export function parseDelimitedText(text: string, delimiter?: string): RawTable {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) throw new ImportParseError("Nothing to import");
  const result = Papa.parse<string[]>(clean, {
    delimiter: delimiter ?? "",
    delimitersToGuess: [",", "\t", ";", "|"],
    skipEmptyLines: "greedy",
  });
  const fatal = result.errors.find((e) => e.type === "Quotes");
  if (fatal && result.data.length === 0) {
    throw new ImportParseError(`Could not read the file: ${fatal.message}`);
  }
  return tableFromGrid(result.data);
}

/** Text copied from Excel / Google Sheets arrives tab-separated. */
export function parsePastedText(text: string): RawTable {
  return parseDelimitedText(text, text.includes("\t") ? "\t" : undefined);
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array, sheetName?: string): RawTable {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: "array", cellDates: true, dense: true });
  } catch {
    throw new ImportParseError("Could not read the spreadsheet. Is it a valid .xlsx, .xls or .csv file?");
  }
  const sheetNames = workbook.SheetNames;
  const chosen = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  if (!chosen) throw new ImportParseError("The workbook has no sheets");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[chosen], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  return { ...tableFromGrid(grid), sheetNames, sheetName: chosen };
}

export async function parseFile(file: File, sheetName?: string): Promise<RawTable & { source: "csv" | "xlsx" }> {
  const name = file.name.toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new ImportParseError("File is larger than 20 MB");
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt") || file.type === "text/csv") {
    return { ...parseDelimitedText(await file.text()), source: "csv" };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
    return { ...parseWorkbook(await file.arrayBuffer(), sheetName), source: "xlsx" };
  }
  throw new ImportParseError("Unsupported file type. Upload .csv, .tsv, .xlsx, .xls or .ods");
}
