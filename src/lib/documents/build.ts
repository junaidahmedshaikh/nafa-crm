import { calculateDocument, computeMilestones, invoicePaymentStatus, outstandingBalance, type CalcConfig, type DiscountSpec } from "./calc";
import { parseStoredConfig, type InvoiceFormValues, type InvoiceInput, type ProposalInput, type QuotationFormValues, type QuotationInput } from "./schemas";
import type {
  BankDetails, ClientInfo, CompanyInfo, DocItem, InvoiceRender, MilestoneRow, ProposalRender, ProposalSectionRender, QuotationRender,
} from "./types";
import { amountInWords } from "./words";
import { longDate } from "./templates/base";
import { PROPOSAL_SECTION_TITLES } from "./schemas";

/** Row of public.document_settings. */
export type DocSettings = {
  company_name: string; company_email: string; company_phone: string; company_website: string; company_location: string; company_gstin: string | null;
  signatory_label: string;
  bank_account_holder: string; bank_name: string; bank_account_number: string; bank_ifsc: string; bank_upi_id: string;
  default_agency_fee_enabled: boolean; default_agency_fee_rate: number | string;
  default_quotation_tax_mode: "none" | "cgst_sgst" | "igst"; default_invoice_tax_mode: "none" | "cgst_sgst" | "igst"; default_tax_rate: number | string;
  default_quotation_validity_days: number; default_invoice_due_days: number;
  quotation_terms: string[]; quotation_milestones: { label: string; kind: "percent" | "fixed"; value: number | string; due_text: string }[];
  invoice_payment_terms: string; invoice_notes: string; gst_declaration_enabled: boolean; gst_declaration: string;
};

export const settingsToCompany = (s: DocSettings): CompanyInfo => ({
  name: s.company_name, email: s.company_email, phone: s.company_phone, website: s.company_website, location: s.company_location,
  gstin: s.company_gstin, signatory_label: s.signatory_label,
});
export const settingsToBank = (s: DocSettings): BankDetails => ({
  account_holder: s.bank_account_holder, bank_name: s.bank_name, account_number: s.bank_account_number, ifsc: s.bank_ifsc, upi_id: s.bank_upi_id,
});

type CalcItem = { qty: string | number; rate: string | number; discount?: DiscountSpec };
const toCalc = (items: { qty: string | number; rate: string | number; discount?: DiscountSpec }[]): CalcItem[] =>
  items.map((i) => ({ qty: i.qty, rate: i.rate, discount: i.discount ?? null }));

type ItemLike = {
  description: string; notes?: string | null; hsn_sac?: string | null; qty: string | number; rate: string | number; discount?: DiscountSpec;
};
const toDocItem = (i: ItemLike): DocItem => ({
  description: i.description, notes: i.notes ?? null, hsn_sac: i.hsn_sac ?? null, qty: i.qty, rate: i.rate,
  discount_type: i.discount?.type ?? null, discount_value: i.discount?.value ?? null,
});

type ClientLike = {
  client_name?: string | null; client_company?: string | null; client_address?: string | null; client_email?: string | null; client_phone?: string | null; client_gstin?: string | null;
};
export const clientInfo = (c: ClientLike): ClientInfo & { contact_person?: string } => ({
  client_name: c.client_name ?? "", company: c.client_company ?? "", address: c.client_address ?? "", email: c.client_email ?? "", phone: c.client_phone ?? "",
  gstin: c.client_gstin ?? "", contact_person: c.client_name ?? "",
});

// ---------------------------------------------------------------------------
// Quotation
// ---------------------------------------------------------------------------
type QuotationLike = ClientLike & {
  event_type?: string | null; event_name?: string | null; event_date_text?: string | null; event_location?: string | null; reference_text?: string | null;
  quotation_date: string; valid_until: string | null; terms: string[];
  config: CalcConfig; items: ItemLike[];
  milestones: { label: string; kind: "percent" | "fixed"; value: string | number; due_text?: string | null; due_date?: string | null; status?: "pending" | "paid" }[];
};

export function assembleQuotation(d: QuotationLike, meta: { number: string | null; status: string }, settings: DocSettings): QuotationRender {
  const calc = calculateDocument(toCalc(d.items), d.config);
  const ms = computeMilestones(calc.grand_total, d.milestones.map((m) => ({ kind: m.kind, value: m.value })));
  const milestones: MilestoneRow[] = d.milestones.map((m, i) => ({
    label: m.label, due_text: m.due_date ? longDate(m.due_date) : (m.due_text ?? ""), amount: ms.amounts[i], status: m.status,
  }));
  return {
    kind: "quotation", number: meta.number, status: meta.status, date: d.quotation_date, valid_until: d.valid_until,
    client: clientInfo(d),
    event: { type: d.event_type ?? "", name: d.event_name ?? "", date_text: d.event_date_text ?? "", location: d.event_location ?? "", reference: d.reference_text ?? "" },
    items: d.items.map(toDocItem), config: d.config, calc, milestones, terms: d.terms.filter((t) => t.trim()), company: settingsToCompany(settings),
  };
}

export const quotationFromInput = (i: QuotationInput, meta: { number: string | null; status: string }, s: DocSettings) =>
  assembleQuotation({ ...i, config: i.config as CalcConfig, terms: i.terms, milestones: i.milestones }, meta, s);

type DbItem = {
  description: string; notes: string | null; hsn_sac: string | null; qty: number | string; rate: number | string;
  discount_type: "percent" | "fixed" | null; discount_value: number | string | null; catalogue_id?: string | null;
};
const dbItemToLike = (i: DbItem): ItemLike => ({
  description: i.description, notes: i.notes, hsn_sac: i.hsn_sac, qty: i.qty, rate: i.rate,
  discount: i.discount_type && i.discount_value != null && Number(i.discount_value) > 0 ? { type: i.discount_type, value: i.discount_value } : null,
});

export type QuotationRow = ClientLike & {
  id: string; number: string | null; status: string; lead_id: string | null; company_id: string | null; contact_id: string | null;
  event_type: string; event_name: string; event_date_text: string; event_location: string; reference_text: string;
  quotation_date: string; valid_until: string | null; config: unknown; terms: string[]; notes: string; updated_at: string; grand_total: number | string;
  snapshot: QuotationRender | null; revision_of: string | null;
};
export type MilestoneDbRow = { label: string; kind: "percent" | "fixed"; value: number | string; due_text: string; due_date: string | null; status: "pending" | "paid" };

export function quotationFromRows(q: QuotationRow, items: DbItem[], milestones: MilestoneDbRow[], s: DocSettings): QuotationRender {
  if (q.snapshot && q.status !== "draft") {
    // Issued documents render from their immutable snapshot; only live milestone status is overlaid.
    return { ...q.snapshot, number: q.number, status: q.status, milestones: q.snapshot.milestones.map((m, i) => ({ ...m, status: milestones[i]?.status ?? m.status })) };
  }
  return assembleQuotation(
    { ...q, config: parseStoredConfig(q.config), items: items.map(dbItemToLike), milestones, terms: q.terms ?? [] },
    { number: q.number, status: q.status }, s,
  );
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------
type InvoiceLike = ClientLike & {
  project_name?: string | null; project_location?: string | null; project_date_text?: string | null; quotation_number?: string | null; place_of_supply?: string | null;
  invoice_date: string; due_date: string | null; config: CalcConfig; items: ItemLike[]; payment_terms_text?: string | null; notes_text?: string | null;
};

export function assembleInvoice(
  d: InvoiceLike, meta: { number: string | null; state: "draft" | "issued" | "cancelled" }, received: number, today: string, s: DocSettings,
): InvoiceRender {
  const calc = calculateDocument(toCalc(d.items), d.config);
  const payment_status = invoicePaymentStatus({ state: meta.state, total: calc.grand_total, received, dueDate: d.due_date, today });
  return {
    kind: "invoice", number: meta.number, status: meta.state, payment_status, date: d.invoice_date, due_date: d.due_date,
    client: clientInfo(d),
    project: { name: d.project_name ?? "", location: d.project_location ?? "", date_text: d.project_date_text ?? "", quotation_number: d.quotation_number ?? "", place_of_supply: d.place_of_supply ?? "" },
    items: d.items.map(toDocItem), config: d.config, calc, amount_in_words: amountInWords(calc.grand_total),
    amount_received: received, balance_due: outstandingBalance(calc.grand_total, received),
    payment_terms_text: d.payment_terms_text ?? "", notes_text: d.notes_text ?? "",
    // The no-GST declaration is printed only when no GST is being charged AND the company has enabled it.
    gst_declaration: d.config.tax.mode === "none" && s.gst_declaration_enabled && s.gst_declaration.trim() ? s.gst_declaration : null,
    bank: settingsToBank(s), company: settingsToCompany(s),
  };
}

export const invoiceFromInput = (i: InvoiceInput, meta: { number: string | null; state: "draft" | "issued" | "cancelled" }, received: number, today: string, s: DocSettings) =>
  assembleInvoice({ ...i, config: i.config as CalcConfig }, meta, received, today, s);

export type InvoiceRow = ClientLike & {
  id: string; number: string | null; state: "draft" | "issued" | "cancelled"; quotation_id: string | null; lead_id: string | null; company_id: string | null; contact_id: string | null;
  project_name: string; project_location: string; project_date_text: string; quotation_number: string; place_of_supply: string;
  invoice_date: string; due_date: string | null; config: unknown; payment_terms_text: string; notes_text: string; updated_at: string; grand_total: number | string;
  snapshot: InvoiceRender | null; cancel_reason: string | null;
};

export function invoiceFromRows(inv: InvoiceRow, items: DbItem[], received: number, today: string, s: DocSettings): InvoiceRender {
  if (inv.snapshot && inv.state !== "draft") {
    // Snapshot keeps items, tax, bank details and wording as issued; payment figures are live.
    const calc = inv.snapshot.calc;
    return {
      ...inv.snapshot, number: inv.number, status: inv.state, amount_received: received, balance_due: outstandingBalance(calc.grand_total, received),
      payment_status: invoicePaymentStatus({ state: inv.state, total: calc.grand_total, received, dueDate: inv.due_date, today }),
    };
  }
  return assembleInvoice({ ...inv, config: parseStoredConfig(inv.config), items: items.map(dbItemToLike) }, { number: inv.number, state: inv.state }, received, today, s);
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------
export type ProposalRow = ClientLike & {
  id: string; number: string | null; status: string; title: string; proposal_date: string; quotation_id: string | null; commercial_mode: "none" | "linked" | "manual";
  commercial_note: string; updated_at: string; snapshot: ProposalRender | null; lead_id: string | null; company_id: string | null; contact_id: string | null; revision_of: string | null;
};

export function assembleProposal(
  p: { title: string; proposal_date: string; client: ClientLike; commercial_mode: "none" | "linked" | "manual"; commercial_note: string | null },
  meta: { number: string | null; status: string },
  sections: ProposalSectionRender[],
  linked: QuotationRender | null,
  s: DocSettings,
): ProposalRender {
  let commercial: ProposalRender["commercial"] = null;
  if (p.commercial_mode === "linked" && linked) {
    commercial = {
      items: linked.items.map((it, i) => ({ description: it.description, qty: it.qty, rate: it.rate, amount: linked.calc.lines[i]?.amount ?? 0 })),
      calc: linked.calc, manual_note: p.commercial_note ?? "",
    };
  } else if (p.commercial_mode === "manual") {
    commercial = { items: [], calc: null, manual_note: p.commercial_note ?? "" };
  }
  return { kind: "proposal", number: meta.number, status: meta.status, date: p.proposal_date, title: p.title, client: clientInfo(p.client), sections, commercial, company: settingsToCompany(s) };
}

export const proposalFromInput = (
  i: ProposalInput, meta: { number: string | null; status: string }, linked: QuotationRender | null,
  images: Record<string, { data_uri: string; caption: string }[]>, s: DocSettings,
) =>
  assembleProposal(
    { title: i.title, proposal_date: i.proposal_date, client: i, commercial_mode: i.commercial_mode, commercial_note: i.commercial_note },
    meta,
    i.sections.filter((x) => x.included).map((x) => ({ type: x.type, title: x.title, body: x.body ?? "", images: (x.id && images[x.id]) || [] })),
    linked, s,
  );

/** Sections that are switched on but have no content yet — shown as "missing" in the editor, omitted from the PDF. */
export function missingSections(sections: { type: string; title: string; body: string; included: boolean }[], imageCount: (i: number) => number = () => 0): string[] {
  return sections
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.included && !["commercial", "acceptance", "prepared_for"].includes(s.type) && !s.body.trim() && imageCount(i) === 0)
    .map(({ s }) => s.title || PROPOSAL_SECTION_TITLES[s.type] || "Untitled section");
}

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
export function defaultConfigValues(s: DocSettings, kind: "quotation" | "invoice"): QuotationFormValues["config"] {
  return {
    discount: { type: "", value: "" },
    agency_fee: { enabled: kind === "quotation" ? s.default_agency_fee_enabled : false, rate: String(s.default_agency_fee_rate), base: "after_discount" },
    tax: { mode: kind === "quotation" ? s.default_quotation_tax_mode : s.default_invoice_tax_mode, rate: String(s.default_tax_rate) },
    other_charges: [],
    round_to_rupee: false,
  };
}

export function configToFormValues(c: CalcConfig): QuotationFormValues["config"] {
  return {
    discount: c.discount ? { type: c.discount.type, value: String(c.discount.value) } : { type: "", value: "" },
    agency_fee: { enabled: c.agency_fee.enabled, rate: String(c.agency_fee.rate), base: c.agency_fee.base },
    tax: { mode: c.tax.mode, rate: String(c.tax.rate) },
    other_charges: c.other_charges.map((o) => ({ label: o.label, amount: String(o.amount), taxable: o.taxable })),
    round_to_rupee: c.round_to_rupee,
  };
}

export const itemToFormValues = (i: DbItem): QuotationFormValues["items"][number] => ({
  catalogue_id: i.catalogue_id ?? "", description: i.description, notes: i.notes ?? "", hsn_sac: i.hsn_sac ?? "", qty: String(Number(i.qty)), rate: String(Number(i.rate)),
  discount: i.discount_type && i.discount_value != null ? { type: i.discount_type, value: String(Number(i.discount_value)) } : { type: "", value: "" },
});

export type { InvoiceFormValues };
