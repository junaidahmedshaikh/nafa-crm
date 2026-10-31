"use server";

import { authorized } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { buildPrefill, type ProjectPrefill } from "@/lib/finance/event";
import { fieldErrorsFrom } from "@/lib/validation/common";
import {
  budgetRowsSchema, categorySchema, expenseInputSchema, expensePaymentSchema, projectInputSchema, reimbursementSchema, revenueItemSchema, vendorSchema,
} from "@/lib/finance/schemas";

const DB_MESSAGES: Record<string, string> = {
  PAYMENT_EXCEEDS_BALANCE: "That payment is more than the balance still payable on this bill.",
  PAYMENT_IMMUTABLE: "Payments cannot be edited or deleted. Void the payment and record a new one.",
  EXPENSE_NOT_APPROVED: "Approve this expense before recording payments against it.",
  EXPENSE_NOT_FOUND: "This expense no longer exists.",
  NOT_AUTHORISED: "You do not have permission to do that.",
  RECORD_DELETED: "This record has been deleted.",
};
function dbMessage(error: { code?: string; message: string }): string {
  const code = /^[A-Z_]+/.exec(error.message)?.[0];
  if (code && DB_MESSAGES[code]) return DB_MESSAGES[code];
  if (error.code === "23505") return "This looks like a duplicate: the same record has already been entered.";
  return friendlyDbError(error);
}

const PATHS = ["/finance", "/projects", "/finance/vendors", "/finance/reimbursements"];
const project = (id: string) => [`/projects/${id}`, ...PATHS];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function saveProject(values: Parameters<typeof projectInputSchema.parse>[0], id?: string): Promise<ActionResult<{ id: string; warning?: string }>> {
  return authorized(async ({ supabase }) => {
    const parsed = projectInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Project not found.");
    const { team, invoice_ids, ...p } = parsed.data;
    const row = { ...p, category: p.category ?? "", location: p.location ?? "", notes: p.notes ?? "" };
    let projectId = id;
    if (id) {
      const { error } = await supabase.from("projects").update(row).eq("id", id);
      if (error) return fail(dbMessage(error));
    } else {
      const { data, error } = await supabase.from("projects").insert(row).select("id").single();
      if (error) return fail(dbMessage(error));
      projectId = data.id as string;
    }
    const wanted = new Set(team.filter(isUuid));
    const { data: current } = await supabase.from("project_team").select("user_id").eq("project_id", projectId);
    const have = new Set((current ?? []).map((t) => t.user_id as string));
    const toAdd = [...wanted].filter((u) => !have.has(u)).map((user_id) => ({ project_id: projectId, user_id }));
    const toRemove = [...have].filter((u) => !wanted.has(u));
    if (toAdd.length) {
      const { error } = await supabase.from("project_team").insert(toAdd);
      if (error) return fail(dbMessage(error));
    }
    if (toRemove.length) {
      const { error } = await supabase.from("project_team").delete().eq("project_id", projectId).in("user_id", toRemove);
      if (error) return fail(dbMessage(error));
    }
    // Link the chosen invoices. The project exists by now, so a failure here is a warning, not an error.
    let warning: string | undefined;
    if (invoice_ids.length) {
      const { error } = await supabase.from("project_invoices").insert(invoice_ids.map((invoice_id) => ({ project_id: projectId, invoice_id })));
      if (error) warning = error.code === "23505" ? "Project saved, but one of the invoices is already linked to another project." : "Project saved, but the invoices could not be linked. Link them from the Client revenue tab.";
    }
    refresh(project(projectId as string));
    return { ok: true, data: { id: projectId as string, warning } };
  });
}

// ---------------------------------------------------------------------------
// Soft delete / restore (database enforces: managers delete, only an admin restores)
// ---------------------------------------------------------------------------
const SOFT_TABLES = { project: "projects", expense: "expenses", reimbursement: "reimbursements", vendor: "vendors", revenue: "project_revenue_items" } as const;
export type SoftKind = keyof typeof SOFT_TABLES;

export async function deleteRecord(kind: SoftKind, id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!(kind in SOFT_TABLES) || !isUuid(id)) return fail("Record not found.");
    const { data, error } = await supabase.from(SOFT_TABLES[kind]).update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("You do not have permission to delete this record, or it no longer exists.");
    refresh(PATHS.concat("/projects/" + id));
    return { ok: true };
  });
}
export async function restoreRecord(kind: SoftKind, id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!(kind in SOFT_TABLES) || !isUuid(id)) return fail("Record not found.");
    const { data, error } = await supabase.from(SOFT_TABLES[kind]).update({ deleted_at: null }).eq("id", id).not("deleted_at", "is", null).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("Only an administrator can restore deleted records.");
    refresh(PATHS.concat("/projects/" + id));
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Expenses and their payments
// ---------------------------------------------------------------------------
export async function saveExpense(values: Parameters<typeof expenseInputSchema.parse>[0], id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized(async ({ supabase }) => {
    const parsed = expenseInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Expense not found.");
    const { vendor_name, ...e } = parsed.data;
    let vendorId = e.vendor_id;
    if (!vendorId && vendor_name) {
      // Reuse the vendor with this name (case-insensitive) rather than creating a duplicate.
      const { data: existing } = await supabase.from("vendors").select("id").ilike("name", vendor_name.replace(/[%_]/g, "\\$&")).is("deleted_at", null).limit(1);
      if (existing?.length) vendorId = existing[0].id as string;
      else {
        const { data: created, error } = await supabase.from("vendors").insert({ name: vendor_name }).select("id").single();
        if (error) return fail(dbMessage(error), { vendor_name: "Could not add this vendor" });
        vendorId = created.id as string;
      }
    }
    const row = {
      ...e, vendor_id: vendorId, bill_number: e.bill_number, notes: e.notes ?? "", gst_amount: e.gst_amount,
    };
    if (id) {
      const { error } = await supabase.from("expenses").update(row).eq("id", id);
      if (error) return fail(dbMessage(error), error.code === "23505" ? { bill_number: "This vendor bill is already entered on the project" } : undefined);
      refresh(project(e.project_id));
      return { ok: true, data: { id } };
    }
    const { data, error } = await supabase.from("expenses").insert(row).select("id").single();
    if (error) return fail(dbMessage(error), error.code === "23505" ? { bill_number: "This vendor bill is already entered on the project" } : undefined);
    refresh(project(e.project_id));
    return { ok: true, data: { id: data.id as string } };
  });
}

export async function setExpenseApproval(id: string, status: "approved" | "rejected"): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id) || !["approved", "rejected"].includes(status)) return fail("Expense not found.");
    const { data, error } = await supabase.from("expenses").update({ approval_status: status }).eq("id", id).select("project_id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("You do not have permission to review this expense.");
    refresh(project(data[0].project_id as string));
    return { ok: true };
  });
}

export async function recordExpensePayment(expenseId: string, values: Parameters<typeof expensePaymentSchema.parse>[0]): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const parsed = expensePaymentSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (!isUuid(expenseId)) return fail("Expense not found.");
    const { error } = await supabase.from("expense_payments").insert({ expense_id: expenseId, ...parsed.data });
    if (error) return fail(dbMessage(error));
    refresh(PATHS.concat("/projects"));
    return { ok: true };
  });
}

export async function voidExpensePayment(paymentId: string, reason: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(paymentId)) return fail("Payment not found.");
    if (reason.trim().length < 3) return fail("Give a reason for voiding this payment.", { reason: "A reason is required" });
    const { data, error } = await supabase.from("expense_payments").update({ voided_at: new Date().toISOString(), voided_reason: reason.trim() }).eq("id", paymentId).is("voided_at", null).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("You do not have permission to void this payment.");
    refresh(PATHS.concat("/projects"));
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Budget, revenue and invoice links
// ---------------------------------------------------------------------------
export async function saveBudget(projectId: string, rows: { category_id: string; amount: string }[]): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(projectId)) return fail("Project not found.");
    const parsed = budgetRowsSchema.safeParse(rows);
    if (!parsed.success) return fail("Enter valid budget amounts.", fieldErrorsFrom(parsed.error));
    const keep = parsed.data.filter((r) => Number(r.amount) > 0);
    if (keep.length) {
      const { error } = await supabase.from("project_budgets").upsert(keep.map((r) => ({ project_id: projectId, ...r })), { onConflict: "project_id,category_id" });
      if (error) return fail(dbMessage(error));
    }
    const drop = parsed.data.filter((r) => Number(r.amount) <= 0).map((r) => r.category_id);
    if (drop.length) {
      const { error } = await supabase.from("project_budgets").delete().eq("project_id", projectId).in("category_id", drop);
      if (error) return fail(dbMessage(error));
    }
    refresh(project(projectId));
    return { ok: true };
  });
}

export async function saveRevenueItem(projectId: string, values: Parameters<typeof revenueItemSchema.parse>[0], id?: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const parsed = revenueItemSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (!isUuid(projectId) || (id && !isUuid(id))) return fail("Record not found.");
    const q = id ? supabase.from("project_revenue_items").update(parsed.data).eq("id", id) : supabase.from("project_revenue_items").insert({ project_id: projectId, ...parsed.data });
    const { error } = await q;
    if (error) return fail(dbMessage(error));
    refresh(project(projectId));
    return { ok: true };
  });
}

export async function linkInvoice(projectId: string, invoiceId: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(projectId) || !isUuid(invoiceId)) return fail("Record not found.");
    const { error } = await supabase.from("project_invoices").insert({ project_id: projectId, invoice_id: invoiceId });
    if (error) return fail(error.code === "23505" ? "That invoice is already linked to a project." : dbMessage(error));
    refresh(project(projectId));
    return { ok: true };
  });
}
export async function unlinkInvoice(projectId: string, linkId: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(projectId) || !isUuid(linkId)) return fail("Record not found.");
    const { error } = await supabase.from("project_invoices").delete().eq("id", linkId).eq("project_id", projectId);
    if (error) return fail(dbMessage(error));
    refresh(project(projectId));
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Reimbursements, categories, vendors
// ---------------------------------------------------------------------------
export async function submitReimbursement(values: Parameters<typeof reimbursementSchema.parse>[0]): Promise<ActionResult> {
  return authorized(async ({ supabase, user, profile }) => {
    const parsed = reimbursementSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { error } = await supabase.from("reimbursements").insert({ ...parsed.data, person_id: user.id, person_name: parsed.data.person_name || profile.full_name });
    if (error) return fail(dbMessage(error));
    refresh(PATHS);
    return { ok: true };
  });
}

export async function setReimbursementStatus(id: string, status: "approved" | "rejected" | "reimbursed", reimbursedOn?: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id) || !["approved", "rejected", "reimbursed"].includes(status)) return fail("Record not found.");
    if (status === "reimbursed" && !/^\d{4}-\d{2}-\d{2}$/.test(reimbursedOn ?? "")) return fail("Enter the date it was reimbursed.", { reimbursed_on: "Date required" });
    const { data, error } = await supabase.from("reimbursements").update({ status, reimbursed_on: status === "reimbursed" ? reimbursedOn : null }).eq("id", id).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("You do not have permission to review reimbursements.");
    refresh(PATHS.concat("/projects"));
    return { ok: true };
  });
}

export async function addCategory(name: string): Promise<ActionResult<{ id: string }>> {
  return authorized(async ({ supabase }) => {
    const parsed = categorySchema.safeParse({ name });
    if (!parsed.success) return fail("Enter a category name.", fieldErrorsFrom(parsed.error));
    const { data, error } = await supabase.from("expense_categories").insert({ name: parsed.data.name, is_default: false, sort_order: 200 }).select("id").single();
    if (error) return fail(error.code === "23505" ? "A category with this name already exists." : dbMessage(error));
    refresh(PATHS);
    return { ok: true, data: { id: data.id as string } };
  });
}

export async function saveVendor(values: Parameters<typeof vendorSchema.parse>[0], id?: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const parsed = vendorSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const v = { name: parsed.data.name, gstin: parsed.data.gstin ?? "", phone: parsed.data.phone ?? "", email: parsed.data.email ?? "", notes: parsed.data.notes ?? "" };
    const { error } = id && isUuid(id) ? await supabase.from("vendors").update(v).eq("id", id) : await supabase.from("vendors").insert(v);
    if (error) return fail(error.code === "23505" ? "A vendor with this name already exists." : dbMessage(error));
    refresh(PATHS);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Project form helper: what an invoice (and its quotation and lead) already know about the event
// ---------------------------------------------------------------------------
export async function fetchInvoiceEvent(invoiceId: string): Promise<ActionResult<{ prefill: ProjectPrefill }>> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(invoiceId)) return fail("Invoice not found.");
    const { data: inv } = await supabase.from("invoices")
      .select("number, project_name, project_location, project_date_text, company_id, lead_id, quotation_id, grand_total, cgst, sgst, igst").eq("id", invoiceId).maybeSingle();
    if (!inv) return fail("Invoice not found.");
    const [quotation, lead] = await Promise.all([
      inv.quotation_id ? supabase.from("quotations").select("event_type, event_name, event_location, event_date_text").eq("id", inv.quotation_id).maybeSingle() : Promise.resolve({ data: null }),
      inv.lead_id ? supabase.from("leads").select("title, event_name, event_date, city, venue, service_category, company_id").eq("id", inv.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const exGst = Math.round((Number(inv.grand_total) - Number(inv.cgst) - Number(inv.sgst) - Number(inv.igst)) * 100) / 100;
    return { ok: true, data: { prefill: buildPrefill({ invoice: { ...inv, ex_gst: exGst }, quotation: quotation.data, lead: lead.data }) } };
  });
}
