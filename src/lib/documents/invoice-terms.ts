/**
 * Invoice terms & conditions: a common block printed on every invoice, plus a block for the invoice's event type.
 * These are the defaults; an admin can edit them in Settings → Documents (stored in document_settings). Whatever
 * applies when an invoice is issued is frozen into its snapshot, so later edits never change an issued invoice.
 *
 * Wording is a template for NAFA's CA / lawyer to review (GST, TDS, MSME, jurisdiction and damages clauses).
 * `{udyam}` is replaced with the Udyam number from settings; a clause that mentions it is left out until one is set.
 */

export const TERMS_TYPES = ["wedding", "corporate", "btl", "exhibition", "manpower"] as const;
export type TermsType = (typeof TERMS_TYPES)[number];

export const TERMS_TYPE_LABELS: Record<TermsType, string> = {
  wedding: "Weddings & social celebrations",
  corporate: "Corporate events",
  btl: "BTL activations & brand campaigns",
  exhibition: "Exhibition stalls & fabrication",
  manpower: "Manpower & staffing",
};

export const TERMS_TYPE_HINTS: Record<TermsType, string> = {
  wedding: "Weddings, Nikah, Walima, engagements, birthdays, baby showers, anniversaries",
  corporate: "Office celebrations, annual days, conferences, family days, launches",
  btl: "Mall, society and retail activations, roadshows, sampling, merchant acquisition",
  exhibition: "Exhibition stalls and fabrication",
  manpower: "Manpower and staffing",
};

export const isTermsType = (v: unknown): v is TermsType => typeof v === "string" && (TERMS_TYPES as readonly string[]).includes(v);

export const DEFAULT_COMMON_TERMS: string[] = [
  "Payment is due as per the due date mentioned on this invoice.",
  "Payments are to be made only to NAFA Events & Activations' bank account or UPI ID mentioned on this invoice. NAFA is not responsible for payments made to any other account or person.",
  "GST is charged as applicable under current law.",
  "Please mention the invoice number as the payment reference.",
  "Any discrepancy in this invoice must be reported within 7 days of receipt. After this period, the invoice is considered accepted.",
  "Cheques are subject to realisation. Bounced cheques attract bank charges and may lead to legal action.",
  "Advances already received are adjusted against this invoice as shown.",
  "Subject to Mumbai jurisdiction.",
];

const TDS = "TDS: If TDS is deducted, please share the TDS certificate within the statutory timeline so it can be reconciled against this invoice.";
const MSME = "MSME status: NAFA Events & Activations is a registered MSME (Udyam No. {udyam}). Payment is expected within 45 days of invoice as per the MSMED Act, 2006. Delayed payments attract interest as provided under the Act.";

export const DEFAULT_TERMS_BY_TYPE: Record<TermsType, string[]> = {
  wedding: [
    "Payment schedule: 50% at booking, 40% seven days before the event, 10% on the event day before setup completion.",
    "Event day balance: The final balance must be cleared on the event day. NAFA may delay or withhold services if payment due before the event has not been received.",
    "Additional services: Services added on the event day (extra décor, overtime, additional staff or equipment) are billed separately and payable within 3 days of the event.",
    "Venue charges: Decorator entry fees, venue overtime or other charges levied by the venue are payable by the client directly, or billed at actuals with receipts if paid by NAFA.",
    "Damages: Damage to or loss of NAFA's props, furniture or equipment caused by guests is billed at replacement or repair cost.",
    "Booking advance: The booking advance is non-refundable except as stated in the signed quotation's cancellation terms.",
  ],
  corporate: [
    "Payment schedule: As per the purchase order. Default terms: 50% advance on PO, balance within 15 days of invoice.",
    "Purchase order: Please quote the PO number when making payment. Invoices are raised as per the PO and approved scope.",
    "Additional work: Any work beyond the approved scope, requested by the client team on-site or by email, is billed separately as per agreed rates.",
    "Reimbursable expenses: Venue charges, permissions, artist fees or other expenses paid on the client's behalf are billed at actuals with supporting receipts.",
    TDS,
    MSME,
  ],
  btl: [
    "Payment schedule: 50% advance before deployment, balance within 15 days of the final invoice.",
    "Billing basis: Manpower is billed per person per day as per attendance records. Fabrication, branding and logistics are billed as per the approved BOQ.",
    "Permissions: Fees charged by malls, societies, stores or authorities are billed at actuals with receipts.",
    "Overtime and additional days: Manpower overtime beyond the agreed shift, and additional activation days, are billed at the agreed rates.",
    "Cancelled days: Activation days cancelled by the client within 48 hours are billed for manpower and logistics already committed.",
    "Reports: Daily reports and the campaign closure report form part of this invoice's supporting documents. Attendance records are available on request.",
    TDS,
    MSME,
  ],
  exhibition: [
    "Payment schedule: 50% on design approval, 40% before installation, 10% within 7 days after the exhibition.",
    "Design approval: Fabrication starts only after written design approval and receipt of the advance.",
    "Design changes: Changes after approval or after fabrication has started are billed at actual cost.",
    "Organiser charges: Organiser fees, power connection, permits and other charges levied by the exhibition organiser are billed at actuals with receipts, unless included in the quotation.",
    "Ownership: Rented structures, furniture and equipment remain NAFA's property and are dismantled after the exhibition. Items fabricated exclusively for the client are handed over only after full payment.",
    "Storage: Storage of reusable stall material beyond 7 days after the exhibition is billed as per agreed rates.",
  ],
  manpower: [
    "Payment schedule: 50% advance before deployment, balance within 15 days of invoice.",
    "Billing basis: Billed per person per day as per attendance records shared with the client.",
    "Minimum booking: Minimum billing of one full day per person, including when the client releases staff early.",
    "Overtime: Hours beyond the agreed shift are billed at the agreed overtime rate.",
    "Allowances: Travel, food or accommodation for outstation or late-night deployment are billed as per the quotation.",
    "Staff conduct: Any issue with staff must be reported on the same day so it can be resolved. Billing disputes raised later will be reviewed against attendance records.",
  ],
};

export type TermsSettings = {
  invoice_terms_common?: string[] | null;
  invoice_terms_by_type?: Partial<Record<TermsType, string[]>> | null;
  udyam_number?: string | null;
};

export type InvoiceTerms = { common: string[]; type_title: string; specific: string[] };

const clean = (list: unknown): string[] => (Array.isArray(list) ? list.map((t) => String(t).trim()).filter(Boolean) : []);

/** The terms an invoice of this type carries: common block + the event type's block, placeholders filled in. */
export function resolveInvoiceTerms(s: TermsSettings, type: string | null | undefined): InvoiceTerms {
  const udyam = (s.udyam_number ?? "").trim();
  const fill = (list: string[]) => list.filter((t) => udyam || !t.includes("{udyam}")).map((t) => t.replaceAll("{udyam}", udyam));
  const common = s.invoice_terms_common ? clean(s.invoice_terms_common) : DEFAULT_COMMON_TERMS;
  if (!isTermsType(type)) return { common: fill(common), type_title: "", specific: [] };
  const custom = s.invoice_terms_by_type?.[type];
  return { common: fill(common), type_title: TERMS_TYPE_LABELS[type], specific: fill(custom ? clean(custom) : DEFAULT_TERMS_BY_TYPE[type]) };
}

/** The stored (or default) clauses exactly as written, `{udyam}` token included, for the settings editor. */
export function editableTerms(s: TermsSettings): { common: string[]; byType: Record<TermsType, string[]> } {
  const byType = Object.fromEntries(TERMS_TYPES.map((t) => [t, s.invoice_terms_by_type?.[t] ? clean(s.invoice_terms_by_type[t]) : DEFAULT_TERMS_BY_TYPE[t]])) as Record<TermsType, string[]>;
  return { common: s.invoice_terms_common ? clean(s.invoice_terms_common) : DEFAULT_COMMON_TERMS, byType };
}

/** One clause per line in the settings editor. */
export const termsToLines = (list: string[]) => list.join("\n");
export const linesToTerms = (text: string | null | undefined): string[] => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
