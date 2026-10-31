import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import { aggregateProjects, type SummaryRow } from "./calc";

export type FinanceRole = "admin" | "management" | "accounts" | "project_manager" | "operations" | "none";
export type FinanceAccess = { role: FinanceRole; any: boolean; manage: boolean; admin: boolean; seesRevenue: boolean };

export async function getFinanceAccess(supabase: SupabaseClient): Promise<FinanceAccess> {
  const { data, error } = await supabase.rpc("fin_role");
  // A missing function means the Project Finance migration has not been run: say so instead of "no access".
  if (error) throw new Error("Project Finance is not set up yet. Run supabase/migrations/20261031000001_project_finance.sql in the Supabase SQL editor.");
  const role = ((data as string | null) ?? "none") as FinanceRole;
  const manage = role === "admin" || role === "management" || role === "accounts";
  return { role, any: role !== "none", manage, admin: role === "admin", seesRevenue: manage };
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type Category = { id: string; name: string; sort_order: number; is_active: boolean };
export type Vendor = { id: string; name: string; gstin: string; phone: string; email: string };
export type Person = { id: string; full_name: string };

export async function listCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data } = await supabase.from("expense_categories").select("id, name, sort_order, is_active").eq("is_active", true).order("sort_order").order("name");
  return (data ?? []) as Category[];
}
export async function listVendors(supabase: SupabaseClient): Promise<Vendor[]> {
  const { data } = await supabase.from("vendors").select("id, name, gstin, phone, email").is("deleted_at", null).order("name").limit(1000);
  return (data ?? []) as Vendor[];
}
export async function listPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  return (data ?? []) as Person[];
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export type ProjectRow = {
  id: string; project_number: number; name: string; company_id: string | null; lead_id: string | null; quotation_id: string | null; category: string; location: string;
  start_date: string | null; end_date: string | null; manager_id: string | null; status: string; approved_value: number | string;
  final_billing_amount: number | string | null; notes: string; created_at: string; deleted_at: string | null;
  company: { name: string } | null; manager: { full_name: string } | null;
};
export const projectCode = (n: number) => `PRJ-${String(n).padStart(4, "0")}`;

const PROJECT_SELECT = "*, company:companies(name), manager:profiles!projects_manager_id_fkey(full_name)";

export async function listProjects(supabase: SupabaseClient, p: { q: string; status: string; page: number; deleted?: boolean }) {
  const [from, to] = pageRange(p.page);
  let query = supabase.from("projects").select(PROJECT_SELECT, { count: "exact" });
  query = p.deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  const s = sanitizeSearch(p.q);
  if (s) query = query.or(`name.ilike.%${s}%,location.ilike.%${s}%,category.ilike.%${s}%`);
  if (p.status) query = query.eq("status", p.status);
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  const rows = (data ?? []) as unknown as ProjectRow[];
  const summaries = await getSummaries(supabase, rows.map((r) => r.id));
  return { rows, summaries, total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function getSummaries(supabase: SupabaseClient, ids: string[]): Promise<Record<string, SummaryRow>> {
  if (!ids.length) return {};
  const { data } = await supabase.from("project_finance_summary").select("*").in("project_id", ids);
  return Object.fromEntries(((data ?? []) as SummaryRow[]).map((r) => [r.project_id as string, r]));
}

export async function getProject(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: project } = await supabase.from("projects").select(PROJECT_SELECT).eq("id", id).maybeSingle();
  if (!project) return null;
  const [summary, team] = await Promise.all([
    getSummaries(supabase, [id]),
    supabase.from("project_team").select("user_id").eq("project_id", id),
  ]);
  return { project: project as unknown as ProjectRow, summary: summary[id] ?? null, team: (team.data ?? []).map((t) => t.user_id as string) };
}

export type BudgetRow = { category_id: string; category_name: string; budget: number | string; actual: number | string; remaining: number | string; utilization_pct: number | string | null; alert: "ok" | "warning" | "critical" | "over" };
export async function getBudgetStatus(supabase: SupabaseClient, projectId: string): Promise<BudgetRow[]> {
  const { data } = await supabase.from("budget_status").select("category_id, category_name, budget, actual, remaining, utilization_pct, alert").eq("project_id", projectId).order("category_name");
  return (data ?? []) as BudgetRow[];
}

export type RevenueItem = { id: string; kind: "additional_charge" | "change_order"; description: string; amount: number | string; approved: boolean; item_date: string };
export type LinkedInvoice = { id: string; invoice_id: string; number: string | null; invoice_date: string; due_date: string | null; state: string; subtotal: number; gst: number; grand_total: number; received: number };

export async function getRevenueDetail(supabase: SupabaseClient, projectId: string) {
  const [items, links] = await Promise.all([
    supabase.from("project_revenue_items").select("id, kind, description, amount, approved, item_date").eq("project_id", projectId).is("deleted_at", null).order("item_date"),
    supabase.from("project_invoices").select("id, invoice_id, invoices(number, invoice_date, due_date, state, grand_total, cgst, sgst, igst)").eq("project_id", projectId),
  ]);
  const invoiceIds = (links.data ?? []).map((l) => l.invoice_id as string);
  const { data: pays } = invoiceIds.length
    ? await supabase.from("invoice_payments").select("id, invoice_id, paid_on, amount, method, reference").in("invoice_id", invoiceIds).is("voided_at", null).order("paid_on")
    : { data: [] };
  type Inv = { number: string | null; invoice_date: string; due_date: string | null; state: string; grand_total: number; cgst: number; sgst: number; igst: number };
  const invoices: LinkedInvoice[] = (links.data ?? []).map((l) => {
    const i = (Array.isArray(l.invoices) ? l.invoices[0] : l.invoices) as unknown as Inv;
    const gst = Number(i.cgst) + Number(i.sgst) + Number(i.igst);
    const received = (pays ?? []).filter((p) => p.invoice_id === l.invoice_id).reduce((a, p) => a + Number(p.amount), 0);
    return { id: l.id as string, invoice_id: l.invoice_id as string, number: i.number, invoice_date: i.invoice_date, due_date: i.due_date, state: i.state, subtotal: Number(i.grand_total) - gst, gst, grand_total: Number(i.grand_total), received };
  });
  return { items: (items.data ?? []) as RevenueItem[], invoices, payments: (pays ?? []) as { id: string; invoice_id: string; paid_on: string; amount: number | string; method: string; reference: string | null }[] };
}

/** Issued invoices not yet attached to any project, for the "link invoice" picker. */
export type LinkableInvoice = { id: string; number: string; client_company: string; project_name: string; grand_total: number | string; company_id: string | null; ex_gst: number };
export async function listLinkableInvoices(supabase: SupabaseClient, companyId: string | null): Promise<LinkableInvoice[]> {
  const { data: linked } = await supabase.from("project_invoices").select("invoice_id");
  const taken = new Set((linked ?? []).map((l) => l.invoice_id as string));
  let q = supabase.from("invoices").select("id, number, client_company, project_name, grand_total, cgst, sgst, igst, company_id").eq("state", "issued").order("created_at", { ascending: false }).limit(200);
  if (companyId) q = q.eq("company_id", companyId);
  const { data } = await q;
  return (data ?? []).filter((i) => !taken.has(i.id as string)).map((i) => ({
    id: i.id as string, number: i.number as string, client_company: i.client_company as string, project_name: i.project_name as string,
    grand_total: i.grand_total as number | string, company_id: (i.company_id as string | null) ?? null,
    ex_gst: Math.round((Number(i.grand_total) - Number(i.cgst) - Number(i.sgst) - Number(i.igst)) * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export type ExpenseRow = {
  id: string; expense_code: string; project_id: string; project_name: string; expense_date: string; category_id: string; category_name: string; description: string;
  vendor_id: string | null; vendor_name: string | null; bill_number: string | null; qty: number | string; unit: string; rate: number | string; subtotal: number | string;
  gst_amount: number | string; gst_recoverable: boolean; total_amount: number | string; estimated_amount: number | string | null; due_date: string | null;
  approval_status: "submitted" | "approved" | "rejected"; notes: string; created_by: string | null; paid_amount: number | string; outstanding_amount: number | string;
  payment_status: "pending" | "partial" | "paid" | "overdue"; deleted_at: string | null;
};

export type ExpenseFilters = {
  q: string; category: string; vendor: string; status: string; from: string; to: string; paid: string; kind: string;
  sort: string; dir: "asc" | "desc"; page: number; deleted?: boolean;
};
const SORTS: Record<string, string> = { date: "expense_date", amount: "total_amount", category: "category_name" };

export async function listExpenses(supabase: SupabaseClient, projectId: string, f: ExpenseFilters) {
  const [from, to] = pageRange(f.page);
  let q = supabase.from("expense_list").select("*", { count: "exact" }).eq("project_id", projectId);
  q = f.deleted ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`description.ilike.%${s}%,vendor_name.ilike.%${s}%,bill_number.ilike.%${s}%,expense_code.ilike.%${s}%`);
  if (isUuid(f.category)) q = q.eq("category_id", f.category);
  if (isUuid(f.vendor)) q = q.eq("vendor_id", f.vendor);
  if (["pending", "partial", "paid", "overdue"].includes(f.status)) q = q.eq("payment_status", f.status);
  if (f.paid === "paid") q = q.eq("payment_status", "paid");
  if (f.paid === "unpaid") q = q.neq("payment_status", "paid");
  if (f.kind === "estimated") q = q.not("estimated_amount", "is", null);
  if (f.from) q = q.gte("expense_date", f.from);
  if (f.to) q = q.lte("expense_date", f.to);
  const col = SORTS[f.sort] ?? "expense_date";
  const { data, count, error } = await q.order(col, { ascending: f.dir === "asc" }).order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(`Could not load expenses: ${error.message}`);
  return { rows: (data ?? []) as ExpenseRow[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export type PaymentRow = { id: string; expense_id: string; paid_on: string; amount: number | string; method: string; reference: string | null; notes: string | null; voided_at: string | null; voided_reason: string | null };
export async function listExpensePayments(supabase: SupabaseClient, expenseIds: string[]): Promise<PaymentRow[]> {
  if (!expenseIds.length) return [];
  const { data } = await supabase.from("expense_payments").select("id, expense_id, paid_on, amount, method, reference, notes, voided_at, voided_reason").in("expense_id", expenseIds).order("paid_on");
  return (data ?? []) as PaymentRow[];
}

// ---------------------------------------------------------------------------
// Reimbursements and vendors
// ---------------------------------------------------------------------------
export type ReimbursementRow = {
  id: string; person_id: string | null; person_name: string; project_id: string; expense_date: string; description: string; category_id: string; amount: number | string;
  status: "submitted" | "approved" | "rejected" | "reimbursed"; reimbursed_on: string | null; expense_id: string | null; created_at: string;
  project: { name: string } | null; category: { name: string } | null;
};
export async function listReimbursements(supabase: SupabaseClient, p: { status: string; project?: string; page: number }) {
  const [from, to] = pageRange(p.page);
  let q = supabase.from("reimbursements").select("*, project:projects(name), category:expense_categories(name)", { count: "exact" }).is("deleted_at", null);
  if (["submitted", "approved", "rejected", "reimbursed"].includes(p.status)) q = q.eq("status", p.status);
  if (p.project && isUuid(p.project)) q = q.eq("project_id", p.project);
  const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(`Could not load reimbursements: ${error.message}`);
  return { rows: (data ?? []) as unknown as ReimbursementRow[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export type VendorPayable = {
  vendor_id: string; vendor_name: string; expense_id: string; expense_code: string; project_id: string; project_name: string; bill_number: string | null;
  expense_date: string; due_date: string | null; total_amount: number | string; paid_amount: number | string; outstanding_amount: number | string; payment_status: string;
};
export async function listVendorPayables(supabase: SupabaseClient, p: { vendor: string; unpaidOnly: boolean }) {
  let q = supabase.from("vendor_payables").select("*");
  if (isUuid(p.vendor)) q = q.eq("vendor_id", p.vendor);
  if (p.unpaidOnly) q = q.neq("payment_status", "paid");
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw new Error(`Could not load vendor bills: ${error.message}`);
  return (data ?? []) as VendorPayable[];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export type MonthPoint = { month: string; revenue: number; cost: number };
export type CategoryPoint = { category_id: string; category_name: string; amount: number };

export async function getDashboard(supabase: SupabaseClient, range: { from: string | null; to: string | null }, projectId?: string) {
  let q = supabase.from("project_finance_summary").select("*");
  if (projectId && isUuid(projectId)) q = q.eq("project_id", projectId);
  else {
    if (range.from) q = q.gte("basis_date", range.from);
    if (range.to) q = q.lte("basis_date", range.to);
  }
  const { data: rows } = await q.limit(2000);
  const summaries = (rows ?? []) as (SummaryRow & { project_id: string; name: string })[];
  const ids = summaries.map((r) => r.project_id);
  const args = { p_from: range.from, p_to: range.to, p_project: projectId && isUuid(projectId) ? projectId : null };
  const [monthly, cats, budgets, payables] = await Promise.all([
    supabase.rpc("finance_monthly", args),
    supabase.rpc("finance_category_totals", args),
    ids.length ? supabase.from("budget_status").select("project_id, budget, actual, alert, category_name").in("project_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("vendor_payables").select("vendor_name, outstanding_amount, payment_status").in("project_id", ids).neq("payment_status", "paid") : Promise.resolve({ data: [] }),
  ]);
  const vendorOutstanding = new Map<string, number>();
  for (const v of (payables.data ?? []) as { vendor_name: string; outstanding_amount: number | string }[]) {
    vendorOutstanding.set(v.vendor_name, (vendorOutstanding.get(v.vendor_name) ?? 0) + Number(v.outstanding_amount));
  }
  return {
    totals: aggregateProjects(summaries),
    summaries,
    monthly: ((monthly.data ?? []) as { month: string; revenue: number | string; cost: number | string }[]).map((m) => ({ month: m.month, revenue: Number(m.revenue), cost: Number(m.cost) })) as MonthPoint[],
    categories: ((cats.data ?? []) as { category_id: string; category_name: string; amount: number | string }[]).map((c) => ({ ...c, amount: Number(c.amount) })) as CategoryPoint[],
    alerts: ((budgets.data ?? []) as { project_id: string; alert: string; category_name: string }[]).filter((b) => b.alert !== "ok"),
    vendorOutstanding: [...vendorOutstanding.entries()].map(([vendor, amount]) => ({ vendor, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8),
    budgetTotals: ((budgets.data ?? []) as { budget: number | string; actual: number | string }[]).reduce<{ budget: number; actual: number }>((a, b) => ({ budget: a.budget + Number(b.budget), actual: a.actual + Number(b.actual) }), { budget: 0, actual: 0 }),
  };
}

export type AuditRow = { id: number; at: string; actor: string | null; table_name: string; action: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null };
/** Audit trail for a project: the project row itself plus every row that carries its project_id. */
export async function listProjectAudit(supabase: SupabaseClient, projectId: string, limit = 60): Promise<AuditRow[]> {
  if (!isUuid(projectId)) return [];
  const { data } = await supabase.from("finance_audit").select("id, at, actor, table_name, action, old_row, new_row")
    .or(`row_id.eq.${projectId},new_row->>project_id.eq.${projectId},old_row->>project_id.eq.${projectId}`)
    .order("id", { ascending: false }).limit(limit);
  return (data ?? []) as AuditRow[];
}

export async function getCategoryTotals(supabase: SupabaseClient, projectId: string): Promise<CategoryPoint[]> {
  const { data } = await supabase.rpc("finance_category_totals", { p_from: null, p_to: null, p_project: projectId });
  return ((data ?? []) as { category_id: string; category_name: string; amount: number | string }[]).map((c) => ({ ...c, amount: Number(c.amount) }));
}
