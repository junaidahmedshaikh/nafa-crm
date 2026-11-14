-- NAFA Business OS — Scheduled emails, payment reminders and the notification centre
--
-- Reuses: invoices / invoice_payments / invoice_list, document_emails (history), notifications (the bell), profiles, fin_manage().
-- Adds:   scheduled_emails            one row per follow-up or payment-reminder email (draft / scheduled / sent / failed / cancelled)
--         payment_reminder_settings   singleton: automatic reminders on/off, which days, wording
--         invoice_reminder_prefs      per-invoice switch for automatic reminders
--         notification_preferences    per-user: which notification types are muted
--         notifications.dedupe_key    lets scheduled jobs raise an alert exactly once
--
-- Additive only: no existing table is rewritten and no existing row is changed.

-- ---------------------------------------------------------------------------
-- scheduled_emails
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_emails (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'follow_up' check (kind in ('follow_up', 'payment_reminder')),
  status          text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  related_type    text check (related_type in ('contact', 'lead', 'quotation', 'invoice', 'project')),
  related_id      uuid,
  related_label   text not null default '',
  client_name     text not null default '',
  to_email        text not null default '',
  cc_emails       text[] not null default '{}',
  subject         text not null default '',
  body            text not null default '',
  attach_document boolean not null default false,          -- attach the related quotation / invoice PDF
  scheduled_at    timestamptz,
  timezone        text not null default 'Asia/Kolkata',
  auto            boolean not null default false,          -- created by the automatic payment-reminder rules
  dedupe_key      text unique,                             -- e.g. inv:<invoice>:<offset>: the same reminder is never created twice
  revision        integer not null default 1,              -- bumped on every edit; part of the provider idempotency key
  attempts        integer not null default 0,
  next_attempt_at timestamptz,
  last_error      text,
  provider_id     text,
  attachment_name text,
  sent_at         timestamptz,
  cancel_reason   text,
  assigned_to     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint scheduled_emails_needs_time check (status <> 'scheduled' or scheduled_at is not null),
  constraint scheduled_emails_sent_has_id check (status <> 'sent' or (provider_id is not null and sent_at is not null))
);
create index if not exists scheduled_emails_due_idx on public.scheduled_emails (scheduled_at) where status = 'scheduled';
create index if not exists scheduled_emails_related_idx on public.scheduled_emails (related_type, related_id);
create index if not exists scheduled_emails_created_idx on public.scheduled_emails (created_at desc);
create index if not exists scheduled_emails_assigned_idx on public.scheduled_emails (assigned_to);
drop trigger if exists scheduled_emails_updated_at on public.scheduled_emails;
create trigger scheduled_emails_updated_at before update on public.scheduled_emails for each row execute function public.set_updated_at();

-- A sent email is a record of what went out: it can never be edited, re-queued or un-sent.
create or replace function public.scheduled_emails_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'sent' then
    raise exception 'EMAIL_ALREADY_SENT: a sent email cannot be changed' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists scheduled_emails_guard on public.scheduled_emails;
create trigger scheduled_emails_guard before update on public.scheduled_emails for each row execute function public.scheduled_emails_guard();

alter table public.scheduled_emails enable row level security;
revoke all on public.scheduled_emails from anon, authenticated;
grant select, insert, update on public.scheduled_emails to authenticated;   -- no delete: emails are cancelled, never erased
drop policy if exists scheduled_emails_select on public.scheduled_emails;
drop policy if exists scheduled_emails_insert on public.scheduled_emails;
drop policy if exists scheduled_emails_update on public.scheduled_emails;
create policy scheduled_emails_select on public.scheduled_emails for select to authenticated using ((select public.is_team_member()));
create policy scheduled_emails_insert on public.scheduled_emails for insert to authenticated with check ((select public.is_team_member()));
create policy scheduled_emails_update on public.scheduled_emails for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- ---------------------------------------------------------------------------
-- Payment reminder settings (automatic reminders are OFF until someone switches them on)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_reminder_settings (
  id            boolean primary key default true check (id),
  enabled       boolean not null default false,
  offsets       integer[] not null default '{-7,-3,-1,0,3,7,15}',   -- days relative to the due date (negative = before)
  send_hour     smallint not null default 10 check (send_hour between 0 and 23),   -- IST
  subject       text not null default 'Payment reminder: Invoice {{invoice_number}} – NAFA Events & Activations',
  body          text not null default E'Dear {{client_name}},\n\nThis is a gentle reminder regarding invoice {{invoice_number}}{{project_clause}}.\n\nAmount pending: {{pending_amount}}\nDue date: {{due_date}}\n\nA copy of the invoice is attached for your reference. If the payment has already been made, please ignore this message and share the transaction details so we can update our records.\n\nRegards,\nTeam NAFA\nNAFA Events & Activations\nwww.nafaevents.in\ncontact@nafaevents.in\n+91 81695 12822',
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint payment_reminder_offsets_range check (offsets <@ array[-30,-15,-7,-3,-1,0,1,3,7,15,30,45,60]::integer[])
);
insert into public.payment_reminder_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.invoice_reminder_prefs (
  invoice_id   uuid primary key references public.invoices (id) on delete cascade,
  auto_enabled boolean not null default true,
  updated_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.payment_reminder_settings enable row level security;
alter table public.invoice_reminder_prefs enable row level security;
revoke all on public.payment_reminder_settings, public.invoice_reminder_prefs from anon, authenticated;
grant select, update on public.payment_reminder_settings to authenticated;
grant select, insert, update on public.invoice_reminder_prefs to authenticated;
drop policy if exists payment_reminder_settings_select on public.payment_reminder_settings;
drop policy if exists payment_reminder_settings_update on public.payment_reminder_settings;
drop policy if exists invoice_reminder_prefs_select on public.invoice_reminder_prefs;
drop policy if exists invoice_reminder_prefs_insert on public.invoice_reminder_prefs;
drop policy if exists invoice_reminder_prefs_update on public.invoice_reminder_prefs;
create policy payment_reminder_settings_select on public.payment_reminder_settings for select to authenticated using ((select public.is_team_member()));
-- Only admin / accounts / management may switch automatic reminders on or change their wording.
create policy payment_reminder_settings_update on public.payment_reminder_settings for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));
create policy invoice_reminder_prefs_select on public.invoice_reminder_prefs for select to authenticated using ((select public.is_team_member()));
create policy invoice_reminder_prefs_insert on public.invoice_reminder_prefs for insert to authenticated with check ((select public.is_team_member()));
create policy invoice_reminder_prefs_update on public.invoice_reminder_prefs for update to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- ---------------------------------------------------------------------------
-- Notification centre
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_uidx on public.notifications (user_id, dedupe_key);
create index if not exists notifications_type_idx on public.notifications (user_id, type, created_at desc);

create table if not exists public.notification_preferences (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  muted_types text[] not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
drop policy if exists notification_preferences_select on public.notification_preferences;
drop policy if exists notification_preferences_insert on public.notification_preferences;
drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
