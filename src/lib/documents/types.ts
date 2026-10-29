import type { CalcConfig, CalcResult, InvoicePaymentStatus } from "./calc";

/** Business identity printed on documents. Comes from document_settings (never hard-coded in templates). */
export type CompanyInfo = {
  name: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  gstin: string | null;
  signatory_label: string; // "For NAFA Events & Activations"
};

export type BankDetails = {
  account_holder: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
  upi_id: string;
};

export type ClientInfo = {
  client_name: string;
  company: string;
  address: string;
  email: string;
  phone: string;
  gstin: string;
};

export type DocItem = {
  description: string;
  notes?: string | null;
  hsn_sac?: string | null;
  qty: number | string;
  rate: number | string;
  discount_type?: "percent" | "fixed" | null;
  discount_value?: number | string | null;
};

export type MilestoneRow = { label: string; due_text: string; amount: number; status?: "pending" | "paid" };

export type QuotationRender = {
  kind: "quotation";
  number: string | null; // null => draft
  status: string;
  date: string; // YYYY-MM-DD
  valid_until: string | null;
  client: ClientInfo & { contact_person?: string };
  event: { type: string; name: string; date_text: string; location: string; reference: string };
  items: DocItem[];
  config: CalcConfig;
  calc: CalcResult;
  milestones: MilestoneRow[];
  terms: string[];
  company: CompanyInfo;
};

export type InvoiceRender = {
  kind: "invoice";
  number: string | null;
  status: string;
  payment_status: InvoicePaymentStatus;
  date: string;
  due_date: string | null;
  client: ClientInfo & { contact_person?: string };
  project: { name: string; location: string; date_text: string; quotation_number: string; place_of_supply: string };
  items: DocItem[];
  config: CalcConfig;
  calc: CalcResult;
  amount_in_words: string;
  amount_received: number;
  balance_due: number;
  payment_terms_text: string;
  notes_text: string;
  /** Printed only when the invoice charges no GST and the company has enabled the declaration. */
  gst_declaration: string | null;
  bank: BankDetails;
  company: CompanyInfo;
};

export type ProposalSectionRender = {
  type: string;
  title: string;
  body: string;
  images: { data_uri: string; caption: string }[];
};

export type ProposalRender = {
  kind: "proposal";
  number: string | null;
  status: string;
  date: string;
  title: string;
  client: ClientInfo & { contact_person?: string };
  sections: ProposalSectionRender[];
  /** Commercial summary, linked from a quotation or entered manually. */
  commercial: null | {
    items: { description: string; qty: number | string; rate: number | string; amount: number }[];
    calc: CalcResult | null;
    manual_note: string;
  };
  company: CompanyInfo;
};

export type RenderOptions = {
  /** QA only: print the placeholder rows/values of the supplied template so geometry can be compared. */
  referenceLayout?: boolean;
  /** Show "Page x of y" (set automatically for multi-page documents). */
  pageNumbers?: boolean;
  /** Draft watermark-free marker; templates print "DRAFT" in place of the number when number is null. */
  forPreview?: boolean;
};
