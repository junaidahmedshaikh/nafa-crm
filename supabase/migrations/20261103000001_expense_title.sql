-- NAFA Business OS — expense titles
--
-- Every expense gets a short title (what it is: "LED wall 12x8", "Crew lunch") shown in lists and in the Profit & Loss.
-- The old description becomes optional "details". Existing rows keep their text: the title is backfilled from the description.

alter table public.expenses add column title text;
update public.expenses set title = left(btrim(description), 120) where title is null;
alter table public.expenses alter column title set not null;
alter table public.expenses alter column title set default '';

alter table public.expenses alter column description set default '';
alter table public.expenses drop constraint if exists expenses_description_check;

-- A blank title falls back to the details text, so older code paths and imports that only send a description still work.
create function public.expenses_title_default() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if btrim(coalesce(new.title, '')) = '' then new.title := left(btrim(coalesce(new.description, '')), 120); end if;
  new.title := btrim(new.title);
  return new;
end $$;
create trigger expenses_title_default before insert or update on public.expenses for each row execute function public.expenses_title_default();

alter table public.expenses add constraint expenses_title_check check (length(btrim(title)) > 0);

-- expense_list gains `title` (appended last so the views built on it keep working).
create or replace view public.expense_list with (security_invoker = true) as
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
       pay.last_paid_on,
       e.title
from public.expenses e
join public.projects p on p.id = e.project_id
join public.expense_categories c on c.id = e.category_id
left join public.vendors v on v.id = e.vendor_id
left join lateral (
  select sum(x.amount) as paid, max(x.paid_on) as last_paid_on
  from public.expense_payments x where x.expense_id = e.id and x.voided_at is null
) pay on true;
