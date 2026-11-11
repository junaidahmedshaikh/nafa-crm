-- NAFA Business OS — AI Business Development Manager
--
-- Reuses leads / companies / contacts / follow_ups / quotations / proposals / lead_activities.
-- New tables only hold what the CRM did not have:
--   bdm_settings         singleton: briefing time (IST), e-mail delivery, thresholds
--   bdm_briefings        one row per IST day: the computed snapshot (CRM facts) + the AI narrative (kept separate)
--   bdm_recommendations  durable record of every recommendation / action-plan item and what happened to it
--   bdm_job_runs         log of scheduled / manual runs (status, attempts, error) for monitoring
-- Replies and sent messages are recorded as lead_activities (two new activity types), so no new log table.

alter type public.activity_type add value if not exists 'reply_received';
alter type public.activity_type add value if not exists 'message_sent';

create table public.bdm_settings (
  id                     boolean primary key default true check (id),
  enabled                boolean not null default true,
  briefing_time          time not null default '08:30',            -- IST wall clock
  email_enabled          boolean not null default false,
  email_recipients       text[] not null default '{}',
  inactive_days          integer not null default 30 check (inactive_days between 7 and 365),
  proposal_followup_days integer not null default 3 check (proposal_followup_days between 1 and 60),
  updated_at             timestamptz not null default now()
);
insert into public.bdm_settings (id) values (true);
create trigger bdm_settings_updated_at before update on public.bdm_settings
  for each row execute function public.set_updated_at();

create table public.bdm_briefings (
  id             uuid primary key default gen_random_uuid(),
  briefing_date  date not null unique,                            -- IST calendar date
  generated_at   timestamptz not null default now(),
  trigger        text not null check (trigger in ('cron', 'manual', 'catchup')),
  data           jsonb not null default '{}'::jsonb,              -- deterministic CRM snapshot (facts)
  summary        text,                                            -- AI-written narrative (not a fact source)
  ai_status      text not null default 'unavailable' check (ai_status in ('ok', 'unavailable', 'failed')),
  ai_error       text,
  email_status   text not null default 'not_requested' check (email_status in ('not_requested', 'sent', 'failed', 'not_configured')),
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null
);

create table public.bdm_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  for_date           date not null,
  dedupe_key         text not null,                               -- e.g. prospect:<lead_id> — one per subject per day
  kind               text not null check (kind in ('prospect', 'proposal', 'reply', 'meeting', 'reconnect', 'general')),
  lead_id            uuid references public.leads (id) on delete cascade,
  quotation_id       uuid references public.quotations (id) on delete set null,
  proposal_id        uuid references public.proposals (id) on delete set null,
  title              text not null,
  action             text not null,
  reason             text not null,                               -- rule-derived, cites CRM facts
  channel            text check (channel in ('call', 'email', 'whatsapp', 'meeting', 'general_task')),
  suggested_service  text,
  priority           integer not null default 50,
  draft_subject      text,                                        -- AI-generated, only when requested
  draft_body         text,
  draft_generated_at timestamptz,
  state              text not null default 'open' check (state in ('open', 'done', 'snoozed', 'dismissed')),
  snoozed_until      timestamptz,
  follow_up_id       uuid references public.follow_ups (id) on delete set null,
  assigned_to        uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (dedupe_key, for_date)
);
create index bdm_recommendations_date_idx on public.bdm_recommendations (for_date desc, priority desc);
create index bdm_recommendations_lead_idx on public.bdm_recommendations (lead_id);
create trigger bdm_recommendations_updated_at before update on public.bdm_recommendations
  for each row execute function public.set_updated_at();

create table public.bdm_job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,
  status       text not null default 'running' check (status in ('running', 'success', 'failed', 'skipped')),
  attempts     integer not null default 1,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text,
  details      jsonb not null default '{}'::jsonb
);
create index bdm_job_runs_started_idx on public.bdm_job_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- RLS: team members read everything here and act on recommendations; only admins change settings.
-- Scheduled runs use the service role (bypasses RLS).
-- ---------------------------------------------------------------------------
revoke all on public.bdm_settings, public.bdm_briefings, public.bdm_recommendations, public.bdm_job_runs from anon, authenticated;
grant select on public.bdm_settings, public.bdm_briefings, public.bdm_recommendations to authenticated;
grant update (enabled, briefing_time, email_enabled, email_recipients, inactive_days, proposal_followup_days)
  on public.bdm_settings to authenticated;
grant insert, update on public.bdm_briefings to authenticated;
grant insert, update on public.bdm_recommendations to authenticated;
grant select on public.bdm_job_runs to authenticated;

alter table public.bdm_settings        enable row level security;
alter table public.bdm_briefings       enable row level security;
alter table public.bdm_recommendations enable row level security;
alter table public.bdm_job_runs        enable row level security;

create policy bdm_settings_select on public.bdm_settings for select to authenticated using (public.is_team_member());
create policy bdm_settings_update on public.bdm_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy bdm_briefings_select on public.bdm_briefings for select to authenticated using (public.is_team_member());
create policy bdm_briefings_insert on public.bdm_briefings for insert to authenticated with check (public.is_team_member());
create policy bdm_briefings_update on public.bdm_briefings for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create policy bdm_recs_select on public.bdm_recommendations for select to authenticated using (public.is_team_member());
create policy bdm_recs_insert on public.bdm_recommendations for insert to authenticated with check (public.is_team_member());
create policy bdm_recs_update on public.bdm_recommendations for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create policy bdm_job_runs_select on public.bdm_job_runs for select to authenticated using (public.is_admin());
