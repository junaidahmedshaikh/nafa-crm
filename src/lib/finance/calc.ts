import Decimal from "decimal.js";

/**
 * Project profitability. The database does the summing (project_finance_summary); everything derived from
 * those sums lives here so there is exactly one definition of profit, margin and break-even.
 *
 * All inputs are GST-exclusive. Recoverable input GST and GST collected are carried separately and are
 * never part of revenue, cost or profit.
 */
export type SummaryRow = {
  project_id?: string;
  name?: string;
  status?: string;
  approved_value: number | string;
  additional_charges: number | string;
  change_orders: number | string;
  invoiced_ex_gst: number | string;
  gst_collected: number | string;
  invoiced_total: number | string;
  received: number | string;
  budget_total: number | string;
  expense_cost: number | string;
  reimbursement_cost: number | string;
  gst_input_recoverable: number | string;
  bills_total: number | string;
  bills_paid: number | string;
};

const d = (v: number | string | null | undefined): Decimal => {
  try {
    const x = new Decimal(v ?? 0);
    return x.isFinite() ? x : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};
const r2 = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const pct = (num: Decimal, den: Decimal): number | null => (den.gt(0) ? num.div(den).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() : null);

export type ProfitAndLoss = {
  revenue_total: number;
  cost_total: number;
  gross_profit: number;
  profit_margin: number | null;
  estimated_cost: number;
  estimated_profit: number;
  estimated_margin: number | null;
  profit_difference: number;
  /** Revenue needed to cover the costs incurred so far. */
  break_even_revenue: number;
  is_loss: boolean;
  // client side
  invoiced_total: number;
  gst_collected: number;
  received: number;
  client_outstanding: number;
  unbilled_revenue: number;
  // vendor side
  bills_total: number;
  vendor_paid: number;
  vendor_payable: number;
  gst_input_recoverable: number;
};

export function profitAndLoss(s: SummaryRow): ProfitAndLoss {
  const revenue = d(s.approved_value).plus(d(s.additional_charges)).plus(d(s.change_orders));
  const cost = d(s.expense_cost).plus(d(s.reimbursement_cost));
  const profit = revenue.minus(cost);
  const estCost = d(s.budget_total);
  const estProfit = revenue.minus(estCost);
  const invoiced = d(s.invoiced_total);
  const received = d(s.received);
  return {
    revenue_total: r2(revenue),
    cost_total: r2(cost),
    gross_profit: r2(profit),
    profit_margin: pct(profit, revenue),
    estimated_cost: r2(estCost),
    estimated_profit: r2(estProfit),
    estimated_margin: pct(estProfit, revenue),
    profit_difference: r2(profit.minus(estProfit)),
    break_even_revenue: r2(cost),
    // A project with nothing booked yet is neither profit nor loss.
    is_loss: profit.lt(0) && (revenue.gt(0) || cost.gt(0)),
    invoiced_total: r2(invoiced),
    gst_collected: r2(d(s.gst_collected)),
    received: r2(received),
    client_outstanding: r2(Decimal.max(invoiced.minus(received), 0)),
    unbilled_revenue: r2(Decimal.max(revenue.minus(d(s.invoiced_ex_gst)), 0)),
    bills_total: r2(d(s.bills_total)),
    vendor_paid: r2(d(s.bills_paid)),
    vendor_payable: r2(Decimal.max(d(s.bills_total).minus(d(s.bills_paid)), 0)),
    gst_input_recoverable: r2(d(s.gst_input_recoverable)),
  };
}

export type DashboardTotals = ProfitAndLoss & { project_count: number; loss_projects: number };

/** Sums the per-project figures. Margin is recomputed from the totals (never an average of margins). */
export function aggregateProjects(rows: SummaryRow[]): DashboardTotals {
  const zero = (): Record<keyof Omit<SummaryRow, "project_id" | "name" | "status">, Decimal> => ({
    approved_value: d(0), additional_charges: d(0), change_orders: d(0), invoiced_ex_gst: d(0), gst_collected: d(0), invoiced_total: d(0), received: d(0),
    budget_total: d(0), expense_cost: d(0), reimbursement_cost: d(0), gst_input_recoverable: d(0), bills_total: d(0), bills_paid: d(0),
  });
  const sum = zero();
  let losses = 0;
  for (const row of rows) {
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] = sum[k].plus(d(row[k]));
    if (profitAndLoss(row).is_loss) losses++;
  }
  const asNumbers = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v.toString()])) as unknown as SummaryRow;
  return { ...profitAndLoss(asNumbers), project_count: rows.length, loss_projects: losses };
}

// ---------------------------------------------------------------------------
// Budget alerts (the database view computes the same thresholds; this is for client-side previews)
// ---------------------------------------------------------------------------
export type BudgetAlert = "ok" | "warning" | "critical" | "over";
export function budgetAlert(budget: number | string, actual: number | string): BudgetAlert {
  const b = d(budget);
  const a = d(actual);
  if (a.gt(b)) return "over";
  if (b.gt(0) && a.gte(b.times(0.9))) return "critical";
  if (b.gt(0) && a.gte(b.times(0.75))) return "warning";
  return "ok";
}
export const BUDGET_ALERT_LABEL: Record<BudgetAlert, string> = {
  ok: "On track", warning: "75% used", critical: "90% used", over: "Over budget",
};

/** Line total preview used by the expense form: qty × rate, plus GST. */
export function expenseTotals(qty: number | string, rate: number | string, gst: number | string) {
  const subtotal = d(qty).times(d(rate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { subtotal: subtotal.toNumber(), total: subtotal.plus(d(gst)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() };
}

export type ExpensePaymentStatus = "pending" | "partial" | "paid" | "overdue";
export function expensePaymentStatus(total: number | string, paid: number | string, dueDate: string | null, today: string): ExpensePaymentStatus {
  if (d(paid).gte(d(total))) return "paid";
  if (dueDate && dueDate < today) return "overdue";
  return d(paid).gt(0) ? "partial" : "pending";
}

// ---------------------------------------------------------------------------
// Profit & Loss: expense detail grouped by category
// ---------------------------------------------------------------------------
export type CostLine = {
  source: "expense" | "reimbursement";
  id: string;
  date: string;
  category_id: string;
  category_name: string;
  title: string;
  vendor: string | null;
  note: string | null;
  /** GST-exclusive project cost (GST only when it is not recoverable). */
  amount: number | string;
  /** Recoverable input GST on this bill: shown for reference, never part of the cost. */
  gst_recoverable?: number | string;
};
export type CostGroup = { category_id: string; category_name: string; total: number; share_pct: number | null; lines: (CostLine & { amount: number })[] };

/** Groups cost lines by category (largest first, lines by date) with exact totals and each category's share of the whole. */
export function groupCostLines(lines: CostLine[]): { groups: CostGroup[]; total: number } {
  const byCat = new Map<string, { name: string; sum: Decimal; lines: (CostLine & { amount: number })[] }>();
  let all = new Decimal(0);
  for (const l of lines) {
    const amt = d(l.amount);
    all = all.plus(amt);
    const g = byCat.get(l.category_id) ?? { name: l.category_name, sum: new Decimal(0), lines: [] };
    g.sum = g.sum.plus(amt);
    g.lines.push({ ...l, amount: r2(amt) });
    byCat.set(l.category_id, g);
  }
  const groups = [...byCat.entries()]
    .map(([category_id, g]) => ({
      category_id, category_name: g.name, total: r2(g.sum), share_pct: pct(g.sum, all),
      lines: g.lines.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => b.total - a.total || a.category_name.localeCompare(b.category_name));
  return { groups, total: r2(all) };
}
