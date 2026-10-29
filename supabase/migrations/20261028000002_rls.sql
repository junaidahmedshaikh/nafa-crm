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
