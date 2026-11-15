-- NAFA Business OS — Daily Business Briefing
--
-- Reuses: the AI BD Manager snapshot (leads, follow-ups, proposals), invoices / payments, projects and project finance,
--         vendor rates, scheduled emails, the notification bell, the existing email provider and the existing cron routes.
-- Adds:   daily_briefing_settings  singleton: on/off, time, time zone, delivery method, recipient, days
--         daily_briefings          one stored report per day (plus test runs) with its delivery status = the history
--
-- Additive and idempotent. The briefing contains financial figures, so both tables are limited to administrators and the
-- accounts / management roles; only an administrator can change the settings.

create table if not exists public.daily_briefing_settings (
  id              boolean primary key default true check (id),
  enabled         boolean not null default false,
  delivery_time   time not null default '08:30',
  timezone        text not null default 'Asia/Kolkata',
  method          text not null default 'both' check (method in ('email', 'in_app', 'both')),
  recipient_email text not null default '',
  days            text not null default 'all' check (days in ('all', 'weekdays', 'custom')),
  custom_days     smallint[] not null default '{0,1,2,3,4,5,6}',     -- 0 = Sunday … 6 = Saturday
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint daily_briefing_days_range check (custom_days <@ array[0,1,2,3,4,5,6]::smallint[])
);
insert into public.daily_briefing_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.daily_briefings (
  id              uuid primary key default gen_random_uuid(),
  briefing_date   date not null,                                  -- calendar date in the configured time zone
  kind            text not null default 'scheduled' check (kind in ('scheduled', 'test')),
  data            jsonb not null default '{}'::jsonb,             -- the facts, exactly as read from the CRM
  summary         text not null default '',                       -- executive summary (AI when available, otherwise rule-based)
  ai_status       text not null default 'unavailable' check (ai_status in ('ok', 'unavailable', 'failed')),
  method          text not null default 'both' check (method in ('email', 'in_app', 'both')),
  recipient_email text not null default '',
  email_status    text not null default 'not_requested' check (email_status in ('not_requested', 'pending', 'sent', 'failed', 'not_configured')),
  email_error     text,
  provider_id     text,
  attempts        integer not null default 0,
  in_app_status   text not null default 'not_requested' check (in_app_status in ('not_requested', 'sent', 'failed')),
  generated_at    timestamptz not null default now(),
  delivered_at    timestamptz,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null
);
-- one scheduled briefing per day, ever: a second scheduler run cannot create (or send) another
create unique index if not exists daily_briefings_day_uidx on public.daily_briefings (briefing_date) where kind = 'scheduled';
create index if not exists daily_briefings_recent_idx on public.daily_briefings (generated_at desc);

alter table public.daily_briefing_settings enable row level security;
alter table public.daily_briefings enable row level security;
revoke all on public.daily_briefing_settings, public.daily_briefings from anon, authenticated;
grant select, update on public.daily_briefing_settings to authenticated;
grant select, insert, update on public.daily_briefings to authenticated;     -- no delete: the history is kept

drop policy if exists daily_briefing_settings_select on public.daily_briefing_settings;
drop policy if exists daily_briefing_settings_update on public.daily_briefing_settings;
drop policy if exists daily_briefings_select on public.daily_briefings;
drop policy if exists daily_briefings_insert on public.daily_briefings;
drop policy if exists daily_briefings_update on public.daily_briefings;
create policy daily_briefing_settings_select on public.daily_briefing_settings for select to authenticated using ((select public.fin_manage()));
create policy daily_briefing_settings_update on public.daily_briefing_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy daily_briefings_select on public.daily_briefings for select to authenticated using ((select public.fin_manage()));
-- Test briefings are created by an administrator from the settings page; scheduled ones by the server job.
create policy daily_briefings_insert on public.daily_briefings for insert to authenticated with check ((select public.is_admin()) and kind = 'test');
create policy daily_briefings_update on public.daily_briefings for update to authenticated
  using ((select public.is_admin()) and kind = 'test') with check ((select public.is_admin()) and kind = 'test');
