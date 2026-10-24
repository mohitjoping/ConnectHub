// Minimal in-memory stand-in for the parts of supabase-js the campaign engine
// uses: chained table queries and storage signed URLs. Not a Postgres
// emulator — RLS and triggers are covered by `npm run test:db` instead.
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const DEFAULTS: Record<string, Row> = {
  campaigns: { status: "draft", mode: "simulation", provider: "mock", segment: { tags: [], match: "any" }, template_variables: [], stats: {}, media_asset_id: null, caller_id: null, started_at: null, completed_at: null, scheduled_at: null },
  campaign_recipients: { status: "pending", status_reason: null, attempt_count: 0, last_attempt_at: null },
  contacts: { tags: [], voice_consent: false, whatsapp_opt_in: false, first_name: null, last_name: null, email: null },
  suppression_records: { channel: "all", expires_at: null },
  compliance_records: { status: "pending", expires_at: null },
};

// Mirrors the unique constraints in the migrations.
const UNIQUE: Record<string, string[]> = {
  contacts: ["owner_id", "phone_e164"],
  campaign_recipients: ["campaign_id", "phone_e164"],
  suppression_records: ["owner_id", "phone_e164", "channel"],
};

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** make the next write to this table fail with the given message */
  failNextWrite: Record<string, string>;
  client: SupabaseClient;
}

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count?: number | null }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private returning = false;
  private singleMode: "one" | "maybe" | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private countMode = false;
  private head = false;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.countMode = Boolean(opts?.count);
      this.head = Boolean(opts?.head);
    } else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) <= v);
    return this;
  }
  contains(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.every((v) => (r[col] as unknown[]).includes(v)));
    return this;
  }
  overlaps(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.some((v) => (r[col] as unknown[]).includes(v)));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { col, asc: opts.ascending !== false };
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.rangeTo = this.rangeFrom + n - 1;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  single() {
    this.singleMode = "one";
    return this;
  }

  private rows() {
    return (this.db.tables[this.table] ??= []);
  }

  private execute() {
    const failure = this.op !== "select" ? this.db.failNextWrite[this.table] : undefined;
    if (failure) {
      delete this.db.failNextWrite[this.table];
      return { data: null, error: { message: failure } };
    }
    const all = this.rows();
    let result: Row[] = [];

    if (this.op === "insert" || this.op === "upsert") {
      const conflict = this.upsertOpts.onConflict?.split(",");
      for (const input of this.payload) {
        const existing = conflict ? all.find((r) => conflict.every((c) => r[c] === input[c])) : undefined;
        const unique = UNIQUE[this.table];
        const row0 = { ...DEFAULTS[this.table], ...input };
        const clash = unique && all.find((r) => unique.every((c) => r[c] === row0[c]));
        if (this.op === "insert" && clash) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        if (existing) {
          if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, input);
          result.push(existing);
          continue;
        }
        const row = { ...DEFAULTS[this.table], id: nextId(), created_at: new Date(Date.now() + all.length).toISOString(), ...input };
        all.push(row);
        result.push(row);
      }
    } else {
      let matched = all.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") matched.forEach((r) => Object.assign(r, this.patch));
      if (this.op === "delete") this.db.tables[this.table] = all.filter((r) => !matched.includes(r));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        matched = [...matched].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      result = this.op === "select" ? matched.slice(this.rangeFrom, this.rangeTo + 1) : matched;
      if (this.op === "select" && this.countMode) {
        return { data: this.head ? null : result.map((r) => ({ ...r })), error: null, count: matched.length };
      }
    }

    if (this.op !== "select" && !this.returning && !this.singleMode) return { data: null, error: null };
    const copies = result.map((r) => ({ ...r }));
    if (this.singleMode === "maybe") return { data: copies[0] ?? null, error: null };
    if (this.singleMode === "one") return copies.length === 1 ? { data: copies[0], error: null } : { data: null, error: { message: "not exactly one row" } };
    return { data: copies, error: null };
  }

  then<A, B>(onFulfilled?: ((v: ReturnType<Query["execute"]>) => A | PromiseLike<A>) | null, onRejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeDb {
  const db = { tables: structuredClone(seed), failNextWrite: {} } as FakeDb;
  db.client = {
    from: (table: string) => new Query(db, table),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) =>
          path.includes("missing") ? { data: null, error: { message: "Object not found" } } : { data: { signedUrl: `https://storage.test/${path}?token=x` }, error: null },
      }),
    },
  } as unknown as SupabaseClient;
  return db;
}
