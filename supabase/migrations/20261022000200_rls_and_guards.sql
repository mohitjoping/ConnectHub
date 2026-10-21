-- Row level security, privilege hardening and the live-mode guard.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.contact_imports      enable row level security;
alter table public.contacts             enable row level security;
alter table public.media_assets         enable row level security;
alter table public.campaigns            enable row level security;
alter table public.campaign_recipients  enable row level security;
alter table public.delivery_attempts    enable row level security;
alter table public.suppression_records  enable row level security;
alter table public.compliance_records   enable row level security;
alter table public.audit_logs           enable row level security;

-- Anonymous visitors never touch application tables.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles: read/update own row; role is not self-editable
-- ---------------------------------------------------------------------------
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Simple owner-only tables
-- ---------------------------------------------------------------------------
create policy "contact_imports: owner all" on public.contact_imports
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "contacts: owner all" on public.contacts
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      import_id is null
      or exists (
        select 1 from public.contact_imports i
        where i.id = import_id and i.owner_id = (select auth.uid())
      )
    )
  );

create policy "media_assets: owner all" on public.media_assets
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "suppression_records: owner all" on public.suppression_records
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "compliance_records: owner all" on public.compliance_records
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- campaigns: referenced media must also belong to the owner
-- ---------------------------------------------------------------------------
create policy "campaigns: owner all" on public.campaigns
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      media_asset_id is null
      or exists (
        select 1 from public.media_assets m
        where m.id = media_asset_id and m.owner_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- campaign_recipients / delivery_attempts: parent campaign must be owned
-- ---------------------------------------------------------------------------
create policy "campaign_recipients: owner all" on public.campaign_recipients
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = (select auth.uid())
    )
  );

create policy "delivery_attempts: owner read" on public.delivery_attempts
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "delivery_attempts: owner insert" on public.delivery_attempts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.campaign_recipients r
      where r.id = recipient_id
        and r.campaign_id = delivery_attempts.campaign_id
        and r.owner_id = (select auth.uid())
    )
  );

-- Attempts are an immutable record of what was sent.
revoke update, delete on public.delivery_attempts from authenticated;

-- ---------------------------------------------------------------------------
-- audit_logs: append-only
-- ---------------------------------------------------------------------------
create policy "audit_logs: owner read" on public.audit_logs
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "audit_logs: owner insert" on public.audit_logs
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and actor_id = (select auth.uid()));

revoke update, delete on public.audit_logs from authenticated;

-- ---------------------------------------------------------------------------
-- Compliance verification stamps who verified it and when.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_compliance_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.user_role;
begin
  if new.status = 'verified'
     and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    if auth.uid() is not null then
      select role into caller_role from public.profiles where id = auth.uid();
      if caller_role is null or caller_role not in ('owner', 'admin') then
        raise exception 'Only owners or admins can verify compliance records'
          using errcode = '42501';
      end if;
    end if;
    new.verified_by = auth.uid();
    new.verified_at = now();
  elsif new.status <> 'verified' then
    new.verified_by = null;
    new.verified_at = null;
  end if;
  return new;
end;
$$;

create trigger compliance_records_stamp
  before insert or update of status on public.compliance_records
  for each row execute function public.stamp_compliance_verification();

-- ---------------------------------------------------------------------------
-- Live-mode guard. Mirrors src/lib/compliance/requirements.ts — keep in sync.
-- A campaign can only be saved in live mode when every required compliance
-- record for its channel is verified and unexpired. The application adds a
-- second gate (LIVE_*_ENABLED env flags + a configured live provider).
-- ---------------------------------------------------------------------------
create or replace function public.required_compliance_types(p_channel public.channel)
returns public.compliance_record_type[]
language sql
immutable
as $$
  select case p_channel
    when 'voice' then array[
      'provider_approval', 'consent_policy', 'dnc_registry_check', 'live_mode_attestation'
    ]::public.compliance_record_type[]
    when 'whatsapp' then array[
      'provider_approval', 'business_verification', 'template_approval',
      'consent_policy', 'live_mode_attestation'
    ]::public.compliance_record_type[]
  end;
$$;

create or replace function public.live_mode_ready(p_owner uuid, p_channel public.channel)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from unnest(public.required_compliance_types(p_channel)) as req(record_type)
    where not exists (
      select 1 from public.compliance_records r
      where r.owner_id = p_owner
        and r.channel = p_channel
        and r.record_type = req.record_type
        and r.status = 'verified'
        and (r.expires_at is null or r.expires_at > now())
    )
  );
$$;

create or replace function public.enforce_live_mode()
returns trigger
language plpgsql
as $$
begin
  if new.mode = 'live' and not public.live_mode_ready(new.owner_id, new.channel) then
    raise exception 'Live mode blocked: required % compliance records are not all verified', new.channel
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger campaigns_enforce_live_mode
  before insert or update of mode, status on public.campaigns
  for each row execute function public.enforce_live_mode();

-- Delivery attempts must match their campaign's mode (no sneaking a live
-- attempt into a simulation campaign).
create or replace function public.enforce_attempt_mode()
returns trigger
language plpgsql
as $$
declare
  campaign_mode public.delivery_mode;
begin
  select mode into campaign_mode from public.campaigns where id = new.campaign_id;
  if campaign_mode is distinct from new.mode then
    raise exception 'Delivery attempt mode (%) does not match campaign mode (%)', new.mode, campaign_mode;
  end if;
  return new;
end;
$$;

create trigger delivery_attempts_enforce_mode
  before insert on public.delivery_attempts
  for each row execute function public.enforce_attempt_mode();

-- ---------------------------------------------------------------------------
-- Helper RPC: tag counts for the segment picker (runs with caller's RLS)
-- ---------------------------------------------------------------------------
create or replace function public.contact_tag_counts()
returns table (tag text, contact_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.tag, count(*)::bigint
  from public.contacts c, unnest(c.tags) as t(tag)
  where c.owner_id = auth.uid()
  group by t.tag
  order by t.tag;
$$;

revoke execute on function public.contact_tag_counts() from anon;
revoke execute on function public.live_mode_ready(uuid, public.channel) from anon;
