// Applies every migration to an in-memory Postgres (PGlite) with minimal
// stand-ins for Supabase auth/storage, then exercises RLS and the live-mode
// guard as two different users. Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const db = new PGlite();

// Minimal stand-ins for Supabase's auth + storage schemas.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await db.exec(readFileSync(join(dir, f), "utf8"));
    console.log("applied", f);
  } catch (e) {
    console.error("FAILED", f, e.message);
    process.exit(1);
  }
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`);

let failures = 0;
async function as(user, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${user ? "authenticated" : "anon"};`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}
async function expectOk(label, user, sql, check) {
  try {
    const r = await as(user, sql);
    if (check && !check(r)) throw new Error("check failed: " + JSON.stringify(r.rows));
    console.log("  ok  ", label);
  } catch (e) {
    failures++;
    console.log("  FAIL", label, "-", e.message);
  }
}
async function expectErr(label, user, sql) {
  try {
    await as(user, sql);
    failures++;
    console.log("  FAIL", label, "- expected error");
  } catch (e) {
    console.log("  ok  ", label, "->", e.message.slice(0, 90));
  }
}

await expectOk("profile auto-created", A, "select * from profiles", (r) => r.rows.length === 1 && r.rows[0].role === "owner");
await expectErr("cannot self-promote role", A, "update profiles set role='admin'");
await expectOk("can rename self", A, "update profiles set full_name='Alice'");
await expectOk("A inserts contact", A, "insert into contacts (phone_e164, tags) values ('+919876543210', '{vip}')");
await expectErr("bad phone rejected", A, "insert into contacts (phone_e164) values ('98765')");
await expectErr("duplicate phone rejected", A, "insert into contacts (phone_e164) values ('+919876543210')");
await expectOk("B cannot see A contacts", B, "select * from contacts", (r) => r.rows.length === 0);
await expectErr("B cannot insert as A", B, `insert into contacts (owner_id, phone_e164) values ('${A}', '+14155550100')`);
await expectOk("anon sees nothing", null, "select 1", () => true);
await expectErr("anon cannot read contacts", null, "select * from contacts");
await expectOk("tag counts rpc", A, "select * from contact_tag_counts()", (r) => r.rows[0]?.tag === "vip");

await expectOk("A creates media", A, `insert into media_assets (kind, file_name, storage_path, mime_type, size_bytes) values ('audio','a.mp3','${A}/audio/x-a.mp3','audio/mpeg',100)`);
await expectErr("media path outside folder", A, `insert into media_assets (kind, file_name, storage_path, mime_type, size_bytes) values ('audio','a.mp3','${B}/audio/x.mp3','audio/mpeg',100)`);
await expectOk("A creates sim campaign", A, "insert into campaigns (channel, name) values ('voice', 'Test')");
await expectErr("A cannot create live campaign", A, "insert into campaigns (channel, name, mode) values ('voice', 'Live', 'live')");
await expectErr("whatsapp needs template beyond draft", A, "insert into campaigns (channel, name, status, scheduled_at) values ('whatsapp', 'W', 'scheduled', now())");
const mediaId = (await as(A, "select id from media_assets")).rows[0].id;
await expectErr("B cannot reference A media", B, `insert into campaigns (channel, name, media_asset_id) values ('voice','x','${mediaId}')`);

const campId = (await as(A, "select id from campaigns")).rows[0].id;
await expectOk("A adds recipient", A, `insert into campaign_recipients (campaign_id, phone_e164) values ('${campId}', '+919876543210')`);
await expectErr("B cannot add recipient to A campaign", B, `insert into campaign_recipients (campaign_id, phone_e164) values ('${campId}', '+919876543211')`);
const recId = (await as(A, "select id from campaign_recipients")).rows[0].id;
await expectOk("A logs sim attempt", A, `insert into delivery_attempts (campaign_id, recipient_id, channel, provider, mode, status) values ('${campId}','${recId}','voice','mock','simulation','answered')`);
await expectErr("live attempt on sim campaign blocked", A, `insert into delivery_attempts (campaign_id, recipient_id, channel, provider, mode, status) values ('${campId}','${recId}','voice','mock','live','answered')`);
await expectErr("attempts immutable", A, "update delivery_attempts set status='failed'");

await expectOk("audit insert", A, `insert into audit_logs (action, entity_type) values ('test','x')`);
await expectErr("audit forged actor", A, `insert into audit_logs (action, entity_type, actor_id) values ('test','x','${B}')`);
await expectErr("audit update denied", A, "update audit_logs set action='y'");
await expectErr("audit delete denied", A, "delete from audit_logs");

await expectOk("suppression insert", A, "insert into suppression_records (phone_e164, channel, reason) values ('+919876543210','all','opt_out')");

for (const t of ["provider_approval", "consent_policy", "dnc_registry_check", "live_mode_attestation"]) {
  await expectOk(`verify voice ${t}`, A, `insert into compliance_records (channel, record_type, title, status) values ('voice','${t}','${t}','verified') returning verified_by`, (r) => r.rows[0].verified_by === A);
}
await expectOk("live voice now allowed by DB", A, "update campaigns set mode='live' where channel='voice' returning id", (r) => r.rows.length === 1);
await expectOk("whatsapp still not ready", A, `select live_mode_ready('${A}', 'whatsapp') as ok`, (r) => r.rows[0].ok === false);
await expectOk("B voice not ready", B, `select live_mode_ready('${B}', 'voice') as ok`, (r) => r.rows[0].ok === false);
await expectOk("expired record no longer counts", A, `with u as (update compliance_records set expires_at = now() - interval '1 day' where record_type='consent_policy' returning 1) select (select count(*) from u) as n`, () => true);
await expectOk("expired check result", A, `select live_mode_ready('${A}','voice') as ok`, (r) => r.rows[0].ok === false);

await expectOk("storage own folder insert", A, `insert into storage.objects (bucket_id, name) values ('media', '${A}/audio/f.mp3')`);
await expectErr("storage other folder insert", A, `insert into storage.objects (bucket_id, name) values ('media', '${B}/audio/f.mp3')`);
await expectOk("storage B cannot read A", B, "select * from storage.objects", (r) => r.rows.length === 0);

console.log(failures ? `\n${failures} FAILURES` : "\nAll SQL checks passed");
process.exit(failures ? 1 : 0);
