import { configToFormValues, defaultConfigValues, itemToFormValues, type DocSettings, type InvoiceRow, type QuotationRow } from "./build";
import { parseStoredConfig, type InvoiceFormValues, type ProposalFormValues, type QuotationFormValues, PROPOSAL_SECTION_TYPES } from "./schemas";
import type { LeadOption } from "./repo";
import { dmy } from "./templates/base";

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const leadClient = (lead?: LeadOption) => ({
  lead_id: lead?.id ?? "", company_id: lead?.company_id ?? "", contact_id: lead?.contact_id ?? "",
  client_name: lead?.contact_name ?? "", client_company: lead?.company_name ?? "", client_address: "", client_email: lead?.contact_email ?? "",
  client_phone: lead?.contact_phone ?? "", client_gstin: "",
});

export function newQuotationValues(s: DocSettings, today: string, lead?: LeadOption): QuotationFormValues {
  return {
    ...leadClient(lead),
    event_type: "", event_name: lead ? lead.event_name || lead.title : "", event_date_text: lead?.event_date ? dmy(lead.event_date) : "",
    event_location: lead ? [lead.venue, lead.city].filter(Boolean).join(", ") : "", reference_text: lead ? `Lead L-${String(lead.lead_number).padStart(4, "0")}` : "",
    quotation_date: today, valid_until: addDays(today, s.default_quotation_validity_days),
    config: defaultConfigValues(s, "quotation"),
    items: [],
    milestones: (s.quotation_milestones ?? []).map((m) => ({ label: m.label, kind: m.kind, value: String(m.value), due_text: m.due_text ?? "", due_date: "", status: "pending" as const })),
    terms: [...(s.quotation_terms ?? [])],
    notes: "",
  };
}

export function quotationValuesFromRows(
  q: QuotationRow, items: Parameters<typeof itemToFormValues>[0][],
  milestones: { label: string; kind: "percent" | "fixed"; value: number | string; due_text: string; due_date: string | null; status: "pending" | "paid" }[],
): QuotationFormValues {
  return {
    lead_id: q.lead_id ?? "", company_id: q.company_id ?? "", contact_id: q.contact_id ?? "",
    client_name: q.client_name ?? "", client_company: q.client_company ?? "", client_address: q.client_address ?? "", client_email: q.client_email ?? "",
    client_phone: q.client_phone ?? "", client_gstin: q.client_gstin ?? "",
    event_type: q.event_type, event_name: q.event_name, event_date_text: q.event_date_text, event_location: q.event_location, reference_text: q.reference_text,
    quotation_date: q.quotation_date, valid_until: q.valid_until ?? "",
    config: configToFormValues(parseStoredConfig(q.config)),
    items: items.map(itemToFormValues),
    milestones: milestones.map((m) => ({ label: m.label, kind: m.kind, value: String(Number(m.value)), due_text: m.due_text ?? "", due_date: m.due_date ?? "", status: m.status })),
    terms: q.terms ?? [], notes: q.notes ?? "",
  };
}

export function newInvoiceValues(s: DocSettings, today: string, lead?: LeadOption): InvoiceFormValues {
  return {
    ...leadClient(lead),
    quotation_id: "", quotation_number: "",
    project_name: lead ? lead.event_name || lead.title : "", project_location: lead ? [lead.venue, lead.city].filter(Boolean).join(", ") : "",
    project_date_text: lead?.event_date ? dmy(lead.event_date) : "", place_of_supply: "",
    invoice_date: today, due_date: addDays(today, s.default_invoice_due_days),
    config: defaultConfigValues(s, "invoice"), items: [], payment_terms_text: s.invoice_payment_terms, notes_text: s.invoice_notes,
  };
}

export function invoiceValuesFromRows(i: InvoiceRow, items: Parameters<typeof itemToFormValues>[0][]): InvoiceFormValues {
  return {
    lead_id: i.lead_id ?? "", company_id: i.company_id ?? "", contact_id: i.contact_id ?? "", quotation_id: i.quotation_id ?? "", quotation_number: i.quotation_number ?? "",
    client_name: i.client_name ?? "", client_company: i.client_company ?? "", client_address: i.client_address ?? "", client_email: i.client_email ?? "",
    client_phone: i.client_phone ?? "", client_gstin: i.client_gstin ?? "",
    project_name: i.project_name, project_location: i.project_location, project_date_text: i.project_date_text, place_of_supply: i.place_of_supply,
    invoice_date: i.invoice_date, due_date: i.due_date ?? "",
    config: configToFormValues(parseStoredConfig(i.config)), items: items.map(itemToFormValues),
    payment_terms_text: i.payment_terms_text ?? "", notes_text: i.notes_text ?? "",
  };
}

/** The 15 standard proposal sections, empty and ready to fill. Nothing is pre-written on the user's behalf. */
export function newProposalValues(today: string, lead?: LeadOption): ProposalFormValues {
  const standard = PROPOSAL_SECTION_TYPES.filter(([t]) => t !== "custom");
  return {
    ...leadClient(lead),
    quotation_id: "", title: lead?.event_name || lead?.title || "", proposal_date: today, commercial_mode: "none", commercial_note: "",
    sections: standard.map(([type, title]) => ({ id: "", type, title, body: "", included: true })),
  };
}
