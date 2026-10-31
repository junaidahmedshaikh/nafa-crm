import { z } from "zod";
import { optDate, optText, optUuid, reqText } from "@/lib/validation/common";

const money = (label: string) =>
  z.string().trim().transform((v, ctx) => {
    const c = (v || "0").replace(/[,\s₹]/g, "");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) {
      ctx.addIssue({ code: "custom", message: `Enter a valid ${label}` });
      return z.NEVER;
    }
    return c;
  });
const positiveMoney = (label: string) => money(label).refine((v) => Number(v) > 0, `${label[0].toUpperCase() + label.slice(1)} must be more than zero`);
const signedMoney = (label: string) =>
  z.string().trim().transform((v, ctx) => {
    const c = (v || "").replace(/[,\s₹]/g, "");
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(c) || Number(c) === 0) {
      ctx.addIssue({ code: "custom", message: `Enter a valid non-zero ${label}` });
      return z.NEVER;
    }
    return c;
  });
const quantity = z.string().trim().transform((v, ctx) => {
  const c = (v || "").replace(/[,\s]/g, "");
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(c) || Number(c) <= 0) {
    ctx.addIssue({ code: "custom", message: "Enter a quantity above zero" });
    return z.NEVER;
  }
  return c;
});
const reqDate = (label: string) =>
  z.string().trim().min(1, `${label} is required`).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), "Enter a valid date");

export const PROJECT_STATUSES = ["planning", "confirmed", "in_progress", "completed", "settled", "cancelled"] as const;
export const PROJECT_STATUS_LABELS: Record<(typeof PROJECT_STATUSES)[number], string> = {
  planning: "Planning", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", settled: "Settled", cancelled: "Cancelled",
};
export const PAYMENT_MODES = ["bank_transfer", "upi", "cash", "cheque", "card", "other"] as const;
export const MODE_LABELS: Record<(typeof PAYMENT_MODES)[number], string> = {
  bank_transfer: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque", card: "Card", other: "Other",
};

export const projectInputSchema = z
  .object({
    name: reqText("Project name", 200),
    company_id: optUuid,
    lead_id: optUuid,
    quotation_id: optUuid,
    category: optText(100),
    location: optText(200),
    start_date: optDate,
    end_date: optDate,
    manager_id: optUuid,
    status: z.enum(PROJECT_STATUSES),
    approved_value: money("approved value"),
    final_billing_amount: z.string().trim().optional().transform((v, ctx) => {
      if (!v) return null;
      const c = v.replace(/[,\s₹]/g, "");
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid billing amount" });
        return z.NEVER;
      }
      return c;
    }),
    notes: optText(2000),
    team: z.array(z.string()).default([]),
    invoice_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => !v.start_date || !v.end_date || v.end_date >= v.start_date, { path: ["end_date"], message: "End date is before the start date" });
export type ProjectInput = z.output<typeof projectInputSchema>;

export const expenseInputSchema = z.object({
  project_id: z.string().uuid("Choose a project"),
  expense_date: reqDate("Expense date"),
  category_id: z.string().uuid("Choose a category"),
  description: reqText("Description", 500),
  vendor_id: optUuid,
  vendor_name: optText(200), // creates the vendor when it does not exist yet
  bill_number: optText(100),
  qty: quantity,
  unit: reqText("Unit", 30),
  rate: money("rate"),
  gst_amount: money("GST amount"),
  gst_recoverable: z.boolean(),
  estimated_amount: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const c = v.replace(/[,\s₹]/g, "");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(c)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid estimate" });
      return z.NEVER;
    }
    return c;
  }),
  due_date: optDate,
  notes: optText(1000),
});
export type ExpenseInput = z.output<typeof expenseInputSchema>;

export const expensePaymentSchema = z.object({
  paid_on: reqDate("Payment date"),
  amount: positiveMoney("amount"),
  method: z.enum(PAYMENT_MODES),
  reference: optText(100),
  notes: optText(500),
});
export type ExpensePaymentInput = z.output<typeof expensePaymentSchema>;

export const budgetRowsSchema = z.array(z.object({ category_id: z.string().uuid(), amount: money("budget") })).max(100);

export const revenueItemSchema = z.object({
  kind: z.enum(["additional_charge", "change_order"]),
  description: reqText("Description", 300),
  amount: signedMoney("amount"),
  approved: z.boolean(),
  item_date: reqDate("Date"),
});
export type RevenueItemInput = z.output<typeof revenueItemSchema>;

export const reimbursementSchema = z.object({
  person_name: reqText("Person name", 200),
  project_id: z.string().uuid("Choose a project"),
  expense_date: reqDate("Expense date"),
  description: reqText("Description", 500),
  category_id: z.string().uuid("Choose a category"),
  amount: positiveMoney("amount"),
  expense_id: optUuid,
});
export type ReimbursementInput = z.output<typeof reimbursementSchema>;

export const categorySchema = z.object({ name: reqText("Category name", 100) });
export const vendorSchema = z.object({
  name: reqText("Vendor name", 200), gstin: optText(20), phone: optText(40), email: optText(200), notes: optText(500),
});
