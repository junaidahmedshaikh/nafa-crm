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
