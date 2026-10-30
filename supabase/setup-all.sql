-- NAFA Business OS: ALL migrations (Phase 1 + Phase 2) combined, for ONE-paste setup of a FRESH Supabase project.
-- Already ran Phase 1? Do NOT run this. Run only migrations/20261029000001_documents.sql instead.

-- ===== migrations/20261028000001_schema.sql =====
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

-- ===== migrations/20261028000002_rls.sql =====
-- NAFA Business OS — Row Level Security
--
-- Access model (Phase 1): a user can touch business data only if they have an ACTIVE row in
-- public.profiles. Merely being able to sign in to Supabase Auth is not enough, and profile rows
-- cannot be created by clients (there is no INSERT policy), only by an administrator running
-- supabase/admin-setup.sql with database privileges.
--
-- Future phases can add per-role rules by extending the policies below with public.is_admin().

create function public.is_team_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active
  );
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'admin'
  );
$$;

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges: nothing for anon; explicit grants for authenticated (RLS still applies).
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.business_settings, public.companies, public.contacts,
              public.leads, public.follow_ups, public.lead_activities from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;   -- role / is_active are not client-writable

grant select on public.business_settings to authenticated;
grant update (business_name, website, business_email, default_country_code, default_follow_up_days,
              default_follow_up_time, default_follow_up_type) on public.business_settings to authenticated;

grant select, insert, update, delete on public.companies, public.contacts, public.leads,
                                         public.follow_ups to authenticated;
grant select, insert on public.lead_activities to authenticated;   -- append-only

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.business_settings enable row level security;
alter table public.companies         enable row level security;
alter table public.contacts          enable row level security;
alter table public.leads             enable row level security;
alter table public.follow_ups        enable row level security;
alter table public.lead_activities   enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_team_member()));   -- team sees colleagues' names (assignment)
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.is_team_member()))
  with check (id = (select auth.uid()));

-- business_settings (team can read, only admins can change)
create policy settings_select on public.business_settings for select to authenticated
  using ((select public.is_team_member()));
create policy settings_update on public.business_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- companies / contacts / leads / follow_ups: team members read+write; only admins hard-delete
create policy companies_select on public.companies for select to authenticated using ((select public.is_team_member()));
create policy companies_insert on public.companies for insert to authenticated with check ((select public.is_team_member()));
create policy companies_update on public.companies for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy companies_delete on public.companies for delete to authenticated using ((select public.is_admin()));

create policy contacts_select on public.contacts for select to authenticated using ((select public.is_team_member()));
create policy contacts_insert on public.contacts for insert to authenticated with check ((select public.is_team_member()));
create policy contacts_update on public.contacts for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy contacts_delete on public.contacts for delete to authenticated using ((select public.is_admin()));

create policy leads_select on public.leads for select to authenticated using ((select public.is_team_member()));
create policy leads_insert on public.leads for insert to authenticated with check ((select public.is_team_member()));
create policy leads_update on public.leads for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy leads_delete on public.leads for delete to authenticated using ((select public.is_admin()));

create policy follow_ups_select on public.follow_ups for select to authenticated using ((select public.is_team_member()));
create policy follow_ups_insert on public.follow_ups for insert to authenticated with check ((select public.is_team_member()));
create policy follow_ups_update on public.follow_ups for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy follow_ups_delete on public.follow_ups for delete to authenticated using ((select public.is_admin()));

-- lead_activities: readable and insertable by team members, never updated or deleted by clients
create policy activities_select on public.lead_activities for select to authenticated using ((select public.is_team_member()));
create policy activities_insert on public.lead_activities for insert to authenticated with check ((select public.is_team_member()));

-- ---------------------------------------------------------------------------
-- Read views (security_invoker => the caller's RLS applies to the underlying tables)
-- ---------------------------------------------------------------------------
create view public.lead_list with (security_invoker = true) as
select
  l.*,
  c.name          as company_name,
  c.website       as company_website,
  ct.full_name    as contact_name,
  ct.designation  as contact_designation,
  ct.email        as contact_email,
  ct.phone        as contact_phone,
  ct.phone_normalized as contact_phone_digits,
  ct.whatsapp     as contact_whatsapp,
  p.full_name     as assigned_name
from public.leads l
left join public.companies c  on c.id  = l.company_id
left join public.contacts  ct on ct.id = l.contact_id
left join public.profiles  p  on p.id  = l.assigned_to;

create view public.pipeline_summary with (security_invoker = true) as
select status,
       count(*)::int as lead_count,
       coalesce(sum(expected_revenue_inr), 0) as expected_revenue_inr
from public.leads
where archived_at is null
group by status;

revoke all on public.lead_list, public.pipeline_summary from anon;
grant select on public.lead_list, public.pipeline_summary to authenticated;

-- ===== migrations/20261028000003_list_views.sql =====
-- Read-only list views used by the app. security_invoker => the caller's RLS applies.

create view public.follow_up_list with (security_invoker = true) as
select
  f.*,
  l.lead_number,
  l.title      as lead_title,
  l.status     as lead_status,
  c.name       as company_name
from public.follow_ups f
join public.leads l on l.id = f.lead_id and l.archived_at is null
left join public.companies c on c.id = l.company_id;

create view public.company_list with (security_invoker = true) as
select
  c.*,
  (select count(*)::int from public.contacts ct where ct.company_id = c.id and ct.archived_at is null) as contact_count,
  (select count(*)::int from public.leads l where l.company_id = c.id and l.archived_at is null)       as lead_count
from public.companies c;

create view public.contact_list with (security_invoker = true) as
select
  ct.*,
  c.name as company_name,
  (select count(*)::int from public.leads l where l.contact_id = ct.id and l.archived_at is null) as lead_count
from public.contacts ct
left join public.companies c on c.id = ct.company_id;

revoke all on public.follow_up_list, public.company_list, public.contact_list from anon;
grant select on public.follow_up_list, public.company_list, public.contact_list to authenticated;

-- ===== migrations/20261029000001_documents.sql =====
-- NAFA Business OS — Phase 2: quotations, proposals, invoices, catalogue, payments, numbering.
-- Reuses Phase 1 companies / contacts / leads / profiles and the is_team_member() / is_admin() helpers.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.document_type as enum ('quotation', 'proposal', 'invoice');
create type public.quotation_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired', 'revised');
create type public.proposal_status as enum ('draft', 'sent', 'accepted', 'rejected', 'revised');
create type public.invoice_state as enum ('draft', 'issued', 'cancelled');
create type public.payment_method as enum ('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other');

-- ---------------------------------------------------------------------------
-- Document settings (singleton) and numbering sequences
-- ---------------------------------------------------------------------------
create table public.document_settings (
  id                              boolean primary key default true check (id),
  company_name                    text not null default 'NAFA Events & Activations',
  company_email                   text not null default 'contact@nafaevents.in',
  company_phone                   text not null default '+91 816 951 2822',
  company_website                 text not null default 'https://www.nafaevents.in/',
  company_location                text not null default 'Mumbai, Maharashtra, India  |  Serving Pan India',
  company_gstin                   text,
  signatory_label                 text not null default 'For NAFA Events & Activations',
  -- Payment details are blank until an administrator enters them (Settings → Documents).
  bank_account_holder             text not null default '',
  bank_name                       text not null default '',
  bank_account_number             text not null default '',
  bank_ifsc                       text not null default '',
  bank_upi_id                     text not null default '',
  default_agency_fee_enabled      boolean not null default true,
  default_agency_fee_rate         numeric(5, 2) not null default 15 check (default_agency_fee_rate between 0 and 100),
  default_quotation_tax_mode      text not null default 'cgst_sgst' check (default_quotation_tax_mode in ('none', 'cgst_sgst', 'igst')),
  default_invoice_tax_mode        text not null default 'none' check (default_invoice_tax_mode in ('none', 'cgst_sgst', 'igst')),
  default_tax_rate                numeric(5, 2) not null default 18 check (default_tax_rate between 0 and 100),
  default_quotation_validity_days integer not null default 7 check (default_quotation_validity_days between 0 and 365),
  default_invoice_due_days        integer not null default 7 check (default_invoice_due_days between 0 and 365),
  quotation_terms                 jsonb not null default jsonb_build_array(
    'This quotation is valid until the date stated above.',
    'Cancellation & rescheduling: Cancellations or rescheduling must be communicated in writing; charges may apply for work completed and expenses incurred.',
    'Changes to scope, guest count or deliverables after confirmation may revise the quoted amount.',
    'Taxes are charged as applicable at the prevailing rate.'),
  quotation_milestones            jsonb not null default jsonb_build_array(
    jsonb_build_object('label', 'Advance — 50% on confirmation', 'kind', 'percent', 'value', 50, 'due_text', 'On confirmation'),
    jsonb_build_object('label', 'Second instalment — 30%', 'kind', 'percent', 'value', 30, 'due_text', ''),
    jsonb_build_object('label', 'Balance — 20%', 'kind', 'percent', 'value', 20, 'due_text', '')),
  invoice_payment_terms           text not null default 'Due within 7 days of invoice date.',
  invoice_notes                   text not null default 'Payment is due within 7 days from the invoice date, unless otherwise agreed in writing. Kindly mention the invoice number when making payment and share the payment confirmation once completed. Any applicable bank transfer charges shall be borne by the payer.',
  gst_declaration_enabled         boolean not null default true,
  gst_declaration                 text not null default 'GST has not been charged on this invoice.',
  updated_at                      timestamptz not null default now()
);
insert into public.document_settings default values;
create trigger document_settings_updated_at before update on public.document_settings
  for each row execute function public.set_updated_at();

create table public.document_sequences (
  doc_type     public.document_type primary key,
  prefix       text not null check (length(prefix) between 1 and 20),
  padding      integer not null default 3 check (padding between 1 and 8),
  next_number  integer not null default 1 check (next_number >= 1),
  updated_at   timestamptz not null default now()
);
insert into public.document_sequences (doc_type, prefix) values
  ('quotation', 'NAFA-QUO-26-'), ('proposal', 'NAFA-PROP-26-'), ('invoice', 'NAFA-INV-26-');

-- A counter can be re-prefixed or advanced, but never wound back (numbers are never reused).
create function public.document_sequences_guard() returns trigger language plpgsql as $$
begin
  if new.next_number < old.next_number then
    raise exception 'SEQUENCE_CANNOT_DECREASE' using errcode = '23514';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger document_sequences_guard before update on public.document_sequences
  for each row execute function public.document_sequences_guard();

/** Atomically allocates the next number. The UPDATE takes a row lock, so concurrent callers queue up. */
create function public.next_document_number(p_type public.document_type) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_prefix text;
  v_yy text;
begin
  if not public.is_team_member() then
    raise exception 'NOT_AUTHORISED' using errcode = '42501';
  end if;
  update public.document_sequences
     set next_number = next_number + 1
   where doc_type = p_type
  returning prefix, padding, next_number - 1 as n into s;

  v_yy := to_char(now() at time zone 'Asia/Kolkata', 'YY');
  v_prefix := replace(s.prefix, '{YY}', v_yy);
  return v_prefix || lpad(s.n::text, s.padding, '0');
end $$;
revoke all on function public.next_document_number(public.document_type) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Products & services catalogue
-- ---------------------------------------------------------------------------
create table public.products_services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 200),
  category      text,
  description   text,
  unit          text not null default 'nos',
  default_rate  numeric(14, 2) not null default 0 check (default_rate >= 0),
  hsn_sac       text,
  gst_rate      numeric(5, 2) check (gst_rate is null or gst_rate between 0 and 100),
  is_active     boolean not null default true,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index products_services_name_idx on public.products_services (lower(name));
create trigger products_services_updated_at before update on public.products_services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------
create table public.quotations (
  id               uuid primary key default gen_random_uuid(),
  number           text unique,
  status           public.quotation_status not null default 'draft',
  revision_of      uuid references public.quotations (id) on delete set null,
  lead_id          uuid references public.leads (id) on delete set null,
  company_id       uuid references public.companies (id) on delete set null,
  contact_id       uuid references public.contacts (id) on delete set null,
  client_name      text not null default '',
  client_company   text not null default '',
  client_address   text not null default '',
  client_email     text not null default '',
  client_phone     text not null default '',
  client_gstin     text not null default '',
  event_type       text not null default '',
  event_name       text not null default '',
  event_date_text  text not null default '',
  event_location   text not null default '',
  reference_text   text not null default '',
  quotation_date   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  valid_until      date,
  config           jsonb not null default '{}'::jsonb,
  subtotal         numeric(14, 2) not null default 0,
  discount_total   numeric(14, 2) not null default 0,
  agency_fee       numeric(14, 2) not null default 0,
  taxable_value    numeric(14, 2) not null default 0,
  cgst             numeric(14, 2) not null default 0,
  sgst             numeric(14, 2) not null default 0,
  igst             numeric(14, 2) not null default 0,
  other_charges    numeric(14, 2) not null default 0,
  round_off        numeric(14, 2) not null default 0,
  grand_total      numeric(14, 2) not null default 0,
  terms            jsonb not null default '[]'::jsonb,
  notes            text not null default '',
  snapshot         jsonb,
  issued_at        timestamptz,
  sent_at          timestamptz,
  accepted_at      timestamptz,
  rejected_at      timestamptz,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint quotations_number_when_issued check (status = 'draft' or number is not null),
  constraint quotations_snapshot_when_issued check (status = 'draft' or snapshot is not null)
);
create index quotations_status_idx on public.quotations (status);
create index quotations_lead_idx on public.quotations (lead_id);
create index quotations_company_idx on public.quotations (company_id);
create index quotations_created_idx on public.quotations (created_at desc);

create table public.quotation_items (
  id             uuid primary key default gen_random_uuid(),
  quotation_id   uuid not null references public.quotations (id) on delete cascade,
  position       integer not null,
  catalogue_id   uuid references public.products_services (id) on delete set null,
  description    text not null check (length(btrim(description)) > 0),
  notes          text,
  hsn_sac        text,
  qty            numeric(14, 3) not null check (qty > 0),
  rate           numeric(14, 2) not null check (rate >= 0),
  discount_type  text check (discount_type in ('percent', 'fixed')),
  discount_value numeric(14, 2) check (discount_value is null or discount_value >= 0),
  amount         numeric(14, 2) not null default 0
);
create index quotation_items_q_idx on public.quotation_items (quotation_id, position);

create table public.quotation_milestones (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references public.quotations (id) on delete cascade,
  position      integer not null,
  label         text not null check (length(btrim(label)) > 0),
  kind          text not null check (kind in ('percent', 'fixed')),
  value         numeric(14, 2) not null check (value >= 0),
  due_text      text not null default '',
  due_date      date,
  amount        numeric(14, 2) not null default 0,
  status        text not null default 'pending' check (status in ('pending', 'paid'))
);
create index quotation_milestones_q_idx on public.quotation_milestones (quotation_id, position);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  number             text unique,
  state              public.invoice_state not null default 'draft',
  quotation_id       uuid references public.quotations (id) on delete set null,
  lead_id            uuid references public.leads (id) on delete set null,
  company_id         uuid references public.companies (id) on delete set null,
  contact_id         uuid references public.contacts (id) on delete set null,
  client_name        text not null default '',
  client_company     text not null default '',
  client_address     text not null default '',
  client_email       text not null default '',
  client_phone       text not null default '',
  client_gstin       text not null default '',
  project_name       text not null default '',
  project_location   text not null default '',
  project_date_text  text not null default '',
  quotation_number   text not null default '',
  place_of_supply    text not null default '',
  invoice_date       date not null default ((now() at time zone 'Asia/Kolkata')::date),
  due_date           date,
  config             jsonb not null default '{}'::jsonb,
  subtotal           numeric(14, 2) not null default 0,
  discount_total     numeric(14, 2) not null default 0,
  agency_fee         numeric(14, 2) not null default 0,
  taxable_value      numeric(14, 2) not null default 0,
  cgst               numeric(14, 2) not null default 0,
  sgst               numeric(14, 2) not null default 0,
  igst               numeric(14, 2) not null default 0,
  other_charges      numeric(14, 2) not null default 0,
  round_off          numeric(14, 2) not null default 0,
  grand_total        numeric(14, 2) not null default 0,
  payment_terms_text text not null default '',
  notes_text         text not null default '',
  snapshot           jsonb,
  issued_at          timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint invoices_number_when_issued check (state = 'draft' or number is not null),
  constraint invoices_snapshot_when_issued check (state = 'draft' or snapshot is not null),
  constraint invoices_cancel_reason check (state <> 'cancelled' or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create index invoices_state_idx on public.invoices (state);
create index invoices_quotation_idx on public.invoices (quotation_id);
create index invoices_company_idx on public.invoices (company_id);
create index invoices_due_idx on public.invoices (due_date) where state = 'issued';
create index invoices_created_idx on public.invoices (created_at desc);

create table public.invoice_items (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices (id) on delete cascade,
  position       integer not null,
  catalogue_id   uuid references public.products_services (id) on delete set null,
  description    text not null check (length(btrim(description)) > 0),
  notes          text,
  hsn_sac        text,
  qty            numeric(14, 3) not null check (qty > 0),
  rate           numeric(14, 2) not null check (rate >= 0),
  discount_type  text check (discount_type in ('percent', 'fixed')),
  discount_value numeric(14, 2) check (discount_value is null or discount_value >= 0),
  amount         numeric(14, 2) not null default 0
);
create index invoice_items_i_idx on public.invoice_items (invoice_id, position);

create table public.invoice_payments (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices (id) on delete restrict,
  paid_on        date not null,
  amount         numeric(14, 2) not null check (amount > 0),
  method         public.payment_method not null default 'bank_transfer',
  reference      text,
  notes          text,
  voided_at      timestamptz,
  voided_reason  text,
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint invoice_payments_void_reason check (voided_at is null or length(btrim(coalesce(voided_reason, ''))) > 0)
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
create index invoice_payments_paid_on_idx on public.invoice_payments (paid_on desc);

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------
create table public.proposals (
  id               uuid primary key default gen_random_uuid(),
  number           text unique,
  status           public.proposal_status not null default 'draft',
  revision_of      uuid references public.proposals (id) on delete set null,
  lead_id          uuid references public.leads (id) on delete set null,
  company_id       uuid references public.companies (id) on delete set null,
  contact_id       uuid references public.contacts (id) on delete set null,
  quotation_id     uuid references public.quotations (id) on delete set null,
  title            text not null default '',
  client_name      text not null default '',
  client_company   text not null default '',
  client_address   text not null default '',
  client_email     text not null default '',
  client_phone     text not null default '',
  client_gstin     text not null default '',
  proposal_date    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  commercial_mode  text not null default 'none' check (commercial_mode in ('none', 'linked', 'manual')),
  commercial_note  text not null default '',
  snapshot         jsonb,
  issued_at        timestamptz,
  sent_at          timestamptz,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint proposals_number_when_issued check (status = 'draft' or number is not null),
  constraint proposals_snapshot_when_issued check (status = 'draft' or snapshot is not null),
  constraint proposals_linked_needs_quotation check (commercial_mode <> 'linked' or quotation_id is not null)
);
create index proposals_status_idx on public.proposals (status);
create index proposals_created_idx on public.proposals (created_at desc);

create table public.proposal_sections (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposals (id) on delete cascade,
  position     integer not null,
  type         text not null default 'custom',
  title        text not null default '',
  body         text not null default '',
  included     boolean not null default true
);
create index proposal_sections_p_idx on public.proposal_sections (proposal_id, position);

create table public.proposal_attachments (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references public.proposals (id) on delete cascade,
  section_id    uuid references public.proposal_sections (id) on delete cascade,
  position      integer not null default 0,
  filename      text not null,
  content_type  text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes    integer not null check (size_bytes between 1 and 2097152),
  data_uri      text not null,   -- images are stored inline (≤ 2 MB each) so PDFs render without extra storage setup
  caption       text not null default '',
  created_at    timestamptz not null default now()
);
create index proposal_attachments_p_idx on public.proposal_attachments (proposal_id, position);

-- ---------------------------------------------------------------------------
-- Activity history and email log
-- ---------------------------------------------------------------------------
create table public.document_activity (
  id          uuid primary key default gen_random_uuid(),
  doc_type    public.document_type not null,
  doc_id      uuid not null,
  action      text not null,
  summary     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index document_activity_doc_idx on public.document_activity (doc_type, doc_id, created_at desc);

create table public.document_emails (
  id           uuid primary key default gen_random_uuid(),
  doc_type     public.document_type not null,
  doc_id       uuid not null,
  to_email     text not null,
  subject      text not null,
  body         text not null,
  status       text not null check (status in ('sent', 'failed')),
  provider_id  text,
  error        text,
  sent_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  sent_at      timestamptz not null default now()
);
create index document_emails_doc_idx on public.document_emails (doc_type, doc_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Guards: issued documents are immutable; numbers only come from the sequence
-- ---------------------------------------------------------------------------
create function public.log_document_activity(p_type public.document_type, p_id uuid, p_action text, p_summary text, p_meta jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into public.document_activity (doc_type, doc_id, action, summary, metadata) values (p_type, p_id, p_action, p_summary, p_meta);
$$;

create function public.quotations_guard() returns trigger language plpgsql as $$
declare
  free_keys text[] := array['status', 'updated_at', 'accepted_at', 'rejected_at'];
  ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
      raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'NUMBER_IMMUTABLE' using errcode = '42501';
  end if;
  if old.number is null and new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (to_jsonb(new) - free_keys) is distinct from (to_jsonb(old) - free_keys) then
      raise exception 'DOCUMENT_LOCKED: an issued quotation cannot be edited; create a revision instead' using errcode = '23514';
    end if;
    if new.status is distinct from old.status then
      ok := (old.status = 'sent' and new.status in ('accepted', 'rejected', 'expired', 'revised'))
         or (old.status = 'expired' and new.status in ('sent', 'accepted', 'revised'))
         or (old.status = 'accepted' and new.status = 'revised');
      if not ok then
        raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = '23514';
      end if;
      if new.status = 'accepted' then new.accepted_at = now(); end if;
      if new.status = 'rejected' then new.rejected_at = now(); end if;
    end if;
  elsif new.status <> 'draft' and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'ISSUE_THROUGH_FUNCTION_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger quotations_guard before insert or update on public.quotations
  for each row execute function public.quotations_guard();

create function public.invoices_guard() returns trigger language plpgsql as $$
declare
  free_keys text[] := array['state', 'updated_at', 'cancelled_at', 'cancel_reason'];
  has_payments boolean;
begin
  if tg_op = 'INSERT' then
    if new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
      raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'NUMBER_IMMUTABLE' using errcode = '42501';
  end if;
  if old.number is null and new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
  end if;
  if old.state <> 'draft' then
    if (to_jsonb(new) - free_keys) is distinct from (to_jsonb(old) - free_keys) then
      raise exception 'DOCUMENT_LOCKED: an issued invoice cannot be edited; cancel it and create a corrected draft' using errcode = '23514';
    end if;
    if new.state is distinct from old.state then
      if not (old.state = 'issued' and new.state = 'cancelled') then
        raise exception 'INVALID_TRANSITION: % -> %', old.state, new.state using errcode = '23514';
      end if;
      select exists (select 1 from public.invoice_payments where invoice_id = old.id and voided_at is null) into has_payments;
      if has_payments then
        raise exception 'HAS_PAYMENTS: void the recorded payments before cancelling this invoice' using errcode = '23514';
      end if;
      new.cancelled_at = now();
    end if;
  elsif new.state <> 'draft' and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'ISSUE_THROUGH_FUNCTION_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function public.invoices_guard();

create function public.proposals_guard() returns trigger language plpgsql as $$
declare free_keys text[] := array['status', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
      raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'NUMBER_IMMUTABLE' using errcode = '42501';
  end if;
  if old.number is null and new.number is not null and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'NUMBER_ASSIGNED_BY_SYSTEM' using errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (to_jsonb(new) - free_keys) is distinct from (to_jsonb(old) - free_keys) then
      raise exception 'DOCUMENT_LOCKED: an issued proposal cannot be edited; create a revision instead' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (old.status = 'sent' and new.status in ('accepted', 'rejected', 'revised'))
       and not (old.status = 'accepted' and new.status = 'revised') then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = '23514';
    end if;
  elsif new.status <> 'draft' and coalesce(current_setting('nafa.issuing', true), '') <> '1' then
    raise exception 'ISSUE_THROUGH_FUNCTION_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger proposals_guard before insert or update on public.proposals
  for each row execute function public.proposals_guard();

-- Child rows of an issued document are frozen too.
create function public.children_guard() returns trigger language plpgsql as $$
declare
  parent_id uuid;
  locked boolean;
begin
  if tg_op = 'DELETE' then parent_id := (to_jsonb(old) ->> tg_argv[1])::uuid;
  else parent_id := (to_jsonb(new) ->> tg_argv[1])::uuid; end if;
  execute format('select %s from public.%I where id = $1', tg_argv[2], tg_argv[0]) into locked using parent_id;
  -- parent already deleted (cascade) => allow
  if locked is true then
    raise exception 'DOCUMENT_LOCKED: items of an issued document cannot be changed' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger quotation_items_guard before insert or update or delete on public.quotation_items
  for each row execute function public.children_guard('quotations', 'quotation_id', 'status <> ''draft''');
create trigger invoice_items_guard before insert or update or delete on public.invoice_items
  for each row execute function public.children_guard('invoices', 'invoice_id', 'state <> ''draft''');
create trigger proposal_sections_guard before insert or update or delete on public.proposal_sections
  for each row execute function public.children_guard('proposals', 'proposal_id', 'status <> ''draft''');
create trigger proposal_attachments_guard before insert or update or delete on public.proposal_attachments
  for each row execute function public.children_guard('proposals', 'proposal_id', 'status <> ''draft''');

-- Milestones: structure is frozen once issued, but a milestone can still be marked paid.
create function public.milestones_guard() returns trigger language plpgsql as $$
declare locked boolean;
begin
  select status <> 'draft' into locked from public.quotations where id = coalesce(new.quotation_id, old.quotation_id);
  if locked is true then
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'status') is not distinct from (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'DOCUMENT_LOCKED: payment milestones of an issued quotation cannot be changed' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger quotation_milestones_guard before insert or update or delete on public.quotation_milestones
  for each row execute function public.milestones_guard();

-- ---------------------------------------------------------------------------
-- Payments: only on issued invoices, never more than the balance, void instead of delete
-- ---------------------------------------------------------------------------
create function public.invoice_payments_guard() returns trigger language plpgsql as $$
declare
  inv record;
  received numeric;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['voided_at', 'voided_reason']) is distinct from (to_jsonb(old) - array['voided_at', 'voided_reason'])
       or old.voided_at is not null then
      raise exception 'PAYMENT_IMMUTABLE: payments can only be voided' using errcode = '23514';
    end if;
    return new;
  end if;
  -- INSERT: serialise per invoice so two simultaneous payments cannot overshoot the balance
  select state, grand_total into inv from public.invoices where id = new.invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = '23503'; end if;
  if inv.state <> 'issued' then
    raise exception 'INVOICE_NOT_PAYABLE: payments can only be recorded on issued invoices' using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into received from public.invoice_payments where invoice_id = new.invoice_id and voided_at is null;
  if received + new.amount > inv.grand_total then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: balance due is %', inv.grand_total - received using errcode = '23514';
  end if;
  return new;
end $$;
create trigger invoice_payments_guard before insert or update on public.invoice_payments
  for each row execute function public.invoice_payments_guard();

-- ---------------------------------------------------------------------------
-- Activity logging
-- ---------------------------------------------------------------------------
create function public.log_quotation_changes() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_activity('quotation', new.id, 'created', case when new.revision_of is null then 'Quotation draft created' else 'Revision draft created' end);
  elsif old.status is distinct from new.status then
    perform public.log_document_activity('quotation', new.id,
      case when old.status = 'draft' then 'issued' else new.status::text end,
      case when old.status = 'draft' then 'Issued as ' || new.number || ' and marked as sent'
           else 'Status changed from ' || old.status || ' to ' || new.status end,
      jsonb_build_object('from', old.status, 'to', new.status));
  elsif old.status = 'draft' and (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    perform public.log_document_activity('quotation', new.id, 'edited', 'Draft saved');
  end if;
  return null;
end $$;
create trigger quotations_activity after insert or update on public.quotations
  for each row execute function public.log_quotation_changes();

create function public.log_invoice_changes() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_activity('invoice', new.id, 'created',
      case when new.quotation_id is null then 'Invoice draft created' else 'Invoice draft created from quotation ' || new.quotation_number end);
  elsif old.state is distinct from new.state then
    perform public.log_document_activity('invoice', new.id,
      case when new.state = 'issued' then 'issued' else 'cancelled' end,
      case when new.state = 'issued' then 'Issued as ' || new.number else 'Cancelled: ' || new.cancel_reason end,
      jsonb_build_object('from', old.state, 'to', new.state));
  elsif old.state = 'draft' and (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    perform public.log_document_activity('invoice', new.id, 'edited', 'Draft saved');
  end if;
  return null;
end $$;
create trigger invoices_activity after insert or update on public.invoices
  for each row execute function public.log_invoice_changes();

create function public.log_proposal_changes() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_activity('proposal', new.id, 'created', case when new.revision_of is null then 'Proposal draft created' else 'Revision draft created' end);
  elsif old.status is distinct from new.status then
    perform public.log_document_activity('proposal', new.id,
      case when old.status = 'draft' then 'issued' else new.status::text end,
      case when old.status = 'draft' then 'Issued as ' || new.number || ' and marked as sent'
           else 'Status changed from ' || old.status || ' to ' || new.status end,
      jsonb_build_object('from', old.status, 'to', new.status));
  elsif old.status = 'draft' and (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    perform public.log_document_activity('proposal', new.id, 'edited', 'Draft saved');
  end if;
  return null;
end $$;
create trigger proposals_activity after insert or update on public.proposals
  for each row execute function public.log_proposal_changes();

create function public.log_payment_changes() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_document_activity('invoice', new.invoice_id, 'payment_recorded',
      'Payment of ₹' || to_char(new.amount, 'FM999G999G999G990D00') || ' recorded (' || replace(new.method::text, '_', ' ') || ')',
      jsonb_build_object('payment_id', new.id, 'amount', new.amount));
  elsif old.voided_at is null and new.voided_at is not null then
    perform public.log_document_activity('invoice', new.invoice_id, 'payment_voided',
      'Payment of ₹' || to_char(new.amount, 'FM999G999G999G990D00') || ' voided: ' || new.voided_reason,
      jsonb_build_object('payment_id', new.id));
  end if;
  return null;
end $$;
create trigger invoice_payments_activity after insert or update on public.invoice_payments
  for each row execute function public.log_payment_changes();

-- ---------------------------------------------------------------------------
-- Save functions (atomic header + children replace; SECURITY INVOKER so RLS applies)
-- ---------------------------------------------------------------------------
create function public.save_quotation(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.quotations (lead_id, company_id, contact_id, revision_of, client_name, client_company, client_address, client_email, client_phone,
      client_gstin, event_type, event_name, event_date_text, event_location, reference_text, quotation_date, valid_until, config, subtotal, discount_total,
      agency_fee, taxable_value, cgst, sgst, igst, other_charges, round_off, grand_total, terms, notes)
    select r.lead_id, r.company_id, r.contact_id, r.revision_of, coalesce(r.client_name, ''), coalesce(r.client_company, ''), coalesce(r.client_address, ''),
      coalesce(r.client_email, ''), coalesce(r.client_phone, ''), coalesce(r.client_gstin, ''), coalesce(r.event_type, ''), coalesce(r.event_name, ''),
      coalesce(r.event_date_text, ''), coalesce(r.event_location, ''), coalesce(r.reference_text, ''), coalesce(r.quotation_date, (now() at time zone 'Asia/Kolkata')::date),
      r.valid_until, coalesce(r.config, '{}'::jsonb), coalesce(r.subtotal, 0), coalesce(r.discount_total, 0), coalesce(r.agency_fee, 0), coalesce(r.taxable_value, 0),
      coalesce(r.cgst, 0), coalesce(r.sgst, 0), coalesce(r.igst, 0), coalesce(r.other_charges, 0), coalesce(r.round_off, 0), coalesce(r.grand_total, 0),
      coalesce(r.terms, '[]'::jsonb), coalesce(r.notes, '')
    from jsonb_populate_record(null::public.quotations, p) r
    returning id into v_id;
  else
    update public.quotations q set lead_id = r.lead_id, company_id = r.company_id, contact_id = r.contact_id,
      client_name = coalesce(r.client_name, ''), client_company = coalesce(r.client_company, ''), client_address = coalesce(r.client_address, ''),
      client_email = coalesce(r.client_email, ''), client_phone = coalesce(r.client_phone, ''), client_gstin = coalesce(r.client_gstin, ''),
      event_type = coalesce(r.event_type, ''), event_name = coalesce(r.event_name, ''), event_date_text = coalesce(r.event_date_text, ''),
      event_location = coalesce(r.event_location, ''), reference_text = coalesce(r.reference_text, ''),
      quotation_date = coalesce(r.quotation_date, q.quotation_date), valid_until = r.valid_until, config = coalesce(r.config, '{}'::jsonb),
      subtotal = coalesce(r.subtotal, 0), discount_total = coalesce(r.discount_total, 0), agency_fee = coalesce(r.agency_fee, 0),
      taxable_value = coalesce(r.taxable_value, 0), cgst = coalesce(r.cgst, 0), sgst = coalesce(r.sgst, 0), igst = coalesce(r.igst, 0),
      other_charges = coalesce(r.other_charges, 0), round_off = coalesce(r.round_off, 0), grand_total = coalesce(r.grand_total, 0),
      terms = coalesce(r.terms, '[]'::jsonb), notes = coalesce(r.notes, ''), updated_at = now()
    from jsonb_populate_record(null::public.quotations, p) r
    where q.id = v_id and q.status = 'draft';
    if not found then raise exception 'NOT_EDITABLE: only existing draft quotations can be edited' using errcode = '23514'; end if;
    delete from public.quotation_items where quotation_id = v_id;
    delete from public.quotation_milestones where quotation_id = v_id;
  end if;

  insert into public.quotation_items (quotation_id, position, catalogue_id, description, notes, hsn_sac, qty, rate, discount_type, discount_value, amount)
  select v_id, e.ord - 1, r.catalogue_id, r.description, nullif(r.notes, ''), nullif(r.hsn_sac, ''), r.qty, r.rate, r.discount_type, r.discount_value, coalesce(r.amount, 0)
  from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) with ordinality as e(value, ord),
       lateral jsonb_populate_record(null::public.quotation_items, e.value) r;

  insert into public.quotation_milestones (quotation_id, position, label, kind, value, due_text, due_date, amount, status)
  select v_id, e.ord - 1, r.label, r.kind, r.value, coalesce(r.due_text, ''), r.due_date, coalesce(r.amount, 0), coalesce(r.status, 'pending')
  from jsonb_array_elements(coalesce(p -> 'milestones', '[]'::jsonb)) with ordinality as e(value, ord),
       lateral jsonb_populate_record(null::public.quotation_milestones, e.value) r;
  return v_id;
end $$;

create function public.save_invoice(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.invoices (quotation_id, lead_id, company_id, contact_id, client_name, client_company, client_address, client_email, client_phone,
      client_gstin, project_name, project_location, project_date_text, quotation_number, place_of_supply, invoice_date, due_date, config, subtotal,
      discount_total, agency_fee, taxable_value, cgst, sgst, igst, other_charges, round_off, grand_total, payment_terms_text, notes_text)
    select r.quotation_id, r.lead_id, r.company_id, r.contact_id, coalesce(r.client_name, ''), coalesce(r.client_company, ''), coalesce(r.client_address, ''),
      coalesce(r.client_email, ''), coalesce(r.client_phone, ''), coalesce(r.client_gstin, ''), coalesce(r.project_name, ''), coalesce(r.project_location, ''),
      coalesce(r.project_date_text, ''), coalesce(r.quotation_number, ''), coalesce(r.place_of_supply, ''),
      coalesce(r.invoice_date, (now() at time zone 'Asia/Kolkata')::date), r.due_date, coalesce(r.config, '{}'::jsonb), coalesce(r.subtotal, 0),
      coalesce(r.discount_total, 0), coalesce(r.agency_fee, 0), coalesce(r.taxable_value, 0), coalesce(r.cgst, 0), coalesce(r.sgst, 0), coalesce(r.igst, 0),
      coalesce(r.other_charges, 0), coalesce(r.round_off, 0), coalesce(r.grand_total, 0), coalesce(r.payment_terms_text, ''), coalesce(r.notes_text, '')
    from jsonb_populate_record(null::public.invoices, p) r
    returning id into v_id;
  else
    update public.invoices i set lead_id = r.lead_id, company_id = r.company_id, contact_id = r.contact_id,
      client_name = coalesce(r.client_name, ''), client_company = coalesce(r.client_company, ''), client_address = coalesce(r.client_address, ''),
      client_email = coalesce(r.client_email, ''), client_phone = coalesce(r.client_phone, ''), client_gstin = coalesce(r.client_gstin, ''),
      project_name = coalesce(r.project_name, ''), project_location = coalesce(r.project_location, ''), project_date_text = coalesce(r.project_date_text, ''),
      place_of_supply = coalesce(r.place_of_supply, ''), invoice_date = coalesce(r.invoice_date, i.invoice_date), due_date = r.due_date,
      config = coalesce(r.config, '{}'::jsonb), subtotal = coalesce(r.subtotal, 0), discount_total = coalesce(r.discount_total, 0),
      agency_fee = coalesce(r.agency_fee, 0), taxable_value = coalesce(r.taxable_value, 0), cgst = coalesce(r.cgst, 0), sgst = coalesce(r.sgst, 0),
      igst = coalesce(r.igst, 0), other_charges = coalesce(r.other_charges, 0), round_off = coalesce(r.round_off, 0), grand_total = coalesce(r.grand_total, 0),
      payment_terms_text = coalesce(r.payment_terms_text, ''), notes_text = coalesce(r.notes_text, ''), updated_at = now()
    from jsonb_populate_record(null::public.invoices, p) r
    where i.id = v_id and i.state = 'draft';
    if not found then raise exception 'NOT_EDITABLE: only existing draft invoices can be edited' using errcode = '23514'; end if;
    delete from public.invoice_items where invoice_id = v_id;
  end if;

  insert into public.invoice_items (invoice_id, position, catalogue_id, description, notes, hsn_sac, qty, rate, discount_type, discount_value, amount)
  select v_id, e.ord - 1, r.catalogue_id, r.description, nullif(r.notes, ''), nullif(r.hsn_sac, ''), r.qty, r.rate, r.discount_type, r.discount_value, coalesce(r.amount, 0)
  from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) with ordinality as e(value, ord),
       lateral jsonb_populate_record(null::public.invoice_items, e.value) r;
  return v_id;
end $$;

create function public.save_proposal(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.proposals (lead_id, company_id, contact_id, quotation_id, revision_of, title, client_name, client_company, client_address, client_email,
      client_phone, client_gstin, proposal_date, commercial_mode, commercial_note)
    select r.lead_id, r.company_id, r.contact_id, r.quotation_id, r.revision_of, coalesce(r.title, ''), coalesce(r.client_name, ''), coalesce(r.client_company, ''),
      coalesce(r.client_address, ''), coalesce(r.client_email, ''), coalesce(r.client_phone, ''), coalesce(r.client_gstin, ''),
      coalesce(r.proposal_date, (now() at time zone 'Asia/Kolkata')::date), coalesce(r.commercial_mode, 'none'), coalesce(r.commercial_note, '')
    from jsonb_populate_record(null::public.proposals, p) r
    returning id into v_id;
  else
    update public.proposals x set lead_id = r.lead_id, company_id = r.company_id, contact_id = r.contact_id, quotation_id = r.quotation_id,
      title = coalesce(r.title, ''), client_name = coalesce(r.client_name, ''), client_company = coalesce(r.client_company, ''),
      client_address = coalesce(r.client_address, ''), client_email = coalesce(r.client_email, ''), client_phone = coalesce(r.client_phone, ''),
      client_gstin = coalesce(r.client_gstin, ''), proposal_date = coalesce(r.proposal_date, x.proposal_date),
      commercial_mode = coalesce(r.commercial_mode, 'none'), commercial_note = coalesce(r.commercial_note, ''), updated_at = now()
    from jsonb_populate_record(null::public.proposals, p) r
    where x.id = v_id and x.status = 'draft';
    if not found then raise exception 'NOT_EDITABLE: only existing draft proposals can be edited' using errcode = '23514'; end if;
    -- keep attachments (they are managed separately): detach from sections that are about to be replaced
    update public.proposal_attachments set section_id = null where proposal_id = v_id;
    delete from public.proposal_sections where proposal_id = v_id;
  end if;

  insert into public.proposal_sections (id, proposal_id, position, type, title, body, included)
  select coalesce(r.id, gen_random_uuid()), v_id, e.ord - 1, coalesce(r.type, 'custom'), coalesce(r.title, ''), coalesce(r.body, ''), coalesce(r.included, true)
  from jsonb_array_elements(coalesce(p -> 'sections', '[]'::jsonb)) with ordinality as e(value, ord),
       lateral jsonb_populate_record(null::public.proposal_sections, e.value) r;

  -- re-attach images to the section ids the client sent along
  update public.proposal_attachments a set section_id = s.id
  from jsonb_array_elements(coalesce(p -> 'attachment_sections', '[]'::jsonb)) m,
       public.proposal_sections s
  where a.proposal_id = v_id and a.id = (m ->> 'attachment_id')::uuid and s.id = (m ->> 'section_id')::uuid and s.proposal_id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Issue (allocates the number and stores the immutable snapshot)
-- ---------------------------------------------------------------------------
create function public.issue_document(p_type public.document_type, p_id uuid, p_snapshot jsonb, p_expected_updated_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_number text;
  v_updated timestamptz;
  v_status text;
  v_revision_of uuid;
  v_parent_number text;
  v_base_number text;
  v_next_version int;
begin
  if not public.is_team_member() then raise exception 'NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_type = 'quotation' then
    select status::text, updated_at, revision_of into v_status, v_updated, v_revision_of from public.quotations where id = p_id for update;
  elsif p_type = 'invoice' then
    select state::text, updated_at into v_status, v_updated from public.invoices where id = p_id for update;
  else
    select status::text, updated_at, revision_of into v_status, v_updated, v_revision_of from public.proposals where id = p_id for update;
  end if;
  if v_status is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status <> 'draft' then raise exception 'ALREADY_ISSUED' using errcode = '23514'; end if;
  if v_updated is distinct from p_expected_updated_at then raise exception 'STALE: the draft changed while issuing; reload and try again' using errcode = '40001'; end if;

  -- Revision numbering: retain parent base number and append -V02, -V03 without consuming a new sequence counter
  if v_revision_of is not null then
    if p_type = 'quotation' then
      select number into v_parent_number from public.quotations where id = v_revision_of;
      if v_parent_number is not null then
        v_base_number := regexp_replace(v_parent_number, '-V[0-9]+$', '');
        select coalesce(max(
          nullif(substring(number from '-V([0-9]+)$'), '')::int
        ), 1) + 1
        into v_next_version
        from public.quotations
        where number = v_base_number or number ~ ('^' || v_base_number || '-V[0-9]+$');

        v_number := v_base_number || '-V' || lpad(v_next_version::text, 2, '0');
      else
        v_number := public.next_document_number(p_type);
      end if;
    elsif p_type = 'proposal' then
      select number into v_parent_number from public.proposals where id = v_revision_of;
      if v_parent_number is not null then
        v_base_number := regexp_replace(v_parent_number, '-V[0-9]+$', '');
        select coalesce(max(
          nullif(substring(number from '-V([0-9]+)$'), '')::int
        ), 1) + 1
        into v_next_version
        from public.proposals
        where number = v_base_number or number ~ ('^' || v_base_number || '-V[0-9]+$');

        v_number := v_base_number || '-V' || lpad(v_next_version::text, 2, '0');
      else
        v_number := public.next_document_number(p_type);
      end if;
    else
      v_number := public.next_document_number(p_type);
    end if;
  else
    v_number := public.next_document_number(p_type);
  end if;

  perform set_config('nafa.issuing', '1', true);
  if p_type = 'quotation' then
    update public.quotations set number = v_number, status = 'sent', issued_at = now(), sent_at = now(),
      snapshot = p_snapshot || jsonb_build_object('number', v_number, 'status', 'sent') where id = p_id;
  elsif p_type = 'invoice' then
    update public.invoices set number = v_number, state = 'issued', issued_at = now(),
      snapshot = p_snapshot || jsonb_build_object('number', v_number, 'status', 'issued') where id = p_id;
  else
    update public.proposals set number = v_number, status = 'sent', issued_at = now(), sent_at = now(),
      snapshot = p_snapshot || jsonb_build_object('number', v_number, 'status', 'sent') where id = p_id;
  end if;
  perform set_config('nafa.issuing', '0', true);
  return v_number;
end $$;
revoke all on function public.issue_document(public.document_type, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.issue_document(public.document_type, uuid, jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Quotation → invoice conversion
-- ---------------------------------------------------------------------------
create function public.convert_quotation_to_invoice(p_quotation_id uuid, p_confirm_additional boolean default false)
returns uuid language plpgsql set search_path = '' as $$
declare
  q public.quotations;
  s public.document_settings;
  v_id uuid;
  v_existing integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if q.status <> 'accepted' then
    raise exception 'QUOTATION_NOT_ACCEPTED: only an accepted quotation can be converted' using errcode = '23514';
  end if;
  select count(*) into v_existing from public.invoices where quotation_id = q.id and state <> 'cancelled';
  if v_existing > 0 and not p_confirm_additional then
    raise exception 'ALREADY_CONVERTED: this quotation already has % invoice(s)', v_existing using errcode = '23514';
  end if;
  select * into s from public.document_settings;

  insert into public.invoices (quotation_id, lead_id, company_id, contact_id, client_name, client_company, client_address, client_email, client_phone,
    client_gstin, project_name, project_location, project_date_text, quotation_number, invoice_date, due_date, config, subtotal, discount_total, agency_fee,
    taxable_value, cgst, sgst, igst, other_charges, round_off, grand_total, payment_terms_text, notes_text)
  values (q.id, q.lead_id, q.company_id, q.contact_id, q.client_name, q.client_company, q.client_address, q.client_email, q.client_phone, q.client_gstin,
    coalesce(nullif(q.event_name, ''), q.event_type), q.event_location, q.event_date_text, q.number, v_today, v_today + s.default_invoice_due_days,
    q.config, q.subtotal, q.discount_total, q.agency_fee, q.taxable_value, q.cgst, q.sgst, q.igst, q.other_charges, q.round_off, q.grand_total,
    s.invoice_payment_terms, s.invoice_notes)
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, catalogue_id, description, notes, hsn_sac, qty, rate, discount_type, discount_value, amount)
  select v_id, position, catalogue_id, description, notes, hsn_sac, qty, rate, discount_type, discount_value, amount
  from public.quotation_items where quotation_id = q.id order by position;

  perform public.log_document_activity('quotation', q.id, 'converted', 'Converted to an invoice draft', jsonb_build_object('invoice_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['document_settings', 'document_sequences', 'products_services', 'quotations', 'quotation_items', 'quotation_milestones',
    'invoices', 'invoice_items', 'invoice_payments', 'proposals', 'proposal_sections', 'proposal_attachments', 'document_activity', 'document_emails']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- settings / sequences: team reads, admins write (sequence counters cannot be decreased, see trigger)
grant select on public.document_settings, public.document_sequences to authenticated;
grant update on public.document_settings to authenticated;
grant update (prefix, padding, next_number) on public.document_sequences to authenticated;
create policy document_settings_select on public.document_settings for select to authenticated using ((select public.is_team_member()));
create policy document_settings_update on public.document_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy document_sequences_select on public.document_sequences for select to authenticated using ((select public.is_team_member()));
create policy document_sequences_update on public.document_sequences for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- catalogue
grant select, insert, update on public.products_services to authenticated;
create policy products_select on public.products_services for select to authenticated using ((select public.is_team_member()));
create policy products_insert on public.products_services for insert to authenticated with check ((select public.is_team_member()));
create policy products_update on public.products_services for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- documents and children: team read/write; only admins hard-delete drafts
do $$
declare t text;
begin
  foreach t in array array['quotations', 'quotation_items', 'quotation_milestones', 'invoices', 'invoice_items', 'proposals', 'proposal_sections', 'proposal_attachments']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_team_member()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_team_member()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_team_member()))', t || '_delete', t);
  end loop;
end $$;
-- Drafts only: a locked (issued) parent row cannot be deleted by anyone through the API.
drop policy quotations_delete on public.quotations;
create policy quotations_delete on public.quotations for delete to authenticated using ((select public.is_team_member()) and status = 'draft');
drop policy invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated using ((select public.is_team_member()) and state = 'draft');
drop policy proposals_delete on public.proposals;
create policy proposals_delete on public.proposals for delete to authenticated using ((select public.is_team_member()) and status = 'draft');

-- payments: insert + void (update), never delete
grant select, insert on public.invoice_payments to authenticated;
grant update (voided_at, voided_reason) on public.invoice_payments to authenticated;
create policy invoice_payments_select on public.invoice_payments for select to authenticated using ((select public.is_team_member()));
create policy invoice_payments_insert on public.invoice_payments for insert to authenticated with check ((select public.is_team_member()));
create policy invoice_payments_update on public.invoice_payments for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- append-only logs
grant select, insert on public.document_activity, public.document_emails to authenticated;
create policy document_activity_select on public.document_activity for select to authenticated using ((select public.is_team_member()));
create policy document_activity_insert on public.document_activity for insert to authenticated with check ((select public.is_team_member()));
create policy document_emails_select on public.document_emails for select to authenticated using ((select public.is_team_member()));
create policy document_emails_insert on public.document_emails for insert to authenticated with check ((select public.is_team_member()));

revoke all on function public.save_quotation(jsonb), public.save_invoice(jsonb), public.save_proposal(jsonb),
  public.convert_quotation_to_invoice(uuid, boolean), public.log_document_activity(public.document_type, uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_quotation(jsonb), public.save_invoice(jsonb), public.save_proposal(jsonb),
  public.convert_quotation_to_invoice(uuid, boolean), public.log_document_activity(public.document_type, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- List views (security_invoker => RLS applies)
-- ---------------------------------------------------------------------------
create view public.quotation_list with (security_invoker = true) as
select q.id, q.number, q.status,
       case when q.status = 'sent' and q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Kolkata')::date then 'expired' else q.status::text end as effective_status,
       q.lead_id, q.company_id, q.contact_id, q.client_name, q.client_company, q.event_name, q.event_type, q.quotation_date, q.valid_until,
       q.grand_total, q.created_at, q.updated_at, q.issued_at, q.revision_of,
       (select count(*)::int from public.invoices i where i.quotation_id = q.id and i.state <> 'cancelled') as invoice_count
from public.quotations q;

create view public.invoice_list with (security_invoker = true) as
select i.id, i.number, i.state, i.quotation_id, i.quotation_number, i.lead_id, i.company_id, i.contact_id, i.client_name, i.client_company, i.project_name,
       i.invoice_date, i.due_date, i.grand_total, i.created_at, i.updated_at, i.issued_at,
       coalesce(p.received, 0) as amount_received,
       i.grand_total - coalesce(p.received, 0) as balance_due,
       case
         when i.state = 'draft' then 'draft'
         when i.state = 'cancelled' then 'cancelled'
         when i.grand_total > 0 and coalesce(p.received, 0) >= i.grand_total then 'paid'
         when i.due_date is not null and i.due_date < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
         when coalesce(p.received, 0) > 0 then 'partially_paid'
         else 'issued'
       end as payment_status
from public.invoices i
left join lateral (select sum(amount) as received from public.invoice_payments x where x.invoice_id = i.id and x.voided_at is null) p on true;

create view public.proposal_list with (security_invoker = true) as
select p.id, p.number, p.status, p.title, p.lead_id, p.company_id, p.client_name, p.client_company, p.proposal_date, p.quotation_id,
       p.created_at, p.updated_at, p.issued_at
from public.proposals p;

create view public.payment_list with (security_invoker = true) as
select pay.id, pay.invoice_id, pay.paid_on, pay.amount, pay.method, pay.reference, pay.notes, pay.voided_at, pay.voided_reason, pay.created_at,
       i.number as invoice_number, i.client_company, i.client_name, i.project_name, i.grand_total as invoice_total
from public.invoice_payments pay
join public.invoices i on i.id = pay.invoice_id;

revoke all on public.quotation_list, public.invoice_list, public.proposal_list, public.payment_list from anon;
grant select on public.quotation_list, public.invoice_list, public.proposal_list, public.payment_list to authenticated;
