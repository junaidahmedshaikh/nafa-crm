-- NAFA Business OS — WhatsApp bulk messaging (consent, templates, campaigns, queue)
--
-- Design rules enforced here, not just in the UI:
--   * A contact can only be messaged after it is recorded as opted in, with a source (proof of consent).
--   * An opt-out is sticky: only an admin can turn it back into an opt-in.
--   * Template approval status is admin-controlled; editing an approved template sends it back to draft.
--   * Sending is queue based (one row per recipient) and claimed atomically, so two browser tabs can never
--     send the same message twice.
-- Secrets (WhatsApp access token etc.) are NOT stored here; they live in server environment variables.

-- ---------------------------------------------------------------------------
-- Consent on contacts
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column whatsapp_consent        text not null default 'unknown' check (whatsapp_consent in ('unknown', 'opted_in', 'opted_out')),
  add column whatsapp_consent_at     timestamptz,
  add column whatsapp_consent_source text check (whatsapp_consent_source is null or length(whatsapp_consent_source) <= 300),
  add constraint contacts_whatsapp_opt_in_has_source
    check (whatsapp_consent <> 'opted_in' or length(btrim(coalesce(whatsapp_consent_source, ''))) > 0);

create function public.contacts_whatsapp_consent_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.whatsapp_consent <> 'unknown' then new.whatsapp_consent_at := now(); end if;
    return new;
  end if;
  if new.whatsapp_consent is distinct from old.whatsapp_consent then
    if old.whatsapp_consent = 'opted_out' and new.whatsapp_consent = 'opted_in' and not public.is_admin() then
      raise exception 'OPT_OUT_LOCKED: this person opted out of WhatsApp; only an admin can record a new opt-in' using errcode = '42501';
    end if;
    new.whatsapp_consent_at := now();
  end if;
  return new;
end $$;
create trigger contacts_whatsapp_consent before insert or update on public.contacts
  for each row execute function public.contacts_whatsapp_consent_guard();

-- contact_list expands ct.*, so it must be rebuilt to expose the new columns.
drop view public.contact_list;
create view public.contact_list with (security_invoker = true) as
select
  ct.*,
  c.name as company_name,
  (select count(*)::int from public.leads l where l.contact_id = ct.id and l.archived_at is null) as lead_count
from public.contacts ct
left join public.companies c on c.id = ct.company_id;
revoke all on public.contact_list from anon;
grant select on public.contact_list to authenticated;

-- ---------------------------------------------------------------------------
-- Sending settings (singleton). Admin-editable; everyone on the team can read.
-- ---------------------------------------------------------------------------
create table public.whatsapp_settings (
  id                  boolean primary key default true check (id),
  mode                text not null default 'dry_run' check (mode in ('dry_run', 'live')),
  daily_limit         int  not null default 250 check (daily_limit between 1 and 1000000),   -- your current Meta tier, per rolling 24h
  batch_size          int  not null default 20  check (batch_size between 1 and 100),
  send_gap_ms         int  not null default 1000 check (send_gap_ms between 0 and 10000),
  repeat_window_days  int  not null default 3   check (repeat_window_days between 0 and 365),  -- do not message the same person again within N days
  cost_per_message    numeric(8, 2) check (cost_per_message is null or cost_per_message >= 0),  -- your Meta rate, for the cost estimate
  updated_at          timestamptz not null default now()
);
create trigger whatsapp_settings_updated_at before update on public.whatsapp_settings
  for each row execute function public.set_updated_at();
insert into public.whatsapp_settings default values;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table public.whatsapp_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (name ~ '^[a-z][a-z0-9_]{0,59}$'),         -- Meta: lowercase letters, digits, underscores
  language          text not null default 'en' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  category          text not null check (category in ('marketing', 'utility')),
  body              text not null check (length(btrim(body)) between 1 and 1024),   -- uses {{first_name}}-style placeholders
  footer            text check (footer is null or length(footer) <= 60),
  status            text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected')),
  meta_template_id  text,
  rejection_reason  text,
  archived_at       timestamptz,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (name, language)
);
create trigger whatsapp_templates_updated_at before update on public.whatsapp_templates
  for each row execute function public.set_updated_at();

create function public.whatsapp_templates_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not public.is_admin() then
      raise exception 'ADMIN_ONLY: only an admin can set the approval status' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'ADMIN_ONLY: only an admin can set the approval status' using errcode = '42501';
  end if;
  -- Meta must re-approve any change to the message itself.
  if new.status = old.status and old.status <> 'draft'
     and (new.body, new.footer, new.category, new.language) is distinct from (old.body, old.footer, old.category, old.language) then
    new.status := 'draft';
    new.meta_template_id := null;
    new.rejection_reason := null;
  end if;
  return new;
end $$;
create trigger whatsapp_templates_guard before insert or update on public.whatsapp_templates
  for each row execute function public.whatsapp_templates_guard();

-- ---------------------------------------------------------------------------
-- Campaigns and their per-recipient messages
-- ---------------------------------------------------------------------------
create table public.whatsapp_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 150),
  template_id    uuid not null references public.whatsapp_templates (id) on delete restrict,
  status         text not null default 'ready' check (status in ('ready', 'sending', 'paused', 'completed', 'cancelled')),
  mode           text not null check (mode in ('dry_run', 'live')),                  -- the mode it was created in
  custom_values  jsonb not null default '{}'::jsonb,                                 -- campaign-wide placeholders, e.g. event_name
  paused_reason  text,
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create index whatsapp_campaigns_created_idx on public.whatsapp_campaigns (created_at desc);
create trigger whatsapp_campaigns_updated_at before update on public.whatsapp_campaigns
  for each row execute function public.set_updated_at();

create table public.whatsapp_messages (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.whatsapp_campaigns (id) on delete cascade,
  contact_id            uuid not null references public.contacts (id) on delete restrict,
  to_phone              text not null,                                                -- +E.164 at the time of queuing
  body                  text not null,                                                -- the rendered text, kept as sent
  params                jsonb not null default '[]'::jsonb,                           -- ordered template variable values sent to Meta
  status                text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  error                 text,
  provider_message_id   text,
  queued_at             timestamptz not null default now(),
  sent_at               timestamptz,
  delivered_at          timestamptz,
  read_at               timestamptz,
  updated_at            timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index whatsapp_messages_campaign_idx on public.whatsapp_messages (campaign_id, status);
create index whatsapp_messages_contact_idx  on public.whatsapp_messages (contact_id, sent_at desc);
create index whatsapp_messages_sent_idx     on public.whatsapp_messages (sent_at) where sent_at is not null;
create index whatsapp_messages_provider_idx on public.whatsapp_messages (provider_message_id) where provider_message_id is not null;
create trigger whatsapp_messages_updated_at before update on public.whatsapp_messages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS: team members work with all of it; only admins change settings or hard-delete.
-- ---------------------------------------------------------------------------
revoke all on public.whatsapp_settings, public.whatsapp_templates, public.whatsapp_campaigns, public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_settings to authenticated;
grant update (mode, daily_limit, batch_size, send_gap_ms, repeat_window_days, cost_per_message) on public.whatsapp_settings to authenticated;
grant select, insert, update, delete on public.whatsapp_templates, public.whatsapp_campaigns, public.whatsapp_messages to authenticated;

alter table public.whatsapp_settings  enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_campaigns enable row level security;
alter table public.whatsapp_messages  enable row level security;

create policy whatsapp_settings_select on public.whatsapp_settings for select to authenticated using ((select public.is_team_member()));
create policy whatsapp_settings_update on public.whatsapp_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy whatsapp_templates_select on public.whatsapp_templates for select to authenticated using ((select public.is_team_member()));
create policy whatsapp_templates_insert on public.whatsapp_templates for insert to authenticated with check ((select public.is_team_member()));
create policy whatsapp_templates_update on public.whatsapp_templates for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy whatsapp_templates_delete on public.whatsapp_templates for delete to authenticated using ((select public.is_admin()));

create policy whatsapp_campaigns_select on public.whatsapp_campaigns for select to authenticated using ((select public.is_team_member()));
create policy whatsapp_campaigns_insert on public.whatsapp_campaigns for insert to authenticated with check ((select public.is_team_member()));
create policy whatsapp_campaigns_update on public.whatsapp_campaigns for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy whatsapp_campaigns_delete on public.whatsapp_campaigns for delete to authenticated using ((select public.is_admin()));

create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated using ((select public.is_team_member()));
create policy whatsapp_messages_insert on public.whatsapp_messages for insert to authenticated with check ((select public.is_team_member()));
create policy whatsapp_messages_update on public.whatsapp_messages for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy whatsapp_messages_delete on public.whatsapp_messages for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Queue helpers (security invoker, so RLS still applies)
-- ---------------------------------------------------------------------------
-- Atomically claims up to p_limit queued messages. SKIP LOCKED means concurrent callers get different rows.
create function public.whatsapp_claim_messages(p_campaign uuid, p_limit int) returns setof public.whatsapp_messages
language sql as $$
  update public.whatsapp_messages m set status = 'sending'
  where m.id in (
    select id from public.whatsapp_messages
    where campaign_id = p_campaign and status = 'queued'
    order by queued_at, id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  returning m.*;
$$;

-- A message stuck in 'sending' (the server stopped mid-send) is not retried automatically: it may already have
-- gone out, and a duplicate message to a customer is worse than a failed one that a person can re-check.
create function public.whatsapp_reap_stuck(p_campaign uuid) returns int
language sql as $$
  with r as (
    update public.whatsapp_messages
       set status = 'failed', error = 'Interrupted while sending. Check the recipient before sending again.'
     where campaign_id = p_campaign and status = 'sending' and updated_at < now() - interval '10 minutes'
    returning 1)
  select count(*)::int from r;
$$;

create function public.whatsapp_sent_last_24h() returns int
language sql stable as $$
  select count(*)::int from public.whatsapp_messages where sent_at >= now() - interval '24 hours';
$$;

create function public.whatsapp_campaign_counts(p_campaign uuid) returns table (status text, n int)
language sql stable as $$
  select m.status, count(*)::int from public.whatsapp_messages m where m.campaign_id = p_campaign group by m.status;
$$;

revoke all on function public.whatsapp_claim_messages(uuid, int), public.whatsapp_reap_stuck(uuid),
  public.whatsapp_sent_last_24h(), public.whatsapp_campaign_counts(uuid) from public, anon;
grant execute on function public.whatsapp_claim_messages(uuid, int), public.whatsapp_reap_stuck(uuid),
  public.whatsapp_sent_last_24h(), public.whatsapp_campaign_counts(uuid) to authenticated;
