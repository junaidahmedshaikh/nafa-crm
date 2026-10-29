import { calculateDocument, DEFAULT_CALC_CONFIG, type CalcConfig } from "./calc";
import { amountInWords } from "./words";
import type { BankDetails, CompanyInfo, DocItem, InvoiceRender, QuotationRender } from "./types";

/** Sample/QA data. Used by scripts/render-samples.ts and tests — never by the running application. */
export const SAMPLE_COMPANY: CompanyInfo = {
  name: "NAFA Events & Activations",
  email: "contact@nafaevents.in",
  phone: "+91 816 951 2822",
  website: "https://www.nafaevents.in/",
  location: "Mumbai, Maharashtra, India  |  Serving Pan India",
  gstin: null,
  signatory_label: "For NAFA Events & Activations",
};

export const SAMPLE_BANK: BankDetails = {
  account_holder: "Junaid Ahmed Shaikh",
  bank_name: "Federal Bank",
  account_number: "55550106323601",
  ifsc: "FDRL0001505",
  upi_id: "junaid.ahmedshaikh@federal",
};

export const DEFAULT_TERMS = [
  "This quotation is valid until the date stated above.",
  "Cancellation & rescheduling: Cancellations or rescheduling must be communicated in writing; charges may apply for work completed and expenses incurred.",
  "Changes to scope, guest count or deliverables after confirmation may revise the quoted amount.",
  "Taxes are charged as applicable at the prevailing rate.",
];

const refConfig: CalcConfig = {
  ...DEFAULT_CALC_CONFIG,
  agency_fee: { enabled: true, rate: 15, base: "after_discount" },
  tax: { mode: "cgst_sgst", rate: 18 },
};

/** The values printed in the supplied quotation template (blank client, no items, 0.00 totals). */
export function referenceQuotation(): QuotationRender {
  return {
    kind: "quotation",
    number: "NAFA-Q-037",
    status: "draft",
    date: "2026-10-28",
    valid_until: "2026-11-03",
    client: { client_name: "", company: "", phone: "", email: "", address: "", gstin: "" },
    event: { type: "", name: "", date_text: "02/11/2026", location: "", reference: "" },
    items: [],
    config: refConfig,
    calc: calculateDocument([], refConfig),
    milestones: [
      { label: "Advance — 50% on confirmation", due_text: "On confirmation", amount: 0 },
      { label: "Second instalment — 30%", due_text: "01 November 2026", amount: 0 },
      { label: "Balance — 20%", due_text: "02 November 2026", amount: 0 },
    ],
    terms: DEFAULT_TERMS,
    company: SAMPLE_COMPANY,
  };
}

export const SAMPLE_ITEMS: DocItem[] = [
  { description: "Stage design, fabrication and installation — main stage 40 ft × 20 ft with LED backdrop", qty: 1, rate: 285000, notes: "Includes dismantling and transport" },
  { description: "Event staffing — hostesses and ushers (8 hours)", qty: "12", rate: 2200 },
  { description: "Sound, lights and AV production", qty: 1, rate: "175000.50" },
  { description: "Entertainment — live band (2 sets)", qty: 1, rate: 90000, discount_type: "percent", discount_value: 10 },
  { description: "Venue decor — floral and fabric styling", qty: "2.5", rate: 44000 },
];

export function sampleQuotation(extra: Partial<QuotationRender> = {}): QuotationRender {
  const config: CalcConfig = { ...refConfig };
  const calc = calculateDocument(
    SAMPLE_ITEMS.map((i) => ({ qty: i.qty, rate: i.rate, discount: i.discount_type ? { type: i.discount_type, value: i.discount_value ?? 0 } : null })),
    config,
  );
  const q = calc.grand_total;
  return {
    ...referenceQuotation(),
    client: {
      client_name: "Asha Mehta", contact_person: "Asha Mehta", company: "Aurora Motors Pvt Ltd", phone: "+91 90000 00001",
      email: "asha@aurora-motors.example", address: "4th Floor, Business Bay, Andheri East, Mumbai 400093", gstin: "27AABCA1234F1Z5",
    },
    event: { type: "Corporate Event", name: "Annual Dealer Meet 2027", date_text: "15/02/2027", location: "JW Marriott, Juhu, Mumbai", reference: "Lead L-0001" },
    items: SAMPLE_ITEMS,
    config,
    calc,
    milestones: [
      { label: "Advance — 50% on confirmation", due_text: "On confirmation", amount: Math.round(q * 50) / 100 },
      { label: "Second instalment — 30%", due_text: "01 February 2027", amount: Math.round(q * 30) / 100 },
      { label: "Balance — 20%", due_text: "15 February 2027", amount: Math.round((q - Math.round(q * 50) / 100 - Math.round(q * 30) / 100) * 100) / 100 },
    ],
    ...extra,
  };
}

/** The values printed in the supplied invoice template (placeholders in square brackets). */
export function referenceInvoice(): InvoiceRender {
  const config: CalcConfig = { ...DEFAULT_CALC_CONFIG };
  return {
    kind: "invoice",
    number: "[Invoice Number]",
    status: "issued",
    payment_status: "issued",
    date: "",
    due_date: "",
    client: { client_name: "", company: "[Client / Company Name]", address: "[Billing Address]", phone: "[Phone]", email: "[Email]", gstin: "[If applicable]", contact_person: "[Contact Person]" },
    project: { name: "[Event / Project Name]", location: "[Event Location]", date_text: "[Event Date or Project Period]", quotation_number: "[Quotation No.]", place_of_supply: "[If applicable]" },
    items: [{ description: "[Service / Deliverable]", hsn_sac: "[If applicable]", qty: 1, rate: 0 }],
    config,
    calc: calculateDocument([{ qty: 1, rate: 0 }], config),
    amount_in_words: "[Amount in words]",
    amount_received: 0,
    balance_due: 0,
    payment_terms_text: "Due within 7 days of invoice date.",
    notes_text:
      "Payment is due within 7 days from the invoice date, unless otherwise agreed in writing. Kindly mention the invoice number when making payment and share the payment confirmation once completed. Any applicable bank transfer charges shall be borne by the payer.",
    gst_declaration: "GST has not been charged on this invoice.",
    bank: SAMPLE_BANK,
    company: SAMPLE_COMPANY,
  };
}

export function sampleInvoice(extra: Partial<InvoiceRender> = {}): InvoiceRender {
  const config: CalcConfig = { ...DEFAULT_CALC_CONFIG, agency_fee: { enabled: true, rate: 15, base: "after_discount" }, tax: { mode: "cgst_sgst", rate: 18 } };
  const calc = calculateDocument(
    SAMPLE_ITEMS.map((i) => ({ qty: i.qty, rate: i.rate, discount: i.discount_type ? { type: i.discount_type, value: i.discount_value ?? 0 } : null })),
    config,
  );
  return {
    ...referenceInvoice(),
    number: "NAFA-INV-014",
    date: "2027-02-16",
    due_date: "2027-02-23",
    payment_status: "partially_paid",
    client: { client_name: "Asha Mehta", contact_person: "Asha Mehta", company: "Aurora Motors Pvt Ltd", phone: "+91 90000 00001", email: "asha@aurora-motors.example", address: "4th Floor, Business Bay, Andheri East, Mumbai 400093", gstin: "27AABCA1234F1Z5" },
    project: { name: "Annual Dealer Meet 2027", location: "JW Marriott, Juhu, Mumbai", date_text: "15/02/2027", quotation_number: "NAFA-Q-037", place_of_supply: "Maharashtra (27)" },
    items: SAMPLE_ITEMS.map((i, n) => ({ ...i, hsn_sac: n === 1 ? "998596" : "998599" })),
    config,
    calc,
    amount_in_words: amountInWords(calc.grand_total),
    amount_received: 400000,
    balance_due: Math.round((calc.grand_total - 400000) * 100) / 100,
    gst_declaration: null,
    ...extra,
  };
}
