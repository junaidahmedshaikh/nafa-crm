-- NAFA Business OS — invoice terms & conditions
--
-- Every invoice prints a common block of terms plus the block for its event type (wedding, corporate, BTL,
-- exhibition, manpower). The wording lives in document_settings so an admin can edit it; NULL means "use the
-- built-in defaults" (src/lib/documents/invoice-terms.ts). Terms are frozen into the snapshot when an invoice
-- is issued, so editing them later never changes an issued invoice.

alter table public.document_settings
  add column invoice_terms_common  jsonb check (invoice_terms_common is null or jsonb_typeof(invoice_terms_common) = 'array'),
  add column invoice_terms_by_type jsonb check (invoice_terms_by_type is null or jsonb_typeof(invoice_terms_by_type) = 'object'),
  add column udyam_number          text not null default '' check (length(udyam_number) <= 40);

alter table public.invoices
  add column terms_type text not null default '' check (terms_type in ('', 'wedding', 'corporate', 'btl', 'exhibition', 'manpower'));

-- save_invoice now also stores terms_type.
create or replace function public.save_invoice(p jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.invoices (quotation_id, lead_id, company_id, contact_id, client_name, client_company, client_address, client_email, client_phone,
      client_gstin, project_name, project_location, project_date_text, quotation_number, place_of_supply, invoice_date, due_date, config, subtotal,
      discount_total, agency_fee, taxable_value, cgst, sgst, igst, other_charges, round_off, grand_total, payment_terms_text, notes_text, terms_type)
    select r.quotation_id, r.lead_id, r.company_id, r.contact_id, coalesce(r.client_name, ''), coalesce(r.client_company, ''), coalesce(r.client_address, ''),
      coalesce(r.client_email, ''), coalesce(r.client_phone, ''), coalesce(r.client_gstin, ''), coalesce(r.project_name, ''), coalesce(r.project_location, ''),
      coalesce(r.project_date_text, ''), coalesce(r.quotation_number, ''), coalesce(r.place_of_supply, ''),
      coalesce(r.invoice_date, (now() at time zone 'Asia/Kolkata')::date), r.due_date, coalesce(r.config, '{}'::jsonb), coalesce(r.subtotal, 0),
      coalesce(r.discount_total, 0), coalesce(r.agency_fee, 0), coalesce(r.taxable_value, 0), coalesce(r.cgst, 0), coalesce(r.sgst, 0), coalesce(r.igst, 0),
      coalesce(r.other_charges, 0), coalesce(r.round_off, 0), coalesce(r.grand_total, 0), coalesce(r.payment_terms_text, ''), coalesce(r.notes_text, ''), coalesce(r.terms_type, '')
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
      payment_terms_text = coalesce(r.payment_terms_text, ''), notes_text = coalesce(r.notes_text, ''), terms_type = coalesce(r.terms_type, ''), updated_at = now()
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
