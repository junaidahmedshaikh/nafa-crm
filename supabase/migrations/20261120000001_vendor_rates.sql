-- NAFA Business OS — Vendor Rates & Services
--
-- Reuses: vendors (the finance vendor list, already linked to project expenses), products_services (the quotation catalogue),
--         profiles, fin_any() / fin_manage().
-- Adds:   vendor profile columns, vendor_categories, vendor_rates (one vendor's price for one catalogue item),
--         vendor_rate_history (every price change, written by a trigger), vendor_rate_list / vendor_list views.
--
-- Additive and idempotent: no existing table is rewritten, no row is changed or removed. Existing vendors and catalogue
-- items keep working exactly as before.
--
-- Confidentiality: purchase rates are readable only by people with a finance role (fin_any) and writable by
-- admin / accounts / management (fin_manage). They are never copied into quotations or invoices.

-- ---------------------------------------------------------------------------
-- Vendor profile
-- ---------------------------------------------------------------------------
alter table public.vendors
  add column if not exists contact_person      text not null default '',
  add column if not exists whatsapp            text not null default '',
  add column if not exists website             text not null default '',
  add column if not exists city                text not null default '',
  add column if not exists state               text not null default '',
  add column if not exists service_locations   text not null default '',
  add column if not exists address             text not null default '',
  add column if not exists category            text not null default '',
  add column if not exists services_provided   text not null default '',
  add column if not exists gst_registered      boolean not null default false,
  add column if not exists pan                 text not null default '',
  add column if not exists payment_terms       text not null default '',
  add column if not exists credit_period_days  integer check (credit_period_days is null or credit_period_days between 0 and 365),
  add column if not exists advance_requirement text not null default '',
  add column if not exists status              text not null default 'active',
  add column if not exists is_preferred        boolean not null default false,
  add column if not exists rating_quality      smallint,
  add column if not exists rating_pricing      smallint,
  add column if not exists rating_reliability  smallint,
  add column if not exists rating_timeliness   smallint,
  add column if not exists feedback            text not null default '',
  add column if not exists past_projects       text not null default '',
  add column if not exists updated_at          timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vendors_status_check') then
    alter table public.vendors add constraint vendors_status_check check (status in ('active', 'inactive', 'blacklisted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendors_ratings_check') then
    alter table public.vendors add constraint vendors_ratings_check check (
      (rating_quality is null or rating_quality between 1 and 5) and (rating_pricing is null or rating_pricing between 1 and 5) and
      (rating_reliability is null or rating_reliability between 1 and 5) and (rating_timeliness is null or rating_timeliness between 1 and 5));
  end if;
end $$;
create index if not exists vendors_category_idx on public.vendors (category) where deleted_at is null;
create index if not exists vendors_city_idx on public.vendors (lower(city)) where deleted_at is null;

create table if not exists public.vendor_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 100,
  is_default boolean not null default false
);
create unique index if not exists vendor_categories_name_uidx on public.vendor_categories (lower(btrim(name)));
insert into public.vendor_categories (name, sort_order, is_default) values
  ('Event Production', 1, true), ('Fabrication', 2, true), ('Decoration', 3, true), ('Flower Decoration', 4, true), ('Balloon Decoration', 5, true),
  ('AV / Sound / Lighting', 6, true), ('LED Screens', 7, true), ('Stage & Trussing', 8, true), ('Furniture & Rental', 9, true),
  ('Exhibition Stall Fabrication', 10, true), ('Printing & Branding', 11, true), ('Manpower & Staffing', 12, true),
  ('Promoters & BTL Activations', 13, true), ('Artists & Entertainment', 14, true), ('Anchors / Emcees / DJs', 15, true),
  ('Photography & Videography', 16, true), ('Catering & Hospitality', 17, true), ('Logistics & Transportation', 18, true),
  ('Venues & Banquets', 19, true), ('Christmas & Festive Decoration', 20, true), ('Wedding Vendors', 21, true), ('Miscellaneous', 22, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Vendor rates: one vendor's price for one catalogue item (the same item can have many vendors)
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_rates (
  id                 uuid primary key default gen_random_uuid(),
  vendor_id          uuid not null references public.vendors (id) on delete restrict,
  product_id         uuid not null references public.products_services (id) on delete restrict,
  rate_type          text not null default 'purchase',
  unit               text not null default 'nos' check (length(btrim(unit)) between 1 and 40),
  rate               numeric(14, 2) not null check (rate >= 0),
  min_order_qty      numeric(14, 3) check (min_order_qty is null or min_order_qty >= 0),
  rental_duration    text not null default '',
  weekly_rate        numeric(14, 2) check (weekly_rate is null or weekly_rate >= 0),
  monthly_rate       numeric(14, 2) check (monthly_rate is null or monthly_rate >= 0),
  security_deposit   numeric(14, 2) check (security_deposit is null or security_deposit >= 0),
  damage_charges     text not null default '',
  setup_charges      numeric(14, 2) not null default 0 check (setup_charges >= 0),
  transport_charges  numeric(14, 2) not null default 0 check (transport_charges >= 0),
  other_charges      numeric(14, 2) not null default 0 check (other_charges >= 0),
  gst_percent        numeric(5, 2) not null default 0 check (gst_percent between 0 and 100),
  valid_until        date,
  availability       text not null default '',
  service_location   text not null default '',
  specifications     text not null default '',
  notes              text not null default '',
  is_active          boolean not null default true,
  effective_from     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  change_note        text not null default '',     -- why the price last changed; copied into the history row
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vendor_rates_type_check check (rate_type in ('purchase', 'rental', 'per_day', 'per_hour', 'per_event', 'per_person', 'per_sqft', 'per_unit', 'package', 'custom'))
);
-- Deleting a rate hides it everywhere but keeps the row and its price history (soft delete).
alter table public.vendor_rates
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null;
-- the same vendor cannot hold two live prices of the same kind for the same item
drop index if exists public.vendor_rates_live_uidx;
create unique index vendor_rates_live_uidx on public.vendor_rates (vendor_id, product_id, rate_type) where is_active and deleted_at is null;
create index if not exists vendor_rates_product_idx on public.vendor_rates (product_id);
create index if not exists vendor_rates_vendor_idx on public.vendor_rates (vendor_id);
drop trigger if exists vendor_rates_updated_at on public.vendor_rates;
create trigger vendor_rates_updated_at before update on public.vendor_rates for each row execute function public.set_updated_at();

create table if not exists public.vendor_rate_history (
  id                    bigint generated always as identity primary key,
  rate_id               uuid not null references public.vendor_rates (id) on delete cascade,
  old_rate              numeric(14, 2) not null,
  new_rate              numeric(14, 2) not null,
  old_setup_charges     numeric(14, 2) not null,
  old_transport_charges numeric(14, 2) not null,
  old_other_charges     numeric(14, 2) not null,
  old_gst_percent       numeric(5, 2) not null,
  old_unit              text not null,
  old_effective_from    date not null,
  effective_from        date not null,
  note                  text not null default '',
  changed_by            uuid references public.profiles (id) on delete set null,
  changed_at            timestamptz not null default now()
);
create index if not exists vendor_rate_history_rate_idx on public.vendor_rate_history (rate_id, changed_at desc);

-- Every price change keeps the previous price. Done in the database so no code path can overwrite a rate silently.
create or replace function public.vendor_rates_track() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if old.deleted_at is null and new.deleted_at is not null then new.deleted_by := auth.uid(); new.is_active := false; end if;
  if new.rate is distinct from old.rate or new.setup_charges is distinct from old.setup_charges or new.transport_charges is distinct from old.transport_charges
     or new.other_charges is distinct from old.other_charges or new.gst_percent is distinct from old.gst_percent or new.unit is distinct from old.unit then
    insert into public.vendor_rate_history (rate_id, old_rate, new_rate, old_setup_charges, old_transport_charges, old_other_charges, old_gst_percent, old_unit,
                                            old_effective_from, effective_from, note, changed_by)
    values (old.id, old.rate, new.rate, old.setup_charges, old.transport_charges, old.other_charges, old.gst_percent, old.unit,
            old.effective_from, new.effective_from, new.change_note, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists vendor_rates_track on public.vendor_rates;
create trigger vendor_rates_track before update on public.vendor_rates for each row execute function public.vendor_rates_track();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.vendor_categories enable row level security;
alter table public.vendor_rates enable row level security;
alter table public.vendor_rate_history enable row level security;
revoke all on public.vendor_categories, public.vendor_rates, public.vendor_rate_history from anon, authenticated;
grant select, insert on public.vendor_categories to authenticated;
grant select, insert, update on public.vendor_rates to authenticated;      -- no delete: a rate is deactivated, its history is kept
grant select on public.vendor_rate_history to authenticated;                -- written by the trigger only

drop policy if exists vendor_categories_select on public.vendor_categories;
drop policy if exists vendor_categories_insert on public.vendor_categories;
drop policy if exists vendor_rates_select on public.vendor_rates;
drop policy if exists vendor_rates_insert on public.vendor_rates;
drop policy if exists vendor_rates_update on public.vendor_rates;
drop policy if exists vendor_rate_history_select on public.vendor_rate_history;
create policy vendor_categories_select on public.vendor_categories for select to authenticated using ((select public.fin_any()));
create policy vendor_categories_insert on public.vendor_categories for insert to authenticated with check ((select public.fin_manage()));
create policy vendor_rates_select on public.vendor_rates for select to authenticated using ((select public.fin_any()));
create policy vendor_rates_insert on public.vendor_rates for insert to authenticated with check ((select public.fin_manage()));
create policy vendor_rates_update on public.vendor_rates for update to authenticated
  using ((select public.fin_manage())) with check ((select public.fin_manage()));
create policy vendor_rate_history_select on public.vendor_rate_history for select to authenticated using ((select public.fin_any()));

-- ---------------------------------------------------------------------------
-- Views (security invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
-- estimated_cost = one unit plus the fixed charges, with GST on top. A reference figure, not a transaction.
create or replace view public.vendor_rate_list with (security_invoker = true) as
select r.id, r.vendor_id, v.name as vendor_name, v.city as vendor_city, v.status as vendor_status, v.is_preferred, v.category as vendor_category,
       round((coalesce(v.rating_quality, 0) + coalesce(v.rating_pricing, 0) + coalesce(v.rating_reliability, 0) + coalesce(v.rating_timeliness, 0))::numeric
             / nullif((v.rating_quality is not null)::int + (v.rating_pricing is not null)::int + (v.rating_reliability is not null)::int + (v.rating_timeliness is not null)::int, 0), 1) as vendor_rating,
       r.product_id, p.name as product_name, p.category as product_category,
       r.rate_type, r.unit, r.rate, r.min_order_qty, r.rental_duration, r.weekly_rate, r.monthly_rate, r.security_deposit, r.damage_charges,
       r.setup_charges, r.transport_charges, r.other_charges, r.gst_percent, r.valid_until, r.availability, r.service_location, r.specifications, r.notes,
       r.is_active, r.effective_from, r.updated_at,
       round((r.rate + r.setup_charges + r.transport_charges + r.other_charges) * (1 + r.gst_percent / 100), 2) as estimated_cost,
       (r.valid_until is not null and r.valid_until < (now() at time zone 'Asia/Kolkata')::date) as is_expired
from public.vendor_rates r
join public.vendors v on v.id = r.vendor_id and v.deleted_at is null
join public.products_services p on p.id = r.product_id
where r.deleted_at is null;

create or replace view public.vendor_list with (security_invoker = true) as
select v.*,
       round((coalesce(v.rating_quality, 0) + coalesce(v.rating_pricing, 0) + coalesce(v.rating_reliability, 0) + coalesce(v.rating_timeliness, 0))::numeric
             / nullif((v.rating_quality is not null)::int + (v.rating_pricing is not null)::int + (v.rating_reliability is not null)::int + (v.rating_timeliness is not null)::int, 0), 1) as overall_rating,
       (select count(*)::int from public.vendor_rates r where r.vendor_id = v.id and r.is_active and r.deleted_at is null) as rate_count
from public.vendors v;

-- A catalogue item can be deleted by admin / accounts / management, but only when no vendor rate still points at it
-- (the foreign key refuses otherwise). Lines already on quotations and invoices keep their own text and price.
grant delete on public.products_services to authenticated;
drop policy if exists products_delete on public.products_services;
create policy products_delete on public.products_services for delete to authenticated using ((select public.fin_manage()));

revoke all on public.vendor_rate_list, public.vendor_list from anon;
grant select on public.vendor_rate_list, public.vendor_list to authenticated;
