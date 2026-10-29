import { z } from "zod";
import { optDate, optEmail, optText, optUuid, reqText } from "@/lib/validation/common";
import { DEFAULT_CALC_CONFIG, type CalcConfig } from "./calc";

/** Required calendar date "YYYY-MM-DD". */
const reqDate = (label: string) =>
  z.string().trim().min(1, `${label} is required`).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Enter a valid date");

/** Positive decimal quantity (up to 3 dp). */
const qty = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const c = v.replace(/,/g, "");
    if (!/^\d{1,9}(\.\d{1,3})?$/.test(c) || Number(c) <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter a quantity greater than 0 (up to 3 decimals)" });
      return z.NEVER;
    }
    return c;
  });

/** Non-negative INR amount (up to 2 dp). Kept as a string so no float ever touches it. */
const amount = (label = "amount") =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = (v || "0").replace(/[,\s₹]/g, "");
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${label} (up to 2 decimals)` });
        return z.NEVER;
      }
      return c;
    });

const percent = (label = "percentage") =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const c = (v || "0").replace(/,/g, "");
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(c) || Number(c) > 100) {
        ctx.addIssue({ code: "custom", message: `Enter a ${label} between 0 and 100` });
        return z.NEVER;
      }
      return c;
    });

const discountSpec = z
  .object({ type: z.enum(["", "percent", "fixed"]), value: z.string().trim() })
  .transform((d, ctx) => {
    if (!d.type || !d.value || Number(d.value) === 0) return null;
    if (d.type === "percent") {
      const p = percent("discount").safeParse(d.value);
      if (!p.success) {
        ctx.addIssue({ code: "custom", message: p.error.issues[0].message, path: ["value"] });
        return z.NEVER;
      }
      return { type: "percent" as const, value: p.data };
    }
    const a = amount("discount").safeParse(d.value);
    if (!a.success) {
      ctx.addIssue({ code: "custom", message: a.error.issues[0].message, path: ["value"] });
      return z.NEVER;
    }
    return { type: "fixed" as const, value: a.data };
  });

export const itemSchema = z.object({
  catalogue_id: optUuid,
  description: reqText("Description", 1000),
  notes: optText(1000),
  hsn_sac: optText(20),
  qty,
  rate: amount("rate"),
  discount: discountSpec,
});

export const configSchema = z.object({
  discount: discountSpec,
  agency_fee: z.object({ enabled: z.boolean(), rate: percent("fee percentage"), base: z.enum(["after_discount", "subtotal"]) }),
  tax: z.object({ mode: z.enum(["none", "cgst_sgst", "igst"]), rate: percent("tax rate") }),
  other_charges: z.array(z.object({ label: reqText("Charge label", 100), amount: amount("charge"), taxable: z.boolean() })).max(10),
  round_to_rupee: z.boolean(),
});

const clientFields = {
  lead_id: optUuid,
  company_id: optUuid,
  contact_id: optUuid,
  client_name: optText(200),
  client_company: optText(200),
  client_address: optText(500),
  client_email: optEmail,
  client_phone: optText(40),
  client_gstin: optText(20),
};

const milestoneSchema = z.object({
  label: reqText("Milestone", 200),
  kind: z.enum(["percent", "fixed"]),
  value: z.string().trim().transform((v, ctx) => {
    const c = (v || "").replace(/[,\s₹]/g, "");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid value" });
      return z.NEVER;
    }
    return c;
  }),
  due_text: optText(100),
  due_date: optDate,
  status: z.enum(["pending", "paid"]).default("pending"),
});

export const quotationInputSchema = z.object({
  ...clientFields,
  event_type: optText(100),
  event_name: optText(200),
  event_date_text: optText(100),
  event_location: optText(200),
  reference_text: optText(200),
  quotation_date: reqDate("Quotation date"),
  valid_until: optDate,
  config: configSchema,
  items: z.array(itemSchema).max(200),
  milestones: z.array(milestoneSchema).max(12),
  terms: z.array(z.string().trim().max(1000)).max(30),
  notes: optText(2000),
});
export type QuotationInput = z.output<typeof quotationInputSchema>;
export type QuotationFormValues = z.input<typeof quotationInputSchema>;

export const invoiceInputSchema = z.object({
  ...clientFields,
  quotation_id: optUuid,
  quotation_number: optText(50),
  project_name: optText(200),
  project_location: optText(200),
  project_date_text: optText(100),
  place_of_supply: optText(100),
  invoice_date: reqDate("Invoice date"),
  due_date: optDate,
  config: configSchema,
  items: z.array(itemSchema).max(200),
  payment_terms_text: optText(500),
  notes_text: optText(3000),
});
export type InvoiceInput = z.output<typeof invoiceInputSchema>;
export type InvoiceFormValues = z.input<typeof invoiceInputSchema>;

export const PROPOSAL_SECTION_TYPES = [
  ["cover", "Cover / title"],
  ["prepared_for", "Prepared for / client details"],
  ["overview", "Project overview"],
  ["requirements", "Client requirements and objectives"],
  ["concept", "Proposed concept and strategy"],
  ["scope", "Scope of work"],
  ["deliverables", "Deliverables and exclusions"],
  ["timeline", "Execution plan and timeline"],
  ["manpower", "Manpower and responsibilities"],
  ["production", "Production, fabrication and logistics"],
  ["commercial", "Commercial proposal and cost breakdown"],
  ["payment_terms", "Payment terms"],
  ["assumptions", "Assumptions and dependencies"],
  ["terms", "Terms and conditions"],
  ["acceptance", "Approval and acceptance"],
  ["custom", "Custom section"],
] as const;
export const PROPOSAL_SECTION_TITLES = Object.fromEntries(PROPOSAL_SECTION_TYPES) as Record<string, string>;

export const proposalInputSchema = z.object({
  ...clientFields,
  quotation_id: optUuid,
  title: reqText("Proposal title", 200),
  proposal_date: reqDate("Proposal date"),
  commercial_mode: z.enum(["none", "linked", "manual"]),
  commercial_note: optText(4000),
  sections: z
    .array(
      z.object({
        id: optUuid,
        type: z.string().trim().min(1).max(40),
        title: reqText("Section title", 200),
        body: z.string().max(20000).default(""),
        included: z.boolean(),
      }),
    )
    .max(40),
});
export type ProposalInput = z.output<typeof proposalInputSchema>;
export type ProposalFormValues = z.input<typeof proposalInputSchema>;

export const paymentInputSchema = z.object({
  paid_on: reqDate("Payment date"),
  amount: amount("payment amount").refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card", "other"]),
  reference: optText(100),
  notes: optText(500),
});

export const productInputSchema = z.object({
  name: reqText("Name", 200),
  category: optText(100),
  description: optText(1000),
  unit: reqText("Unit", 30),
  default_rate: amount("rate"),
  hsn_sac: optText(20),
  gst_rate: z.string().trim().transform((v, ctx) => {
    if (!v) return null;
    const p = percent("GST rate").safeParse(v);
    if (!p.success) { ctx.addIssue({ code: "custom", message: p.error.issues[0].message }); return z.NEVER; }
    return p.data;
  }),
  is_active: z.boolean(),
});
export type ProductFormValues = z.input<typeof productInputSchema>;

export const documentSettingsSchema = z.object({
  company_name: reqText("Company name", 200),
  company_email: optEmail,
  company_phone: optText(40),
  company_website: optText(200),
  company_location: optText(300),
  company_gstin: optText(20),
  signatory_label: reqText("Signatory line", 200),
  bank_account_holder: optText(200),
  bank_name: optText(200),
  bank_account_number: optText(40),
  bank_ifsc: optText(20),
  bank_upi_id: optText(100),
  default_agency_fee_enabled: z.boolean(),
  default_agency_fee_rate: percent("fee percentage"),
  default_quotation_tax_mode: z.enum(["none", "cgst_sgst", "igst"]),
  default_invoice_tax_mode: z.enum(["none", "cgst_sgst", "igst"]),
  default_tax_rate: percent("tax rate"),
  default_quotation_validity_days: z.string().trim().regex(/^\d{1,3}$/, "0–365 days").transform(Number).refine((n) => n <= 365, "0–365 days"),
  default_invoice_due_days: z.string().trim().regex(/^\d{1,3}$/, "0–365 days").transform(Number).refine((n) => n <= 365, "0–365 days"),
  quotation_terms: z.array(z.string().trim().max(1000)).max(30),
  quotation_milestones: z.array(milestoneSchema.pick({ label: true, kind: true, value: true, due_text: true })).max(12),
  invoice_payment_terms: optText(500),
  invoice_notes: optText(3000),
  gst_declaration_enabled: z.boolean(),
  gst_declaration: optText(500),
});
export type DocumentSettingsValues = z.input<typeof documentSettingsSchema>;

export const sendEmailSchema = z.object({
  to: z.email("Enter a valid recipient email address"),
  subject: reqText("Subject", 200),
  message: reqText("Message", 5000),
});

/** Parses stored config JSON (tolerating missing keys) into a CalcConfig. */
export function parseStoredConfig(raw: unknown): CalcConfig {
  const c = (raw ?? {}) as Partial<CalcConfig>;
  return {
    discount: c.discount ?? null,
    agency_fee: { ...DEFAULT_CALC_CONFIG.agency_fee, ...(c.agency_fee ?? {}) },
    tax: { ...DEFAULT_CALC_CONFIG.tax, ...(c.tax ?? {}) },
    other_charges: c.other_charges ?? [],
    round_to_rupee: c.round_to_rupee ?? false,
  };
}
