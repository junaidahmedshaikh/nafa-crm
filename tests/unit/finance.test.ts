import { describe, expect, it } from "vitest";
import { aggregateProjects, budgetAlert, expensePaymentStatus, expenseTotals, profitAndLoss, type SummaryRow } from "@/lib/finance/calc";
import { resolveRange } from "@/lib/finance/range";

const row = (o: Partial<SummaryRow> = {}): SummaryRow => ({
  approved_value: 0, additional_charges: 0, change_orders: 0, invoiced_ex_gst: 0, gst_collected: 0, invoiced_total: 0, received: 0,
  budget_total: 0, expense_cost: 0, reimbursement_cost: 0, gst_input_recoverable: 0, bills_total: 0, bills_paid: 0, ...o,
});

describe("profitAndLoss", () => {
  it("derives revenue, profit, margin, estimate, difference and break-even from GST-exclusive sums", () => {
    const pl = profitAndLoss(row({ approved_value: 100000, additional_charges: 5000, change_orders: -2000, expense_cost: 60000, reimbursement_cost: 3000, budget_total: 55000 }));
    expect(pl.revenue_total).toBe(103000);
    expect(pl.cost_total).toBe(63000);
    expect(pl.gross_profit).toBe(40000);
    expect(pl.profit_margin).toBe(38.83);
    expect(pl.estimated_profit).toBe(48000);
    expect(pl.estimated_margin).toBe(46.6);
    expect(pl.profit_difference).toBe(-8000);
    expect(pl.break_even_revenue).toBe(63000);
    expect(pl.is_loss).toBe(false);
  });

  it("never lets GST into revenue or profit; keeps it as separate figures", () => {
    const pl = profitAndLoss(row({ approved_value: 10000, invoiced_ex_gst: 10000, gst_collected: 1800, invoiced_total: 11800, received: 5000, expense_cost: 4000, gst_input_recoverable: 720 }));
    expect(pl.revenue_total).toBe(10000);
    expect(pl.gross_profit).toBe(6000);
    expect(pl.gst_collected).toBe(1800);
    expect(pl.gst_input_recoverable).toBe(720);
    expect(pl.client_outstanding).toBe(6800);
    expect(pl.unbilled_revenue).toBe(0);
  });

  it("flags losses, but not an empty project, and has no margin without revenue", () => {
    expect(profitAndLoss(row({ approved_value: 1000, expense_cost: 1500 })).is_loss).toBe(true);
    expect(profitAndLoss(row({ approved_value: 1000, expense_cost: 1500 })).profit_margin).toBe(-50);
    const empty = profitAndLoss(row());
    expect(empty.is_loss).toBe(false);
    expect(empty.profit_margin).toBeNull();
    expect(profitAndLoss(row({ expense_cost: 500 })).profit_margin).toBeNull();
    expect(profitAndLoss(row({ expense_cost: 500 })).is_loss).toBe(true);
  });

  it("computes vendor payable and tolerates bad input", () => {
    expect(profitAndLoss(row({ bills_total: 1180, bills_paid: 800 })).vendor_payable).toBe(380);
    expect(profitAndLoss(row({ approved_value: "abc" as unknown as string })).revenue_total).toBe(0);
  });

  it("is exact on awkward decimals", () => {
    const pl = profitAndLoss(row({ approved_value: "0.30", expense_cost: "0.10", reimbursement_cost: "0.10" }));
    expect(pl.gross_profit).toBe(0.1);
  });
});

describe("aggregateProjects", () => {
  it("sums projects, recomputes the margin from totals and counts loss-making projects", () => {
    const t = aggregateProjects([
      row({ approved_value: 100000, expense_cost: 50000 }),
      row({ approved_value: 20000, expense_cost: 30000 }),
      row({ approved_value: 0, expense_cost: 0 }),
    ]);
    expect(t.project_count).toBe(3);
    expect(t.revenue_total).toBe(120000);
    expect(t.cost_total).toBe(80000);
    expect(t.gross_profit).toBe(40000);
    expect(t.profit_margin).toBe(33.33); // 40000/120000, not the average of 50% and -50%
    expect(t.loss_projects).toBe(1);
  });
  it("handles no projects", () => {
    const t = aggregateProjects([]);
    expect(t.gross_profit).toBe(0);
    expect(t.profit_margin).toBeNull();
    expect(t.loss_projects).toBe(0);
  });
});

describe("budget alerts", () => {
  it("uses the 75%, 90% and over-budget thresholds", () => {
    expect(budgetAlert(1000, 749.99)).toBe("ok");
    expect(budgetAlert(1000, 750)).toBe("warning");
    expect(budgetAlert(1000, 899.99)).toBe("warning");
    expect(budgetAlert(1000, 900)).toBe("critical");
    expect(budgetAlert(1000, 1000)).toBe("critical");
    expect(budgetAlert(1000, 1000.01)).toBe("over");
    expect(budgetAlert(0, 0)).toBe("ok");
    expect(budgetAlert(0, 1)).toBe("over");
  });
});

describe("expense helpers", () => {
  it("computes line totals with half-up rounding", () => {
    expect(expenseTotals(2.5, 1000, 450)).toEqual({ subtotal: 2500, total: 2950 });
    expect(expenseTotals(3, "33.335", 0).subtotal).toBe(100.01);
    expect(expenseTotals("x", 10, 0)).toEqual({ subtotal: 0, total: 0 });
  });
  it("derives payment status", () => {
    expect(expensePaymentStatus(1000, 1000, "2020-01-01", "2026-11-01")).toBe("paid");
    expect(expensePaymentStatus(1000, 0, "2026-10-31", "2026-11-01")).toBe("overdue");
    expect(expensePaymentStatus(1000, 100, "2026-10-31", "2026-11-01")).toBe("overdue");
    expect(expensePaymentStatus(1000, 100, "2026-11-01", "2026-11-01")).toBe("partial");
    expect(expensePaymentStatus(1000, 0, null, "2026-11-01")).toBe("pending");
  });
});

describe("dashboard date ranges (IST, Monday weeks, Indian FY)", () => {
  it("resolves presets", () => {
    expect(resolveRange("today", "2026-11-04")).toEqual({ from: "2026-11-04", to: "2026-11-04" });
    expect(resolveRange("week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // Wednesday
    expect(resolveRange("week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // Sunday
    expect(resolveRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange("quarter", "2026-11-04")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolveRange("quarter", "2026-02-04")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(resolveRange("year", "2026-11-04")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(resolveRange("year", "2026-02-04")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(resolveRange("all", "2026-11-04")).toEqual({ from: null, to: null });
  });
  it("sanitises and orders a custom range", () => {
    expect(resolveRange("custom", "2026-11-04", { from: "2026-03-01", to: "2026-01-01" })).toEqual({ from: "2026-01-01", to: "2026-03-01" });
    expect(resolveRange("custom", "2026-11-04", { from: "junk", to: "2026-01-01" })).toEqual({ from: null, to: "2026-01-01" });
  });
});

import { buildPrefill, parseDateText } from "@/lib/finance/event";

describe("event details from invoices", () => {
  it("parses dates typed as free text", () => {
    expect(parseDateText("15/02/2027")).toEqual({ start: "2027-02-15", end: null });
    expect(parseDateText("15/02/2027 - 17/02/2027")).toEqual({ start: "2027-02-15", end: "2027-02-17" });
    expect(parseDateText("17-02-2027 to 15-02-2027")).toEqual({ start: "2027-02-15", end: "2027-02-17" });
    expect(parseDateText("15 Feb 2027")).toEqual({ start: "2027-02-15", end: null });
    expect(parseDateText("15th February 2027 to 17th February 2027")).toEqual({ start: "2027-02-15", end: "2027-02-17" });
    expect(parseDateText("15–17 Feb 2027")).toEqual({ start: "2027-02-15", end: "2027-02-17" });
    expect(parseDateText("31/02/2027")).toEqual({ start: null, end: null }); // not a real date
    expect(parseDateText("Q4 launch")).toEqual({ start: null, end: null });
    expect(parseDateText("")).toEqual({ start: null, end: null });
  });
  it("prefers the invoice, then the quotation, then the lead", () => {
    const p = buildPrefill({
      invoice: { number: "NAFA-INV-26-001", project_name: "", project_location: "", project_date_text: "", company_id: "c1", lead_id: "l1", quotation_id: "q1", ex_gst: 10000 },
      quotation: { event_type: "Product launch", event_name: "Dealer Meet", event_location: "JW Marriott, Mumbai", event_date_text: "15/02/2027" },
      lead: { title: "Lead title", event_date: "2027-03-01", venue: "Venue", city: "Pune", service_category: "brand_activation" },
    });
    expect(p).toMatchObject({ name: "Dealer Meet", company_id: "c1", lead_id: "l1", quotation_id: "q1", category: "Product launch", location: "JW Marriott, Mumbai", start_date: "2027-02-15", end_date: "", approved_value: "10000" });
    const fromLead = buildPrefill({ invoice: { number: null, ex_gst: 0 }, lead: { title: "Roadshow", venue: "Mall", city: "Pune", event_date: "2027-03-01", service_category: "btl_marketing" } });
    expect(fromLead).toMatchObject({ name: "Roadshow", location: "Mall, Pune", start_date: "2027-03-01", category: "BTL Marketing", approved_value: "" });
  });
});
