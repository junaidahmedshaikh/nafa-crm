-- NAFA Business OS — security hardening and performance indexes (additive, safe to re-run)
--
-- 1. rate_limits + rate_limit_hit(): server-side request throttling (login, AI, test e-mails, imports…).
--    Only the service role can call it: the app calls it from server code, never from the browser.
-- 2. Indexes on foreign keys that are joined, filtered or cascaded on (no data is changed).
--
-- Rollback: drop function public.rate_limit_hit(text, integer, integer); drop table public.rate_limits;
--           drop index <name> for any index below.

create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;           -- no policies: nobody but the service role can touch it
revoke all on public.rate_limits from anon, authenticated;

/** Counts one hit in the current fixed window and returns TRUE while the caller is still within `p_max`. */
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  if p_key is null or length(p_key) > 200 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';   -- housekeeping
  end if;
  return n <= p_max;
end $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Foreign-key indexes (join / cascade / set-null performance). Audit-only columns (created_by, deleted_by…) are skipped on purpose.
-- ---------------------------------------------------------------------------
create index if not exists invoices_lead_idx              on public.invoices (lead_id);
create index if not exists invoices_contact_idx           on public.invoices (contact_id);
create index if not exists quotations_contact_idx         on public.quotations (contact_id);
create index if not exists proposals_lead_idx             on public.proposals (lead_id);
create index if not exists proposals_company_idx          on public.proposals (company_id);
create index if not exists proposals_contact_idx          on public.proposals (contact_id);
create index if not exists proposals_quotation_idx        on public.proposals (quotation_id);
create index if not exists quotation_items_catalogue_idx  on public.quotation_items (catalogue_id);
create index if not exists invoice_items_catalogue_idx    on public.invoice_items (catalogue_id);
create index if not exists projects_lead_idx              on public.projects (lead_id);
create index if not exists projects_quotation_idx         on public.projects (quotation_id);
create index if not exists reimbursements_expense_idx     on public.reimbursements (expense_id);
create index if not exists email_recipients_contact_idx   on public.email_recipients (contact_id);
create index if not exists email_replies_recipient_idx    on public.email_replies (recipient_id);
create index if not exists email_replies_contact_idx      on public.email_replies (contact_id);
create index if not exists email_replies_lead_idx         on public.email_replies (lead_id);
create index if not exists email_campaigns_template_idx   on public.email_campaigns (template_id);
create index if not exists bdm_recommendations_followup_idx on public.bdm_recommendations (follow_up_id);
create index if not exists recipient_group_audit_group_idx on public.recipient_group_audit (group_id);
