-- NAFA Business OS — performance: one aggregate function and a few missing foreign-key indexes.
--
-- Additive and idempotent. No table, column or row is changed or removed. The app works without this migration
-- (it falls back to the previous queries); with it the dashboard and Payments page stop downloading every payment row.

-- Total of all non-voided payments. Security invoker: the caller's RLS applies, exactly as when the rows were read directly.
create or replace function public.payments_received_total()
returns numeric
language sql stable set search_path = ''
as $$
  select coalesce(sum(p.amount), 0) from public.invoice_payments p where p.voided_at is null;
$$;
revoke all on function public.payments_received_total() from public, anon;
grant execute on function public.payments_received_total() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.payments_received_total() to service_role;
  end if;
end $$;

-- Foreign keys that are joined, filtered or cascaded on but had no index.
-- (Audit-only columns such as created_by / deleted_by are left unindexed on purpose: they are never searched.)
create index if not exists quotations_revision_of_idx          on public.quotations (revision_of) where revision_of is not null;
create index if not exists proposals_revision_of_idx           on public.proposals (revision_of) where revision_of is not null;
create index if not exists proposal_attachments_section_idx    on public.proposal_attachments (section_id);
create index if not exists reimbursements_category_idx         on public.reimbursements (category_id);
create index if not exists bdm_recommendations_quotation_idx   on public.bdm_recommendations (quotation_id) where quotation_id is not null;
create index if not exists bdm_recommendations_proposal_idx    on public.bdm_recommendations (proposal_id) where proposal_id is not null;
-- Voided payments are excluded from every total: let the planner skip them.
create index if not exists invoice_payments_live_idx           on public.invoice_payments (invoice_id) where voided_at is null;
