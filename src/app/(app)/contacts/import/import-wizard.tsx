"use client";

import { getCountries } from "libphonenumber-js";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Download, FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { findExistingPhones, finishImport, importChunk, startImport } from "@/lib/actions/imports";
import { detectColumnMapping, mappingProblems, type DetectionResult } from "@/lib/import/detect";
import { CONTACT_FIELD_KEYS, CONTACT_FIELDS, type ColumnMapping, type ContactFieldKey } from "@/lib/import/fields";
import { ImportParseError, parseFile, parsePastedText, type RawTable } from "@/lib/import/parse";
import { buildImportPreview, type PreviewRow, type PreviewRowStatus } from "@/lib/import/preview";
import { parseTags } from "@/lib/import/validate";
import { cn } from "@/lib/utils";

const CHUNK_SIZE = 1000;
const NONE = "__none";

type Step = "source" | "map" | "review" | "done";
type Source = { table: RawTable; source: "csv" | "xlsx" | "paste"; fileName: string | null; file?: File };
type Totals = { imported: number; updated: number; duplicates: number; invalid: number; errors: { row: number; field: string; message: string }[] };

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const COUNTRIES = getCountries()
  .map((code) => ({ code, name: regionNames?.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full text-xs font-medium",
          done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="size-3.5" /> : n}
      </span>
      <span className={cn("text-sm", active ? "font-medium" : "text-muted-foreground")}>{label}</span>
    </li>
  );
}

export function ImportWizard({ defaultCountry }: { defaultCountry: string }) {
  const [step, setStep] = useState<Step>("source");
  const [data, setData] = useState<Source | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [country, setCountry] = useState(defaultCountry);
  const [keepExtra, setKeepExtra] = useState(false);
  const [extraTags, setExtraTags] = useState("");
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [attest, setAttest] = useState({ voice: false, whatsapp: false, source: "" });
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | PreviewRowStatus>("all");
  const [pasted, setPasted] = useState("");
  const [progress, setProgress] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [parsing, startParsing] = useTransition();
  const [working, startWorking] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const load = (next: Source) => {
    const detected = detectColumnMapping(next.table.headers, next.table.rows, defaultCountry);
    setData(next);
    setDetection(detected);
    setMapping(detected.mapping);
    setStep("map");
    if (next.table.truncatedRows) toast.warning(`Only the first 50,000 rows will be imported (${next.table.truncatedRows} dropped).`);
  };

  const handleFile = (file: File, sheetName?: string) =>
    startParsing(async () => {
      try {
        const parsed = await parseFile(file, sheetName);
        load({ table: parsed, source: parsed.source, fileName: file.name, file });
      } catch (e) {
        toast.error(e instanceof ImportParseError ? e.message : "Could not read that file");
      }
    });

  const handlePaste = () => {
    try {
      load({ table: parsePastedText(pasted), source: "paste", fileName: null });
    } catch (e) {
      toast.error(e instanceof ImportParseError ? e.message : "Could not read the pasted data");
    }
  };

  const extraTagList = useMemo(() => parseTags(extraTags).slice(0, 10), [extraTags]);
  const preview = useMemo(() => {
    if (!data || step === "source") return null;
    return buildImportPreview(data.table.rows, mapping, { defaultCountry: country, keepUnmappedAsAttributes: keepExtra, headers: data.table.headers, extraTags: extraTagList }, existing);
  }, [data, mapping, country, keepExtra, extraTagList, existing, step]);

  const problems = mappingProblems(mapping);

  const goToReview = () =>
    startWorking(async () => {
      if (!preview) return;
      const phones = preview.rows.filter((r) => r.contact && r.status !== "duplicate_in_file").map((r) => r.contact!.phoneE164);
      const found = new Set<string>();
      for (let i = 0; i < phones.length; i += 5000) {
        const result = await findExistingPhones(phones.slice(i, i + 5000));
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        result.data?.forEach((p) => found.add(p));
      }
      setExisting(found);
      setFilter("all");
      setStep("review");
    });

  const runImport = () =>
    startWorking(async () => {
      if (!data || !preview) return;
      if ((attest.voice || attest.whatsapp) && !attest.source.trim()) {
        toast.error("Describe where consent was collected before attesting to it.");
        return;
      }
      setProgress(0);
      const started = await startImport({ fileName: data.fileName, source: data.source, totalRows: data.table.rows.length, mapping });
      if (!started.ok || !started.data) {
        toast.error(started.ok ? "Could not start import" : started.error);
        return;
      }
      const importId = started.data.importId;
      const sum: Totals = { imported: 0, updated: 0, duplicates: 0, invalid: 0, errors: [] };
      const skipRows = new Set(preview.rows.filter((r) => r.status === "duplicate_in_file").map((r) => r.rowNumber));
      let failed = false;

      for (let i = 0; i < data.table.rows.length; i += CHUNK_SIZE) {
        const firstRowNumber = 2 + i;
        const rows = data.table.rows.slice(i, i + CHUNK_SIZE);
        const result = await importChunk({
          importId,
          fileName: data.fileName,
          headers: data.table.headers,
          rows,
          firstRowNumber,
          skipRowNumbers: rows.map((_, j) => firstRowNumber + j).filter((n) => skipRows.has(n)),
          mapping,
          defaultCountry: country,
          keepUnmappedAsAttributes: keepExtra,
          extraTags: extraTagList,
          strategy,
          consentAttestation: { voice: attest.voice, whatsapp: attest.whatsapp, source: attest.source.trim() },
        });
        if (!result.ok || !result.data) {
          toast.error(result.ok ? "Import failed" : result.error);
          failed = true;
          break;
        }
        sum.imported += result.data.imported;
        sum.updated += result.data.updated;
        sum.duplicates += result.data.duplicates;
        sum.invalid += result.data.invalid;
        sum.errors.push(...result.data.errors);
        setProgress(Math.round(((i + rows.length) / data.table.rows.length) * 100));
      }

      await finishImport({ importId, ...sum, errors: sum.errors.slice(0, 500), failed });
      setTotals(sum);
      setStep("done");
      if (!failed) toast.success(`Imported ${sum.imported} new contact(s)`);
    });

  const downloadProblems = () => {
    if (!preview || !data) return;
    const bad = preview.rows.filter((r) => r.status === "invalid");
    const csv = Papa.unparse({
      fields: ["row", ...data.table.headers, "errors"],
      data: bad.map((r) => [r.rowNumber, ...data.table.rows[r.rowNumber - 2], r.errors.map((e) => `${e.field}: ${e.message}`).join("; ")]),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-problems-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStep("source");
    setData(null);
    setDetection(null);
    setMapping({});
    setExisting(new Set());
    setTotals(null);
    setPasted("");
    setProgress(0);
  };

  const steps: { key: Step; label: string }[] = [
    { key: "source", label: "Source" },
    { key: "map", label: "Map columns" },
    { key: "review", label: "Review" },
    { key: "done", label: "Import" },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-x-6 gap-y-2">
        {steps.map((s, i) => (
          <StepDot key={s.key} n={i + 1} label={s.label} active={i === stepIndex} done={i < stepIndex || step === "done"} />
        ))}
      </ol>

      {step === "source" ? (
        <Tabs defaultValue="file">
          <TabsList>
            <TabsTrigger value="file">
              <FileSpreadsheet /> Upload file
            </TabsTrigger>
            <TabsTrigger value="paste">
              <ClipboardPaste /> Paste from Excel
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
                dragging ? "border-primary bg-muted" : "hover:bg-muted/50",
              )}
            >
              {parsing ? <Loader2 className="mb-3 size-6 animate-spin" /> : <Upload className="mb-3 size-6 text-muted-foreground" />}
              <span className="font-medium">Drop a file here or click to choose</span>
              <span className="mt-1 text-sm text-muted-foreground">.csv, .tsv, .xlsx, .xls or .ods · up to 20 MB · 50,000 rows</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </TabsContent>
          <TabsContent value="paste" className="space-y-3">
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder={"Select cells in Excel or Google Sheets (including the header row), copy, and paste here.\n\nName\tMobile\tTags\nAsha Verma\t98765 43210\tvip"}
            />
            <Button onClick={handlePaste} disabled={!pasted.trim()}>
              Continue
            </Button>
          </TabsContent>
        </Tabs>
      ) : null}

      {step === "map" && data && detection && preview ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Map columns
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  <Sparkles className="size-3" /> {Object.keys(detection.mapping).length} auto-detected
                </span>
              </CardTitle>
              <CardDescription>
                {data.fileName ?? "Pasted data"} · {data.table.rows.length.toLocaleString()} rows · {data.table.headers.length} columns
                {data.table.generatedHeaders ? " · no header row found, columns are numbered" : ""}
              </CardDescription>
              {data.table.sheetNames && data.table.sheetNames.length > 1 && data.file ? (
                <div className="flex items-center gap-2 pt-2">
                  <Label className="text-xs">Sheet</Label>
                  <Select value={data.table.sheetName} onValueChange={(name) => handleFile(data.file!, name)}>
                    <SelectTrigger size="sm" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {data.table.sheetNames.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {CONTACT_FIELD_KEYS.map((field) => {
                const def = CONTACT_FIELDS[field];
                const col = mapping[field];
                const samples = col === undefined ? [] : data.table.rows.slice(0, 3).map((r) => r[col]).filter(Boolean);
                return (
                  <div key={field} className="grid items-start gap-2 border-b pb-3 last:border-0 sm:grid-cols-[180px_1fr]">
                    <div>
                      <p className="text-sm font-medium">
                        {def.label}
                        {def.required ? <span className="text-red-600"> *</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Select
                          value={col === undefined ? NONE : String(col)}
                          onValueChange={(v) =>
                            setMapping((m) => {
                              const next = { ...m };
                              if (v === NONE) delete next[field];
                              else {
                                const index = Number(v);
                                // A column can feed only one field.
                                for (const k of Object.keys(next) as ContactFieldKey[]) if (next[k] === index) delete next[k];
                                next[field] = index;
                              }
                              return next;
                            })
                          }
                        >
                          <SelectTrigger className="w-full sm:w-72" aria-label={`Column for ${def.label}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>— Not mapped —</SelectItem>
                            {data.table.headers.map((h, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {detection.confidence[field] && detection.mapping[field] === col ? (
                          <span className="text-xs text-muted-foreground">auto · {detection.confidence[field]}</span>
                        ) : null}
                      </div>
                      {samples.length ? <p className="truncate text-xs text-muted-foreground">e.g. {samples.join(" · ")}</p> : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Default country for local numbers</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="extra-tags">Tag every imported contact</Label>
                  <Input id="extra-tags" value={extraTags} onChange={(e) => setExtraTags(e.target.value)} placeholder="e.g. expo-2026" />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={keepExtra} onCheckedChange={(v) => setKeepExtra(v === true)} className="mt-0.5" />
                  Keep unmapped columns as custom attributes
                </label>
                <div className="space-y-1.5">
                  <Label>When a number is already in contacts</Label>
                  <Select value={strategy} onValueChange={(v) => setStrategy(v as "skip" | "update")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip it (keep existing)</SelectItem>
                      <SelectItem value="update">Update it (merge fields, add tags)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consent</CardTitle>
                <CardDescription>
                  Mapped consent columns are always respected. Only tick these if you hold consent for rows whose file doesn&apos;t say.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={attest.voice} onCheckedChange={(v) => setAttest((a) => ({ ...a, voice: v === true }))} className="mt-0.5" />
                  These contacts agreed to receive phone calls
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={attest.whatsapp} onCheckedChange={(v) => setAttest((a) => ({ ...a, whatsapp: v === true }))} className="mt-0.5" />
                  These contacts opted in to WhatsApp
                </label>
                {attest.voice || attest.whatsapp ? (
                  <Input value={attest.source} onChange={(e) => setAttest((a) => ({ ...a, source: e.target.value }))} placeholder="Where/how consent was collected *" />
                ) : null}
              </CardContent>
            </Card>

            {problems.length ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{problems[0]}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>
                Start over
              </Button>
              <Button className="flex-1" disabled={problems.length > 0 || working} onClick={goToReview}>
                {working ? <Loader2 className="animate-spin" /> : null} Review {preview.summary.total.toLocaleString()} rows
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "review" && preview ? (
        <ReviewStep
          rows={preview.rows}
          summary={preview.summary}
          filter={filter}
          setFilter={setFilter}
          strategy={strategy}
          working={working}
          progress={progress}
          onBack={() => setStep("map")}
          onImport={runImport}
          onDownload={downloadProblems}
        />
      ) : null}

      {step === "done" && totals ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" /> Import finished
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Metric label="New contacts" value={totals.imported} />
              <Metric label="Updated" value={totals.updated} />
              <Metric label="Duplicates skipped" value={totals.duplicates} />
              <Metric label="Invalid rows" value={totals.invalid} />
            </div>
            {totals.errors.length ? (
              <p className="text-sm text-muted-foreground">
                First problem: row {totals.errors[0].row} — {totals.errors[0].message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/contacts">View contacts</Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

const FILTERS: { key: "all" | PreviewRowStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "valid", label: "Ready" },
  { key: "invalid", label: "Invalid" },
  { key: "duplicate_in_file", label: "Duplicate in file" },
  { key: "duplicate_existing", label: "Already in contacts" },
];

function ReviewStep({
  rows,
  summary,
  filter,
  setFilter,
  strategy,
  working,
  progress,
  onBack,
  onImport,
  onDownload,
}: {
  rows: PreviewRow[];
  summary: ReturnType<typeof buildImportPreview>["summary"];
  filter: "all" | PreviewRowStatus;
  setFilter: (f: "all" | PreviewRowStatus) => void;
  strategy: "skip" | "update";
  working: boolean;
  progress: number;
  onBack: () => void;
  onImport: () => void;
  onDownload: () => void;
}) {
  const visible = (filter === "all" ? rows : rows.filter((r) => r.status === filter)).slice(0, 200);
  const counts: Record<string, number> = {
    all: summary.total,
    valid: summary.valid,
    invalid: summary.invalid,
    duplicate_in_file: summary.duplicateInFile,
    duplicate_existing: summary.duplicateExisting,
  };
  const willWrite = summary.valid + (strategy === "update" ? summary.duplicateExisting : 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ready to import" value={summary.valid} />
        <Metric label="Invalid (skipped)" value={summary.invalid} />
        <Metric label="Duplicates in file" value={summary.duplicateInFile} />
        <Metric label={`Already in contacts (${strategy === "update" ? "will update" : "will skip"})`} value={summary.duplicateExisting} />
      </div>

      {summary.invalid > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>{summary.invalid} row(s) have problems and will be skipped</AlertTitle>
          <AlertDescription>
            Fix them in your spreadsheet and re-import, or download them as a CSV.
            <Button variant="link" className="h-auto p-0" onClick={onDownload}>
              <Download className="size-3.5" /> Download problem rows
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "secondary" : "ghost"} onClick={() => setFilter(f.key)}>
            {f.label} <span className="text-muted-foreground tabular-nums">{counts[f.key]}</span>
          </Button>
        ))}
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Phone (E.164)</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Consent</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((r) => (
              <tr key={r.rowNumber} className={cn(r.status === "invalid" && "bg-red-500/5")}>
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{r.rowNumber}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <RowStatus status={r.status} />
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.contact?.phoneE164 ?? "—"}</td>
                <td className="px-3 py-1.5">{[r.contact?.firstName, r.contact?.lastName].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {r.contact ? `${r.contact.voiceConsent ? "voice " : ""}${r.contact.whatsappOptIn ? "whatsapp" : ""}`.trim() || "—" : "—"}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {r.errors.map((e, i) => (
                    <p key={i} className="text-red-700 dark:text-red-400">
                      {CONTACT_FIELDS[e.field as ContactFieldKey]?.label ?? "Row"}: {e.message}
                    </p>
                  ))}
                  {r.warnings.map((w, i) => (
                    <p key={i} className="text-amber-700 dark:text-amber-400">
                      {w.message}
                    </p>
                  ))}
                  {r.status === "duplicate_in_file" ? <p className="text-muted-foreground">Same number as row {r.duplicateOf}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing in this view.</p> : null}
      </div>
      {(filter === "all" ? summary.total : counts[filter]) > 200 ? <p className="text-xs text-muted-foreground">Showing the first 200 rows of this view.</p> : null}

      {working && progress > 0 ? <Progress value={progress} /> : null}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={working}>
          Back to mapping
        </Button>
        <Button onClick={onImport} disabled={working || willWrite === 0}>
          {working ? <Loader2 className="animate-spin" /> : null}
          Import {willWrite.toLocaleString()} contact(s)
        </Button>
      </div>
    </div>
  );
}

function RowStatus({ status }: { status: PreviewRowStatus }) {
  const styles: Record<PreviewRowStatus, string> = {
    valid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    invalid: "bg-red-500/10 text-red-700 dark:text-red-300",
    duplicate_in_file: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    duplicate_existing: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  };
  const label: Record<PreviewRowStatus, string> = { valid: "Ready", invalid: "Invalid", duplicate_in_file: "Duplicate", duplicate_existing: "Exists" };
  return <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", styles[status])}>{label[status]}</span>;
}
