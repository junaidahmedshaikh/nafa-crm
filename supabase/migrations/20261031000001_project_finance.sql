-- NAFA Business OS — Project Budget & Profit Management
--
-- Reuses: companies, leads, quotations, invoices, invoice_payments, profiles (employees), payment_method.
-- Adds:   projects, project_team, project_invoices (link table, so issued invoices are never modified),
--         project_revenue_items, expense_categories, project_budgets, vendors, expenses, expense_payments,
--         reimbursements, finance_audit.
--
-- Money rules
--   * Revenue and cost are GST-exclusive. GST on a bill is a cost only when it is NOT recoverable
--     (expenses.gst_recoverable = false); recoverable input GST is tracked separately and never counted.
--   * An expense counts toward actuals only once approved and not soft-deleted.
--   * A reimbursement counts toward project cost only when approved/reimbursed AND not linked to an
--     already-recorded expense (reimbursements.expense_id is null) => never double counted.
--   * Payments are never deleted, only voided. Records are soft-deleted; only an admin can restore.

-- ---------------------------------------------------------------------------
-- Roles. profiles.role (admin/member) is unchanged; finance_role grants access to this module.
-- Existing members default to 'none' => no access to financial data until an admin grants it.
-- ---------------------------------------------------------------------------
create type public.finance_role as enum ('none', 'operations', 'project_manager', 'accounts', 'management');
alter table public.profiles add column finance_role public.finance_role not null default 'none';

create type public.project_status as enum ('planning', 'confirmed', 'in_progress', 'completed', 'settled', 'cancelled');
create type public.revenue_kind as enum ('additional_charge', 'change_order');
create type public.approval_status as enum ('submitted', 'approved', 'rejected');
create type public.reimbursement_status as enum ('submitted', 'approved', 'rejected', 'reimbursed');

-- admin and 'management'/'accounts' manage everything; project_manager/operations see assigned projects only.
create function public.fin_role() returns text
language sql stable security definer set search_path = ''
as $$
  select case when p.role = 'admin' then 'admin' else p.finance_role::text end
  from public.profiles p where p.id = auth.uid() and p.is_active;
$$;
create function public.fin_any() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.fin_role(), 'none') <> 'none'; $$;
create function public.fin_manage() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.fin_role(), 'none') in ('admin', 'management', 'accounts'); $$;
create function public.fin_can_read_project(p_project uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return public.fin_manage() or (
    public.fin_any() and exists (select 1 from public.project_team t where t.project_id = p_project and t.user_id = auth.uid())
  );
end $$;
revoke all on function public.fin_role(), public.fin_any(), public.fin_manage(), public.fin_can_read_project(uuid) from public, anon;
grant execute on function public.fin_role(), public.fin_any(), public.fin_manage(), public.fin_can_read_project(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.projects (
  id                    uuid primary key default gen_random_uuid(),
  project_number        bigint generated always as identity,
  name                  text not null check (length(btrim(name)) > 0),
  company_id            uuid references public.companies (id) on delete set null,
  lead_id               uuid references public.leads (id) on delete set null,
  quotation_id          uuid references public.quotations (id) on delete set null,
  category              text not null default '',
  location              text not null default '',
  start_date            date,
  end_date              date,
  manager_id            uuid references public.profiles (id) on delete set null,
  status                public.project_status not null default 'planning',
  approved_value        numeric(14, 2) not null default 0 check (approved_value >= 0),   -- GST-exclusive
  final_billing_amount  numeric(14, 2) check (final_billing_amount is null or final_billing_amount >= 0),
  notes                 text not null default '',
  created_by            uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            uuid references public.profiles (id) on delete set null,
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index projects_company_idx on public.projects (company_id);
create index projects_manager_idx on public.projects (manager_id);
create index projects_start_idx on public.projects (start_date) where deleted_at is null;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();

create table public.project_team (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (project_id, user_id)
);
create index project_team_user_idx on public.project_team (user_id);

-- Links an existing invoice to a project. A separate table: issued invoices are immutable.
create table public.project_invoices (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  invoice_id uuid not null unique references public.invoices (id) on delete cascade,
  linked_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_invoices_project_idx on public.project_invoices (project_id);

create table public.project_revenue_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  kind        public.revenue_kind not null,
  description text not null check (length(btrim(description)) > 0),
  amount      numeric(14, 2) not null check (amount <> 0),   -- GST-exclusive; negative for a reducing change order
  approved    boolean not null default false,
  item_date   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null
);
create index project_revenue_items_project_idx on public.project_revenue_items (project_id);

create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 100,
  is_default boolean not null default false,
  is_active  boolean not null default true
);
create unique index expense_categories_name_uidx on public.expense_categories (lower(btrim(name)));
insert into public.expense_categories (name, sort_order, is_default) values
  ('Manpower & Staffing', 1, true), ('Fabrication & Production', 2, true), ('LED Screens & AV', 3, true),
  ('Sound & Lighting', 4, true), ('Decoration & Florals', 5, true), ('Printing & Branding', 6, true),
  ('Transportation & Logistics', 7, true), ('Accommodation', 8, true), ('Food & Beverages', 9, true),
  ('Artist & Entertainment', 10, true), ('Photography & Videography', 11, true), ('Venue & Permissions', 12, true),
  ('Security & Housekeeping', 13, true), ('Equipment Rental', 14, true), ('Client Reimbursements', 15, true),
  ('Miscellaneous', 16, true);

create table public.project_budgets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  amount      numeric(14, 2) not null default 0 check (amount >= 0),   -- GST-exclusive estimate
  unique (project_id, category_id)
);
create index project_budgets_category_idx on public.project_budgets (category_id);

create table public.vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  gstin      text not null default '',
  phone      text not null default '',
  email      text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);
create unique index vendors_name_uidx on public.vendors (lower(btrim(name))) where deleted_at is null;

create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  expense_number   bigint generated always as identity,
  project_id       uuid not null references public.projects (id) on delete restrict,
  expense_date     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  category_id      uuid not null references public.expense_categories (id) on delete restrict,
  description      text not null check (length(btrim(description)) > 0),
  vendor_id        uuid references public.vendors (id) on delete set null,
  bill_number      text,
  qty              numeric(14, 3) not null default 1 check (qty > 0),
  unit             text not null default 'nos',
  rate             numeric(14, 2) not null default 0 check (rate >= 0),
  subtotal         numeric(14, 2) generated always as (round(qty * rate, 2)) stored,
  gst_amount       numeric(14, 2) not null default 0 check (gst_amount >= 0),
  gst_recoverable  boolean not null default true,
  total_amount     numeric(14, 2) generated always as (round(qty * rate, 2) + gst_amount) stored,
  estimated_amount numeric(14, 2) check (estimated_amount is null or estimated_amount >= 0),
  due_date         date,
  approval_status  public.approval_status not null default 'approved',
  notes            text not null default '',
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id) on delete set null
);
create index expenses_project_idx on public.expenses (project_id, expense_date desc) where deleted_at is null;
create index expenses_vendor_idx on public.expenses (vendor_id);
create index expenses_category_idx on public.expenses (category_id);
-- the same vendor bill cannot be entered twice on a project
create unique index expenses_bill_uidx on public.expenses (project_id, vendor_id, lower(btrim(bill_number)))
  where bill_number is not null and btrim(bill_number) <> '' and vendor_id is not null and deleted_at is null;
create trigger expenses_updated_at before update on public.expenses for each row execute function public.set_updated_at();

create table public.expense_payments (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references public.expenses (id) on delete restrict,
  paid_on       date not null,
  amount        numeric(14, 2) not null check (amount > 0),
  method        public.payment_method not null default 'bank_transfer',
  reference     text,
  notes         text,
  voided_at     timestamptz,
  voided_reason text,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint expense_payments_void_reason check (voided_at is null or length(btrim(coalesce(voided_reason, ''))) > 0)
);
create index expense_payments_expense_idx on public.expense_payments (expense_id);
-- duplicate-entry protection: same expense, date, amount and reference cannot be recorded twice
create unique index expense_payments_dup_uidx on public.expense_payments (expense_id, paid_on, amount, coalesce(btrim(reference), ''))
  where voided_at is null;

create table public.reimbursements (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid default auth.uid() references public.profiles (id) on delete set null,
  person_name     text not null check (length(btrim(person_name)) > 0),
  project_id      uuid not null references public.projects (id) on delete restrict,
  expense_date    date not null default ((now() at time zone 'Asia/Kolkata')::date),
  description     text not null check (length(btrim(description)) > 0),
  category_id     uuid not null references public.expense_categories (id) on delete restrict,
  amount          numeric(14, 2) not null check (amount > 0),
  status          public.reimbursement_status not null default 'submitted',
  reimbursed_on   date,
  expense_id      uuid references public.expenses (id) on delete set null,   -- set when already recorded as an expense => not counted twice
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null,
  constraint reimbursements_paid_date check (status <> 'reimbursed' or reimbursed_on is not null)
);
create index reimbursements_project_idx on public.reimbursements (project_id) where deleted_at is null;
create index reimbursements_person_idx on public.reimbursements (person_id);
create trigger reimbursements_updated_at before update on public.reimbursements for each row execute function public.set_updated_at();

create table public.finance_audit (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  old_row    jsonb,
  new_row    jsonb
);
create index finance_audit_row_idx on public.finance_audit (table_name, row_id);
create index finance_audit_at_idx on public.finance_audit (at desc);

-- ---------------------------------------------------------------------------
-- Triggers: audit log, soft-delete rules, payment guard, approval default
-- ---------------------------------------------------------------------------
create function public.fin_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.finance_audit (actor, table_name, row_id, action, old_row, new_row)
  values (auth.uid(), tg_table_name, (r ->> 'id')::uuid, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects', 'project_invoices', 'project_revenue_items', 'project_budgets', 'vendors', 'expenses',
                           'expense_payments', 'reimbursements', 'expense_categories'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.fin_audit()', t || '_audit', t);
  end loop;
end $$;

-- Soft delete: managers may delete, only an admin may restore; deleted_by is stamped by the database.
create function public.fin_soft_delete_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if not public.fin_manage() then raise exception 'NOT_AUTHORISED: only accounts/management can delete financial records' using errcode = '42501'; end if;
    new.deleted_by := auth.uid();
  elsif old.deleted_at is not null and new.deleted_at is null then
    if not public.is_admin() then raise exception 'NOT_AUTHORISED: only an administrator can restore deleted records' using errcode = '42501'; end if;
    new.deleted_by := null;
  elsif old.deleted_at is not null and not public.is_admin() then
    raise exception 'RECORD_DELETED: this record has been deleted' using errcode = '23514';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['projects', 'project_revenue_items', 'vendors', 'expenses', 'reimbursements'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.fin_soft_delete_guard()', t || '_softdel', t);
  end loop;
end $$;

-- Expenses added by non-managers are 'submitted' and need approval; managers' entries are approved.
-- Only a manager may change approval_status.
create function public.expenses_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.approval_status := case when public.fin_manage() then coalesce(new.approval_status, 'approved') else 'submitted' end;
  elsif new.approval_status is distinct from old.approval_status and not public.fin_manage() then
    raise exception 'NOT_AUTHORISED: only accounts/management can approve expenses' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger expenses_guard before insert or update on public.expenses for each row execute function public.expenses_guard();

-- Payments: row-locks the expense, can never exceed the bill, and can only be voided afterwards.
create function public.expense_payments_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare e record; paid numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYMENT_IMMUTABLE: payments can only be voided' using errcode = '23514';
  elsif tg_op = 'UPDATE' then
    if old.voided_at is not null or new.voided_at is null or (to_jsonb(new) - 'voided_at' - 'voided_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_reason') then
      raise exception 'PAYMENT_IMMUTABLE: payments can only be voided' using errcode = '23514';
    end if;
    return new;
  end if;
  select ex.total_amount, ex.deleted_at, ex.approval_status into e from public.expenses ex where ex.id = new.expense_id for update;
  if not found or e.deleted_at is not null then raise exception 'EXPENSE_NOT_FOUND' using errcode = '23503'; end if;
  if e.approval_status <> 'approved' then raise exception 'EXPENSE_NOT_APPROVED: approve the expense before recording payments' using errcode = '23514'; end if;
  select coalesce(sum(p.amount), 0) into paid from public.expense_payments p where p.expense_id = new.expense_id and p.voided_at is null;
  if paid + new.amount > e.total_amount then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: payable balance is %', e.total_amount - paid using errcode = '23514';
  end if;
  return new;
end $$;
create trigger expense_payments_guard before insert or update or delete on public.expense_payments for each row execute function public.expense_payments_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.project_team enable row level security;
alter table public.project_invoices enable row level security;
alter table public.project_revenue_items enable row level security;
alter table public.expense_categories enable row level security;
alter table public.project_budgets enable row level security;
alter table public.vendors enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
alter table public.reimbursements enable row level security;
alter table public.finance_audit enable row level security;

revoke all on public.projects, public.project_team, public.project_invoices, public.project_revenue_items, public.expense_categories,
  public.project_budgets, public.vendors, public.expenses, public.expense_payments, public.reimbursements, public.finance_audit from anon, authenticated;
grant select, insert, update on public.projects, public.project_invoices, public.project_revenue_items, public.expense_categories,
  public.project_budgets, public.vendors, public.expenses, public.expense_payments, public.reimbursements to authenticated;
grant select, insert, delete on public.project_team to authenticated;
grant select, delete on public.project_invoices to authenticated;
grant delete on public.project_budgets to authenticated;
grant select on public.finance_audit to authenticated;

-- projects: assigned users and managers read; managers write. Deleted rows are visible to managers only (trash).
create policy projects_select on public.projects for select to authenticated
  using ((select public.fin_can_read_project(id)) and (deleted_at is null or (select public.fin_manage())));
create policy projects_insert on public.projects for insert to authenticated with check ((select public.fin_manage()));
create policy projects_update on public.projects for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

create policy project_team_select on public.project_team for select to authenticated
  using ((select public.fin_manage()) or user_id = (select auth.uid()));
create policy project_team_write on public.project_team for insert to authenticated with check ((select public.fin_manage()));
create policy project_team_delete on public.project_team for delete to authenticated using ((select public.fin_manage()));

-- Revenue data: managers only (project managers and operations never see revenue or profit).
create policy project_invoices_select on public.project_invoices for select to authenticated using ((select public.fin_manage()));
create policy project_invoices_insert on public.project_invoices for insert to authenticated with check ((select public.fin_manage()));
create policy project_invoices_delete on public.project_invoices for delete to authenticated using ((select public.fin_manage()));
create policy project_revenue_select on public.project_revenue_items for select to authenticated using ((select public.fin_manage()));
create policy project_revenue_insert on public.project_revenue_items for insert to authenticated with check ((select public.fin_manage()));
create policy project_revenue_update on public.project_revenue_items for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

create policy expense_categories_select on public.expense_categories for select to authenticated using ((select public.fin_any()));
create policy expense_categories_insert on public.expense_categories for insert to authenticated with check ((select public.fin_manage()));
create policy expense_categories_update on public.expense_categories for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

create policy project_budgets_select on public.project_budgets for select to authenticated using ((select public.fin_can_read_project(project_id)));
create policy project_budgets_insert on public.project_budgets for insert to authenticated with check ((select public.fin_manage()));
create policy project_budgets_update on public.project_budgets for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));
create policy project_budgets_delete on public.project_budgets for delete to authenticated using ((select public.fin_manage()));

create policy vendors_select on public.vendors for select to authenticated
  using ((select public.fin_any()) and (deleted_at is null or (select public.fin_manage())));
create policy vendors_insert on public.vendors for insert to authenticated with check ((select public.fin_manage()));
create policy vendors_update on public.vendors for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

-- Expenses: managers do everything; assigned users read, add 'submitted' expenses, and edit their own while still submitted.
create policy expenses_select on public.expenses for select to authenticated
  using ((select public.fin_can_read_project(project_id)) and (deleted_at is null or (select public.fin_manage())));
create policy expenses_insert on public.expenses for insert to authenticated
  with check ((select public.fin_manage()) or ((select public.fin_can_read_project(project_id)) and created_by = (select auth.uid())));
create policy expenses_update on public.expenses for update to authenticated
  using ((select public.fin_manage()) or (created_by = (select auth.uid()) and approval_status = 'submitted' and deleted_at is null))
  with check ((select public.fin_manage()) or (created_by = (select auth.uid()) and approval_status = 'submitted'));

create policy expense_payments_select on public.expense_payments for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and (select public.fin_can_read_project(e.project_id))));
create policy expense_payments_insert on public.expense_payments for insert to authenticated with check ((select public.fin_manage()));
create policy expense_payments_update on public.expense_payments for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

create policy reimbursements_select on public.reimbursements for select to authenticated
  using ((select public.fin_manage()) or person_id = (select auth.uid()));
create policy reimbursements_insert on public.reimbursements for insert to authenticated
  with check ((select public.fin_manage()) or (
    (select public.fin_any()) and person_id = (select auth.uid()) and status = 'submitted' and (select public.fin_can_read_project(project_id))));
create policy reimbursements_update on public.reimbursements for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));

create policy finance_audit_select on public.finance_audit for select to authenticated
  using ((select public.fin_role()) in ('admin', 'management'));

-- ---------------------------------------------------------------------------
-- Views (security invoker: RLS of the caller applies)
-- ---------------------------------------------------------------------------
-- One row per live expense with payment totals. cost_amount is the GST-exclusive project cost.
create view public.expense_list with (security_invoker = true) as
select e.id, 'EXP-' || lpad(e.expense_number::text, 6, '0') as expense_code, e.project_id, p.name as project_name, e.expense_date,
       e.category_id, c.name as category_name, e.description, e.vendor_id, v.name as vendor_name, e.bill_number, e.qty, e.unit, e.rate,
       e.subtotal, e.gst_amount, e.gst_recoverable, e.total_amount, e.estimated_amount, e.due_date, e.approval_status, e.notes,
       e.created_by, e.created_at, e.deleted_at,
       case when e.gst_recoverable then e.subtotal else e.total_amount end as cost_amount,
       coalesce(pay.paid, 0) as paid_amount,
       e.total_amount - coalesce(pay.paid, 0) as outstanding_amount,
       case when coalesce(pay.paid, 0) >= e.total_amount then 'paid'
            when e.due_date is not null and e.due_date < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
            when coalesce(pay.paid, 0) > 0 then 'partial' else 'pending' end as payment_status,
       pay.last_paid_on
from public.expenses e
join public.projects p on p.id = e.project_id
join public.expense_categories c on c.id = e.category_id
left join public.vendors v on v.id = e.vendor_id
left join lateral (
  select sum(x.amount) as paid, max(x.paid_on) as last_paid_on
  from public.expense_payments x where x.expense_id = e.id and x.voided_at is null
) pay on true;

-- Cost rows used for every actual: approved, live expenses plus approved reimbursements that are not already an expense.
create view public.project_cost_lines with (security_invoker = true) as
select e.project_id, e.category_id, e.expense_date as cost_date, e.cost_amount as amount, 'expense'::text as source, e.id as source_id
from public.expense_list e where e.deleted_at is null and e.approval_status = 'approved'
union all
select r.project_id, r.category_id, r.expense_date, r.amount, 'reimbursement', r.id
from public.reimbursements r
where r.deleted_at is null and r.status in ('approved', 'reimbursed') and r.expense_id is null;

create view public.budget_status with (security_invoker = true) as
with actual as (
  select project_id, category_id, sum(amount) as amount from public.project_cost_lines group by project_id, category_id
), keys as (
  select project_id, category_id from public.project_budgets
  union select project_id, category_id from actual
)
select k.project_id, k.category_id, c.name as category_name, coalesce(b.amount, 0) as budget, coalesce(a.amount, 0) as actual,
       coalesce(b.amount, 0) - coalesce(a.amount, 0) as remaining,
       case when coalesce(b.amount, 0) > 0 then round(coalesce(a.amount, 0) / b.amount * 100, 1) end as utilization_pct,
       case when coalesce(a.amount, 0) > coalesce(b.amount, 0) then 'over'
            when coalesce(b.amount, 0) > 0 and a.amount >= b.amount * 0.9 then 'critical'
            when coalesce(b.amount, 0) > 0 and a.amount >= b.amount * 0.75 then 'warning' else 'ok' end as alert
from keys k
join public.expense_categories c on c.id = k.category_id
join public.projects p on p.id = k.project_id and p.deleted_at is null
left join public.project_budgets b on b.project_id = k.project_id and b.category_id = k.category_id
left join actual a on a.project_id = k.project_id and a.category_id = k.category_id;

-- Per-project money summary. All amounts GST-exclusive unless named gst_*. Derived figures (profit, margins) are computed in the app.
create view public.project_finance_summary with (security_invoker = true) as
select p.id as project_id, p.name, p.status, p.company_id, p.start_date, p.end_date, p.approved_value, p.final_billing_amount,
       coalesce(p.start_date, (p.created_at at time zone 'Asia/Kolkata')::date) as basis_date,
       coalesce((select sum(r.amount) from public.project_revenue_items r where r.project_id = p.id and r.deleted_at is null and r.approved and r.kind = 'additional_charge'), 0) as additional_charges,
       coalesce((select sum(r.amount) from public.project_revenue_items r where r.project_id = p.id and r.deleted_at is null and r.approved and r.kind = 'change_order'), 0) as change_orders,
       coalesce((select sum(i.grand_total - i.cgst - i.sgst - i.igst) from public.project_invoices pi join public.invoices i on i.id = pi.invoice_id
                 where pi.project_id = p.id and i.state = 'issued'), 0) as invoiced_ex_gst,
       coalesce((select sum(i.cgst + i.sgst + i.igst) from public.project_invoices pi join public.invoices i on i.id = pi.invoice_id
                 where pi.project_id = p.id and i.state = 'issued'), 0) as gst_collected,
       coalesce((select sum(i.grand_total) from public.project_invoices pi join public.invoices i on i.id = pi.invoice_id
                 where pi.project_id = p.id and i.state = 'issued'), 0) as invoiced_total,
       coalesce((select sum(ip.amount) from public.project_invoices pi join public.invoices i on i.id = pi.invoice_id
                 join public.invoice_payments ip on ip.invoice_id = i.id and ip.voided_at is null
                 where pi.project_id = p.id and i.state = 'issued'), 0) as received,
       coalesce((select sum(b.amount) from public.project_budgets b where b.project_id = p.id), 0) as budget_total,
       coalesce((select sum(l.amount) from public.project_cost_lines l where l.project_id = p.id and l.source = 'expense'), 0) as expense_cost,
       coalesce((select sum(l.amount) from public.project_cost_lines l where l.project_id = p.id and l.source = 'reimbursement'), 0) as reimbursement_cost,
       coalesce((select sum(e.gst_amount) from public.expense_list e where e.project_id = p.id and e.deleted_at is null and e.approval_status = 'approved' and e.gst_recoverable), 0) as gst_input_recoverable,
       coalesce((select sum(e.total_amount) from public.expense_list e where e.project_id = p.id and e.deleted_at is null and e.approval_status = 'approved'), 0) as bills_total,
       coalesce((select sum(e.paid_amount) from public.expense_list e where e.project_id = p.id and e.deleted_at is null and e.approval_status = 'approved'), 0) as bills_paid
from public.projects p
where p.deleted_at is null;

-- Vendor bills with outstanding balance (a vendor bill is an expense that has a vendor).
create view public.vendor_payables with (security_invoker = true) as
select e.vendor_id, e.vendor_name, e.id as expense_id, e.expense_code, e.project_id, e.project_name, e.bill_number, e.expense_date, e.due_date,
       e.total_amount, e.paid_amount, e.outstanding_amount, e.payment_status
from public.expense_list e
where e.deleted_at is null and e.approval_status = 'approved' and e.vendor_id is not null;

revoke all on public.expense_list, public.project_cost_lines, public.budget_status, public.project_finance_summary, public.vendor_payables from anon;
grant select on public.expense_list, public.project_cost_lines, public.budget_status, public.project_finance_summary, public.vendor_payables to authenticated;

-- Monthly revenue (issued invoices, GST-exclusive, by invoice date) vs cost (by cost date), optionally for one project.
create function public.finance_monthly(p_from date default null, p_to date default null, p_project uuid default null)
returns table (month date, revenue numeric, cost numeric)
language sql stable set search_path = ''
as $$
  with rev as (
    select date_trunc('month', i.invoice_date)::date as m, sum(i.grand_total - i.cgst - i.sgst - i.igst) as v
    from public.project_invoices pi join public.invoices i on i.id = pi.invoice_id
    where i.state = 'issued' and (p_project is null or pi.project_id = p_project)
      and (p_from is null or i.invoice_date >= p_from) and (p_to is null or i.invoice_date <= p_to)
    group by 1
  ), cst as (
    select date_trunc('month', l.cost_date)::date as m, sum(l.amount) as v
    from public.project_cost_lines l
    where (p_project is null or l.project_id = p_project)
      and (p_from is null or l.cost_date >= p_from) and (p_to is null or l.cost_date <= p_to)
    group by 1
  )
  select coalesce(r.m, c.m), coalesce(r.v, 0), coalesce(c.v, 0) from rev r full join cst c on c.m = r.m order by 1;
$$;
revoke all on function public.finance_monthly(date, date, uuid) from public, anon;
grant execute on function public.finance_monthly(date, date, uuid) to authenticated;

-- Cost by category for projects whose basis date is in range (or for one project).
create function public.finance_category_totals(p_from date default null, p_to date default null, p_project uuid default null)
returns table (category_id uuid, category_name text, amount numeric)
language sql stable set search_path = ''
as $$
  select l.category_id, c.name, sum(l.amount)
  from public.project_cost_lines l
  join public.expense_categories c on c.id = l.category_id
  join public.project_finance_summary s on s.project_id = l.project_id
  where (p_project is null or l.project_id = p_project)
    and (p_project is not null or ((p_from is null or s.basis_date >= p_from) and (p_to is null or s.basis_date <= p_to)))
  group by l.category_id, c.name order by 3 desc;
$$;
revoke all on function public.finance_category_totals(date, date, uuid) from public, anon;
grant execute on function public.finance_category_totals(date, date, uuid) to authenticated;
