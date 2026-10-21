-- ConnectHub core schema
-- Every business row is owned by a single auth user (owner_id) and protected
-- by row level security in 20261022000200_rls_and_guards.sql.
-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.channel as enum ('voice', 'whatsapp');
create type public.suppression_channel as enum ('voice', 'whatsapp', 'all');
create type public.delivery_mode as enum ('simulation', 'live');
create type public.user_role as enum ('owner', 'admin', 'operator', 'viewer');

create type public.campaign_status as enum (
  'draft', 'scheduled', 'running', 'completed', 'cancelled', 'failed'
);

create type public.recipient_status as enum (
  'pending',
  'skipped_suppressed',
  'skipped_no_consent',
  'skipped_invalid',
  -- voice outcomes
  'answered', 'voicemail', 'no_answer', 'busy',
  -- whatsapp outcomes
  'sent', 'delivered', 'read',
  -- shared
  'failed'
);

create type public.import_source as enum ('csv', 'xlsx', 'paste');
create type public.import_status as enum ('processing', 'completed', 'partial', 'failed');
create type public.media_kind as enum ('audio', 'image', 'video');

create type public.suppression_reason as enum (
  'opt_out', 'dnc_registry', 'complaint', 'invalid_number', 'manual'
);

create type public.compliance_record_type as enum (
  'provider_approval',
  'live_mode_attestation',
  'consent_policy',
  'template_approval',
  'business_verification',
  'dnc_registry_check'
);

create type public.compliance_status as enum ('pending', 'verified', 'rejected', 'expired');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        public.user_role not null default 'owner',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- contact_imports: one row per import run (file upload or paste)
-- ---------------------------------------------------------------------------
create table public.contact_imports (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name       text,
  source          public.import_source not null,
  status          public.import_status not null default 'processing',
  total_rows      integer not null default 0 check (total_rows >= 0),
  imported_rows   integer not null default 0 check (imported_rows >= 0),
  updated_rows    integer not null default 0 check (updated_rows >= 0),
  duplicate_rows  integer not null default 0 check (duplicate_rows >= 0),
  invalid_rows    integer not null default 0 check (invalid_rows >= 0),
  column_mapping  jsonb not null default '{}'::jsonb,
  -- capped sample of row-level errors: [{row, field, message}]
  errors          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index contact_imports_owner_idx on public.contact_imports (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  first_name        text,
  last_name         text,
  phone_e164        text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country_code      text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  tags              text[] not null default '{}',
  attributes        jsonb not null default '{}'::jsonb,
  -- consent is tracked per channel; campaigns never reach a contact without it
  voice_consent     boolean not null default false,
  whatsapp_opt_in   boolean not null default false,
  consent_source    text,
  consent_at        timestamptz,
  import_id         uuid references public.contact_imports (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contacts_owner_phone_unique unique (owner_id, phone_e164)
);

create index contacts_owner_created_idx on public.contacts (owner_id, created_at desc);
create index contacts_tags_idx on public.contacts using gin (tags);
create index contacts_import_idx on public.contacts (import_id);

create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- media_assets: metadata for files in the private `media` storage bucket
-- ---------------------------------------------------------------------------
create table public.media_assets (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              public.media_kind not null,
  file_name         text not null,
  storage_path      text not null unique,
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  duration_seconds  numeric(10, 2),
  width             integer,
  height            integer,
  created_at        timestamptz not null default now(),
  -- storage_path must live inside the owner's folder: <owner_id>/...
  constraint media_assets_path_in_owner_folder
    check (split_part(storage_path, '/', 1) = owner_id::text)
);

create index media_assets_owner_idx on public.media_assets (owner_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- campaigns: shared by both channels
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel                     public.channel not null,
  name                        text not null check (char_length(name) between 1 and 120),
  description                 text,
  status                      public.campaign_status not null default 'draft',
  mode                        public.delivery_mode not null default 'simulation',
  provider                    text not null default 'mock',
  -- audience definition: {"tags": [...], "match": "any" | "all"}
  segment                     jsonb not null default '{"tags": [], "match": "any"}'::jsonb,
  media_asset_id              uuid references public.media_assets (id) on delete set null,
  -- voice
  caller_id                   text,
  -- whatsapp
  whatsapp_template_name      text,
  whatsapp_template_language  text,
  template_variables          jsonb not null default '[]'::jsonb,
  scheduled_at                timestamptz,
  started_at                  timestamptz,
  completed_at                timestamptz,
  -- denormalised counters, refreshed after each run
  stats                       jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint campaigns_whatsapp_template_required
    check (channel <> 'whatsapp' or status = 'draft' or whatsapp_template_name is not null),
  constraint campaigns_voice_audio_required
    check (channel <> 'voice' or status = 'draft' or media_asset_id is not null),
  constraint campaigns_scheduled_requires_time
    check (status <> 'scheduled' or scheduled_at is not null)
);

create index campaigns_owner_channel_idx on public.campaigns (owner_id, channel, created_at desc);
create index campaigns_due_idx on public.campaigns (scheduled_at) where status = 'scheduled';

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_recipients: audience snapshot taken when a campaign runs
-- ---------------------------------------------------------------------------
create table public.campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  phone_e164       text not null,
  display_name     text,
  status           public.recipient_status not null default 'pending',
  status_reason    text,
  attempt_count    integer not null default 0,
  last_attempt_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint campaign_recipients_unique_phone unique (campaign_id, phone_e164)
);

create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id, status);
create index campaign_recipients_contact_idx on public.campaign_recipients (contact_id);

create trigger campaign_recipients_updated_at before update on public.campaign_recipients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- delivery_attempts: immutable log of every provider call (mock or live)
-- ---------------------------------------------------------------------------
create table public.delivery_attempts (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  campaign_id          uuid not null references public.campaigns (id) on delete cascade,
  recipient_id         uuid not null references public.campaign_recipients (id) on delete cascade,
  channel              public.channel not null,
  provider             text not null,
  mode                 public.delivery_mode not null,
  attempt_number       integer not null default 1,
  status               public.recipient_status not null,
  provider_message_id  text,
  error_code           text,
  error_message        text,
  duration_seconds     numeric(10, 2),
  request_payload      jsonb not null default '{}'::jsonb,
  response_payload     jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index delivery_attempts_campaign_idx on public.delivery_attempts (campaign_id, created_at desc);
create index delivery_attempts_recipient_idx on public.delivery_attempts (recipient_id);

-- ---------------------------------------------------------------------------
-- suppression_records: do-not-contact list, checked before every send
-- ---------------------------------------------------------------------------
create table public.suppression_records (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  phone_e164   text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  channel      public.suppression_channel not null default 'all',
  reason       public.suppression_reason not null default 'manual',
  source       text,
  notes        text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint suppression_unique unique (owner_id, phone_e164, channel)
);

create index suppression_owner_phone_idx on public.suppression_records (owner_id, phone_e164);

-- ---------------------------------------------------------------------------
-- compliance_records: evidence required before live mode can be used
-- ---------------------------------------------------------------------------
create table public.compliance_records (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel       public.channel not null,
  record_type   public.compliance_record_type not null,
  title         text not null,
  status        public.compliance_status not null default 'pending',
  reference     text,
  details       jsonb not null default '{}'::jsonb,
  verified_by   uuid references auth.users (id) on delete set null,
  verified_at   timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index compliance_owner_channel_idx on public.compliance_records (owner_id, channel, record_type);

create trigger compliance_records_updated_at before update on public.compliance_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs: append-only (no update/delete policies exist)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  actor_id     uuid default auth.uid() references auth.users (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index audit_logs_owner_idx on public.audit_logs (owner_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
