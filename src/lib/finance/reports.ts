import type { SupabaseClient } from "@supabase/supabase-js";
import { profitAndLoss, type SummaryRow } from "./calc";
import type { ExpenseRow } from "./repo";

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export type ReportFilters = { project: string; client: string; from: string; to: string; category: string; paid: string };
export const PAID_FILTERS = ["pending", "partial", "paid", "overdue"] as const;

export function parseReportFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  return {
    project: isUuid(one(sp.project)) ? one(sp.project) : "", client: isUuid(one(sp.client)) ? one(sp.client) : "",
    from: isDate(one(sp.from)) ? one(sp.from) : "", to: isDate(one(sp.to)) ? one(sp.to) : "",
    category: isUuid(one(sp.category)) ? one(sp.category) : "", paid: (PAID_FILTERS as readonly string[]).includes(one(sp.paid)) ? one(sp.paid) : "",
  };
}

export type ProjectReportRow = {
  project_id: string; name: string; client: string; status: string; start_date: string | null;
  project_value: number; invoiced: number; received: number; outstanding: number;
  estimated_expenses: number; expenses: number; expenses_paid: number; expenses_unpaid: number; gross_profit: number; margin: number | null; is_loss: boolean;
};

/**
 * Project-wise profitability. One definition of every figure (lib/finance/calc.ts), GST-exclusive:
 *   project value = approved value + approved extras / change orders      outstanding = invoiced − received
 *   expenses      = approved expenses + approved reimbursements (each counted once)
 *   paid / unpaid = how much of the approved bills has actually been paid to vendors
 * Revenue is visible to admin / accounts / management only (RLS); other roles get no rows here.
 */
export async function projectReport(supabase: SupabaseClient, f: ReportFilters): Promise<ProjectReportRow[]> {
  let q = supabase.from("project_finance_summary").select("*");
  if (f.project) q = q.eq("project_id", f.project);
  if (f.client) q = q.eq("company_id", f.client);
  if (f.from) q = q.gte("basis_date", f.from);
  if (f.to) q = q.lte("basis_date", f.to);
  const { data } = await q.order("basis_date", { ascending: false }).limit(2000);
  const rows = (data ?? []) as (SummaryRow & { project_id: string; name: string; status: string; company_id: string | null; start_date: string | null })[];
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter((c): c is string => !!c))];
  const { data: companies } = companyIds.length ? await supabase.from("companies").select("id, name").in("id", companyIds) : { data: [] };
  const names = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]));
  return rows.map((r) => {
    const p = profitAndLoss(r);
    return {
      project_id: r.project_id, name: r.name, client: (r.company_id && names.get(r.company_id)) || "", status: r.status, start_date: r.start_date,
      project_value: p.revenue_total, invoiced: p.invoiced_total, received: p.received, outstanding: p.client_outstanding,
      estimated_expenses: p.estimated_cost, expenses: p.cost_total, expenses_paid: p.vendor_paid, expenses_unpaid: p.vendor_payable,
      gross_profit: p.gross_profit, margin: p.profit_margin, is_loss: p.is_loss,
    };
  });
}

export function projectReportTotals(rows: ProjectReportRow[]) {
  const sum = (k: keyof ProjectReportRow) => Math.round(rows.reduce((a, r) => a + Number(r[k]), 0) * 100) / 100;
  const value = sum("project_value");
  const profit = sum("gross_profit");
  return {
    project_value: value, invoiced: sum("invoiced"), received: sum("received"), outstanding: sum("outstanding"), estimated_expenses: sum("estimated_expenses"),
    expenses: sum("expenses"), expenses_paid: sum("expenses_paid"), expenses_unpaid: sum("expenses_unpaid"), gross_profit: profit,
    margin: value > 0 ? Math.round((profit / value) * 10000) / 100 : null, low: rows.filter((r) => r.is_loss || (r.margin !== null && r.margin < 10 && r.project_value > 0)).length,
  };
}

/** Expense register across projects (RLS: each person sees the projects they may see). */
export async function expenseReport(supabase: SupabaseClient, f: ReportFilters, limit = 5000): Promise<ExpenseRow[]> {
  let q = supabase.from("expense_list").select("*").is("deleted_at", null);
  if (f.project) q = q.eq("project_id", f.project);
  if (f.category) q = q.eq("category_id", f.category);
  if (f.paid) q = q.eq("payment_status", f.paid);
  if (f.from) q = q.gte("expense_date", f.from);
  if (f.to) q = q.lte("expense_date", f.to);
  if (f.client) {
    const { data: ps } = await supabase.from("projects").select("id").eq("company_id", f.client).limit(2000);
    const ids = (ps ?? []).map((p) => p.id as string);
    if (!ids.length) return [];
    q = q.in("project_id", ids);
  }
  const { data } = await q.order("expense_date", { ascending: false }).limit(limit);
  return (data ?? []) as ExpenseRow[];
}
