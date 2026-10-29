-- NAFA Business OS — Phase 1 schema
-- Tables, enums, constraints, indexes and triggers. RLS lives in the next migration.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'member');

create type public.lead_status as enum (
  'new', 'contacted', 'qualified', 'brief_received',
  'proposal_in_progress', 'proposal_sent', 'negotiation', 'won', 'lost'
);
-- Declared high -> low so that ascending order puts High first.
create type public.lead_priority as enum ('high', 'medium', 'low');
create type public.lead_source as enum (
  'website', 'whatsapp', 'email', 'referral', 'linkedin', 'outbound', 'existing_client', 'other'
);
create type public.service_category as enum (
  'event_management', 'brand_activation', 'btl_marketing', 'experiential_marketing',
  'corporate_event', 'exhibition', 'wedding_private_event', 'other'
);
create type public.follow_up_type as enum ('call', 'email', 'whatsapp', 'meeting', 'general_task');
create type public.follow_up_status as enum ('pending', 'completed', 'cancelled');
create type public.activity_type as enum (
  'created', 'updated', 'status_changed', 'won', 'lost', 'note',
  'follow_up_scheduled', 'follow_up_completed', 'follow_up_rescheduled', 'follow_up_cancelled',
  'archived', 'restored'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per authorised team member. No row => no access.
-- Rows are NOT created automatically on sign-up (see supabase/admin-setup.sql).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        public.app_role not null default 'member',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- business_settings: singleton row
-- ---------------------------------------------------------------------------
create table public.business_settings (
  id                         boolean primary key default true check (id),
  business_name              text not null default 'NAFA Events & Activations',
  website                    text not null default 'https://www.nafaevents.in/',
  business_email             text,
  default_country_code       text not null default '+91' check (default_country_code ~ '^\+[0-9]{1,4}$'),
  currency                   text not null default 'INR' check (currency = 'INR'),
  default_follow_up_days     integer not null default 3 check (default_follow_up_days between 0 and 365),
  default_follow_up_time     time not null default '10:00',
  default_follow_up_type     public.follow_up_type not null default 'call',
  updated_at                 timestamptz not null default now()
);
create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function public.set_updated_at();
insert into public.business_settings default values;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 1 and 200),
  -- Lower-cased, punctuation and legal suffixes (pvt/ltd/llp...) removed. Used for duplicate detection.
  name_normalized  text generated always as (
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(name), '[^a-z0-9 ]', ' ', 'g'),
        '\m(pvt|private|ltd|limited|llp|inc|llc)\M', ' ', 'g'),
      '\s+', ' ', 'g'))
  ) stored,
  website          text,
  industry         text,
  city             text,
  address          text,
  notes            text,
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index companies_name_normalized_idx on public.companies (name_normalized);
create index companies_created_at_idx on public.companies (created_at desc);
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid references public.companies (id) on delete restrict,
  full_name               text not null check (length(btrim(full_name)) between 1 and 200),
  designation             text,
  email                   text,
  email_normalized        text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone                   text,
  phone_normalized        text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  whatsapp                text,
  communication_notes     text,   -- preferences / restrictions, e.g. "WhatsApp only, no calls after 6pm"
  notes                   text,
  archived_at             timestamptz,
  created_by              uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index contacts_company_idx on public.contacts (company_id);
create index contacts_email_normalized_idx on public.contacts (email_normalized) where email_normalized is not null;
create index contacts_phone_normalized_idx on public.contacts (phone_normalized) where phone_normalized is not null;
create index contacts_created_at_idx on public.contacts (created_at desc);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  lead_number          bigint generated always as identity unique,   -- human-friendly ID: L-0001
  title                text not null check (length(btrim(title)) between 1 and 200),
  company_id           uuid references public.companies (id) on delete restrict,
  contact_id           uuid references public.contacts (id) on delete restrict,
  source               public.lead_source not null default 'other',
  service_category     public.service_category not null default 'other',
  event_name           text,
  event_date           date,
  city                 text,
  venue                text,
  budget_inr           numeric(14, 2) check (budget_inr is null or budget_inr >= 0),
  expected_revenue_inr numeric(14, 2) check (expected_revenue_inr is null or expected_revenue_inr >= 0),
  status               public.lead_status not null default 'new',
  priority             public.lead_priority not null default 'medium',
  assigned_to          uuid references public.profiles (id) on delete set null,
  last_contact_at      timestamptz,
  next_follow_up_at    timestamptz,   -- maintained by trigger from pending follow_ups
  notes                text,
  lost_reason          text,
  closed_at            timestamptz,   -- set when status becomes won/lost
  archived_at          timestamptz,
  created_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint leads_lost_reason_required
    check (status <> 'lost' or length(btrim(coalesce(lost_reason, ''))) > 0)
);
create index leads_status_idx on public.leads (status) where archived_at is null;
create index leads_created_at_idx on public.leads (created_at desc);
create index leads_next_follow_up_idx on public.leads (next_follow_up_at) where archived_at is null;
create index leads_company_idx on public.leads (company_id);
create index leads_contact_idx on public.leads (contact_id);
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_closed_at_idx on public.leads (closed_at) where closed_at is not null;
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- Keep closed_at / lost_reason consistent with status regardless of which client writes.
create function public.leads_before_write() returns trigger
language plpgsql as $$
begin
  if new.status in ('won', 'lost') then
    if tg_op = 'INSERT' or old.status is distinct from new.status or new.closed_at is null then
      new.closed_at = now();
    end if;
  else
    new.closed_at = null;
  end if;
  if new.status <> 'lost' then
    new.lost_reason = null;
  end if;
  return new;
end;
$$;
create trigger leads_before_write before insert or update on public.leads
  for each row execute function public.leads_before_write();

-- ---------------------------------------------------------------------------
-- follow_ups
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  due_at        timestamptz not null,
  type          public.follow_up_type not null default 'call',
  notes         text,
  status        public.follow_up_status not null default 'pending',
  completed_at  timestamptz,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint follow_ups_completed_at_consistent
    check ((status = 'completed') = (completed_at is not null))
);
create index follow_ups_status_due_idx on public.follow_ups (status, due_at);
create index follow_ups_lead_idx on public.follow_ups (lead_id);
create trigger follow_ups_updated_at before update on public.follow_ups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_activities: append-only history
-- ---------------------------------------------------------------------------
create table public.lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  type        public.activity_type not null,
  summary     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index lead_activities_lead_created_idx on public.lead_activities (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity + denormalisation triggers
-- ---------------------------------------------------------------------------
create function public.log_lead_changes() returns trigger
language plpgsql as $$
declare
  changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, type, summary)
    values (new.id, 'created', 'Lead created');
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.lead_activities (lead_id, type, summary, metadata)
    values (
      new.id,
      case new.status when 'won' then 'won'::public.activity_type
                      when 'lost' then 'lost'::public.activity_type
                      else 'status_changed'::public.activity_type end,
      case new.status
        when 'won' then 'Marked as won'
        when 'lost' then 'Marked as lost: ' || new.lost_reason
        else 'Status changed from ' || replace(old.status::text, '_', ' ') || ' to ' || replace(new.status::text, '_', ' ')
      end,
      jsonb_build_object('from', old.status, 'to', new.status, 'lost_reason', new.lost_reason)
    );
  end if;

  if old.archived_at is distinct from new.archived_at then
    insert into public.lead_activities (lead_id, type, summary)
    values (new.id, case when new.archived_at is null then 'restored'::public.activity_type else 'archived'::public.activity_type end,
            case when new.archived_at is null then 'Lead restored from archive' else 'Lead archived' end);
  end if;

  select array_agg(n.key order by n.key) into changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('status', 'lost_reason', 'closed_at', 'archived_at', 'updated_at',
                      'next_follow_up_at', 'last_contact_at');
  if changed is not null then
    insert into public.lead_activities (lead_id, type, summary, metadata)
    values (new.id, 'updated', 'Lead details updated', jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return new;
end;
$$;
create trigger leads_log_changes after insert or update on public.leads
  for each row execute function public.log_lead_changes();

-- Closing a lead (won/lost) cancels its still-pending follow-ups so they stop nagging.
create function public.leads_cancel_follow_ups_on_close() returns trigger
language plpgsql as $$
begin
  if new.status in ('won', 'lost') and old.status is distinct from new.status then
    update public.follow_ups set status = 'cancelled'
    where lead_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
create trigger leads_cancel_follow_ups after update on public.leads
  for each row execute function public.leads_cancel_follow_ups_on_close();

create function public.follow_ups_after_write() returns trigger
language plpgsql as $$
declare
  target_lead uuid := coalesce(new.lead_id, old.lead_id);
begin
  -- Keep leads.next_follow_up_at equal to the earliest pending follow-up.
  update public.leads l
     set next_follow_up_at = (select min(f.due_at) from public.follow_ups f
                               where f.lead_id = target_lead and f.status = 'pending')
   where l.id = target_lead;

  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, type, summary, metadata)
    values (new.lead_id, 'follow_up_scheduled', 'Follow-up scheduled: ' || new.title,
            jsonb_build_object('follow_up_id', new.id, 'due_at', new.due_at));
  elsif tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'completed' then
      insert into public.lead_activities (lead_id, type, summary, metadata)
      values (new.lead_id, 'follow_up_completed', 'Follow-up completed: ' || new.title,
              jsonb_build_object('follow_up_id', new.id));
      if new.type <> 'general_task' then
        update public.leads set last_contact_at = new.completed_at where id = new.lead_id;
      end if;
    elsif old.status = 'pending' and new.status = 'cancelled' and pg_trigger_depth() = 1 then
      insert into public.lead_activities (lead_id, type, summary, metadata)
      values (new.lead_id, 'follow_up_cancelled', 'Follow-up cancelled: ' || new.title,
              jsonb_build_object('follow_up_id', new.id));
    elsif new.status = 'pending' and old.due_at is distinct from new.due_at then
      insert into public.lead_activities (lead_id, type, summary, metadata)
      values (new.lead_id, 'follow_up_rescheduled', 'Follow-up rescheduled: ' || new.title,
              jsonb_build_object('follow_up_id', new.id, 'from', old.due_at, 'to', new.due_at));
    end if;
  end if;
  return null;
end;
$$;
create trigger follow_ups_after_write after insert or update or delete on public.follow_ups
  for each row execute function public.follow_ups_after_write();
