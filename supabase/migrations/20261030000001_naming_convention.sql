-- Migration: 20261030000001_naming_convention.sql
-- Description: Implement NAFA Events professional document numbering and file naming convention:
--   Quotation: NAFA-QUO-YY-001 (revisions: NAFA-QUO-YY-001-V02)
--   Invoice:   NAFA-INV-YY-001
--   Proposal:  NAFA-PROP-YY-001

-- 1. Update sequence prefixes in document_sequences
update public.document_sequences set prefix = 'NAFA-QUO-26-' where doc_type = 'quotation';
update public.document_sequences set prefix = 'NAFA-INV-26-' where doc_type = 'invoice';
update public.document_sequences set prefix = 'NAFA-PROP-26-' where doc_type = 'proposal';

-- 2. Enhance next_document_number to dynamically evaluate {YY} token if present
create or replace function public.next_document_number(p_type public.document_type) returns text
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

-- 3. Enhance issue_document to retain original number with -V02 suffix for revisions
create or replace function public.issue_document(p_type public.document_type, p_id uuid, p_snapshot jsonb, p_expected_updated_at timestamptz)
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
