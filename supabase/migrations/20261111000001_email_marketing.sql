-- NAFA Business OS — AI Email Marketing (Phases 1-3: audience, compose, approval, queue-based sending)
--
-- Reuses contacts / companies / leads / profiles. Additive only: existing screens keep working.
--   contacts.state / email_status / categories   audience selection + eligibility (valid | invalid | bounced | unsubscribed)
--   email_settings        singleton: sender identity, postal address, sending limits and window (IST)
--   email_suppressions    central do-not-email list (unique per address)
--   email_templates       reusable templates (none seeded; teams create their own)
--   email_campaigns       campaign + approval state; only an admin can activate it (trigger-enforced)
--   email_recipients      one row per (campaign, address): the send queue, with idempotency key + unsubscribe token
--   email_audit_log       append-only log of campaign actions
-- Sending is done by a server-side queue processor; the browser is never the scheduler.

alter table public.contacts
  add column state        text,
  add column email_status text not null default 'valid' check (email_status in ('valid', 'invalid', 'bounced', 'unsubscribed')),
  add column categories   text[] not null default '{}';
create index contacts_email_status_idx on public.contacts (email_status);

-- ---------------------------------------------------------------------------
create table public.email_settings (
  id                boolean primary key default true check (id),
  sender_name       text not null default 'NAFA Events & Activations',
  sender_email      text not null default '',                 -- must be on a domain verified with the provider
  reply_to          text not null default '',
  postal_address    text not null default '',                 -- required in every footer; campaigns cannot be approved while blank
  signature_html    text not null default '<p>Best regards,<br>NAFA Events &amp; Activations<br><a href="https://www.nafaevents.in/">https://www.nafaevents.in/</a></p>',
  daily_limit       integer not null default 50 check (daily_limit between 1 and 5000),   -- set to your provider/account limit
  batch_size        integer not null default 5 check (batch_size between 1 and 100),       -- emails per processor run
  window_start      time not null default '09:00',            -- IST
  window_end        time not null default '18:00',            -- IST
  updated_at        timestamptz not null default now()
);
insert into public.email_settings (id) values (true);
create trigger email_settings_updated_at before update on public.email_settings
  for each row execute function public.set_updated_at();

create table public.email_suppressions (
  id               uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  email            text not null,
  reason           text not null check (reason in ('unsubscribed', 'bounced', 'complaint', 'invalid', 'manual')),
  source           text not null default '',
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  category    text not null default 'general',
  subject     text not null default '',
  body_html   text not null default '',
  is_system   boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger email_templates_updated_at before update on public.email_templates
  for each row execute function public.set_updated_at();

create table public.email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 1 and 200),
  objective       text not null default '',
  status          text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'paused', 'stopped', 'completed')),
  subject         text not null default '',
  body_html       text not null default '',
  style           text not null default 'professional',
  sender_name     text not null default '',
  sender_email    text not null default '',
  reply_to        text not null default '',
  audience        jsonb not null default '{}'::jsonb,         -- filters used to pick recipients
  fallbacks       jsonb not null default '{}'::jsonb,         -- variable -> fallback value
  scheduled_at    timestamptz,
  daily_limit     integer check (daily_limit is null or daily_limit between 1 and 5000),
  salesperson_name text not null default '',
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz,
  completed_at    timestamptz,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index email_campaigns_status_idx on public.email_campaigns (status, scheduled_at);
create trigger email_campaigns_updated_at before update on public.email_campaigns
  for each row execute function public.set_updated_at();

-- Only an administrator (or the server-side processor, which has no end-user) may activate a campaign.
create function public.email_campaigns_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status in ('scheduled', 'sending', 'completed') and old.status is distinct from new.status then
      raise exception 'ADMIN_APPROVAL_REQUIRED' using errcode = '42501';
    end if;
    if old.status in ('paused') and new.status = 'sending' then
      raise exception 'ADMIN_APPROVAL_REQUIRED' using errcode = '42501';
    end if;
  end if;
  -- content is frozen once a campaign leaves draft; move it back to draft to edit (this clears the approval in the app)
  if old.status <> 'draft' and (new.subject is distinct from old.subject or new.body_html is distinct from old.body_html) then
    raise exception 'CAMPAIGN_LOCKED' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger email_campaigns_guard before update on public.email_campaigns
  for each row execute function public.email_campaigns_guard();

create table public.email_recipients (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.email_campaigns (id) on delete cascade,
  contact_id        uuid references public.contacts (id) on delete set null,
  email             text not null,
  email_normalized  text not null,
  full_name         text not null default '',
  status            text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  skip_reason       text,                                      -- invalid | duplicate | unsubscribed | bounced | suppressed | missing_field | stopped
  missing_fields    text[] not null default '{}',
  idempotency_key   uuid not null default gen_random_uuid(),
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  attempts          integer not null default 0,
  last_error        text,
  next_attempt_at   timestamptz,
  claimed_at        timestamptz,
  provider_id       text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (campaign_id, email_normalized)                       -- no duplicate emails within a campaign
);
create index email_recipients_queue_idx on public.email_recipients (campaign_id, status, next_attempt_at);
create index email_recipients_sent_idx on public.email_recipients (sent_at) where status = 'sent';
create index email_recipients_email_idx on public.email_recipients (email_normalized);

create table public.email_audit_log (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.email_campaigns (id) on delete cascade,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  actor       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index email_audit_campaign_idx on public.email_audit_log (campaign_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Queue claiming (row-locked, so two processors can never take the same recipient) and public unsubscribe
-- ---------------------------------------------------------------------------
create function public.claim_email_recipients(p_campaign uuid, p_limit integer)
returns setof public.email_recipients
language plpgsql security definer set search_path = '' as $$
begin
  -- the server-side processor (no end-user) or an administrator
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;
  return query
  update public.email_recipients r
     set status = 'sending', attempts = r.attempts + 1, claimed_at = now()
   where r.id in (
     select q.id from public.email_recipients q
      where q.campaign_id = p_campaign
        and ((q.status = 'pending' and (q.next_attempt_at is null or q.next_attempt_at <= now()))
          or (q.status = 'sending' and q.claimed_at < now() - interval '10 minutes'))
      order by q.created_at
      limit greatest(p_limit, 0)
      for update skip locked)
  returning r.*;
end $$;
revoke all on function public.claim_email_recipients(uuid, integer) from public, anon;
grant execute on function public.claim_email_recipients(uuid, integer) to authenticated;

/** Public (token holder only). Adds the address to the suppression list immediately and cancels its queued emails. */
create function public.unsubscribe_by_token(p_token uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare rec record;
begin
  select * into rec from public.email_recipients where unsubscribe_token = p_token;
  if not found then return 'invalid'; end if;
  insert into public.email_suppressions (email_normalized, email, reason, source)
  values (rec.email_normalized, rec.email, 'unsubscribed', 'unsubscribe link')
  on conflict (email_normalized) do nothing;
  update public.email_recipients set status = 'skipped', skip_reason = 'unsubscribed'
   where email_normalized = rec.email_normalized and status in ('pending', 'sending');
  update public.contacts set email_status = 'unsubscribed' where email_normalized = rec.email_normalized;
  insert into public.email_audit_log (campaign_id, action, details, actor)
  values (rec.campaign_id, 'unsubscribed', jsonb_build_object('email', rec.email), null);
  return 'ok';
end $$;
revoke all on function public.unsubscribe_by_token(uuid) from public;
grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_email_recipients(uuid, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
revoke all on public.email_settings, public.email_suppressions, public.email_templates, public.email_campaigns,
              public.email_recipients, public.email_audit_log from anon, authenticated;
grant select on public.email_settings, public.email_suppressions, public.email_templates, public.email_campaigns,
                public.email_recipients, public.email_audit_log to authenticated;
grant update (sender_name, sender_email, reply_to, postal_address, signature_html, daily_limit, batch_size, window_start, window_end)
  on public.email_settings to authenticated;
grant insert, delete on public.email_suppressions to authenticated;
grant insert, update, delete on public.email_templates to authenticated;
grant insert, update, delete on public.email_campaigns to authenticated;
grant insert, update, delete on public.email_recipients to authenticated;
grant insert on public.email_audit_log to authenticated;

alter table public.email_settings     enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_templates    enable row level security;
alter table public.email_campaigns    enable row level security;
alter table public.email_recipients   enable row level security;
alter table public.email_audit_log    enable row level security;

create policy email_settings_select on public.email_settings for select to authenticated using (public.is_team_member());
create policy email_settings_update on public.email_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy email_supp_select on public.email_suppressions for select to authenticated using (public.is_team_member());
create policy email_supp_insert on public.email_suppressions for insert to authenticated with check (public.is_team_member());
create policy email_supp_delete on public.email_suppressions for delete to authenticated using (public.is_admin());   -- only an admin can re-enable an address

create policy email_tpl_select on public.email_templates for select to authenticated using (public.is_team_member());
create policy email_tpl_insert on public.email_templates for insert to authenticated with check (public.is_team_member() and not is_system);
create policy email_tpl_update on public.email_templates for update to authenticated using (public.is_team_member() and not is_system) with check (public.is_team_member() and not is_system);
create policy email_tpl_delete on public.email_templates for delete to authenticated using (public.is_team_member() and not is_system);

create policy email_camp_select on public.email_campaigns for select to authenticated using (public.is_team_member());
create policy email_camp_insert on public.email_campaigns for insert to authenticated with check (public.is_team_member() and status = 'draft');
create policy email_camp_update on public.email_campaigns for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy email_camp_delete on public.email_campaigns for delete to authenticated using (public.is_team_member() and status = 'draft');

create policy email_rcpt_select on public.email_recipients for select to authenticated using (public.is_team_member());
create policy email_rcpt_insert on public.email_recipients for insert to authenticated with check (public.is_team_member());
create policy email_rcpt_update on public.email_recipients for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy email_rcpt_delete on public.email_recipients for delete to authenticated using (public.is_team_member());

create policy email_audit_select on public.email_audit_log for select to authenticated using (public.is_team_member());
create policy email_audit_insert on public.email_audit_log for insert to authenticated with check (public.is_team_member());
