import type { SupabaseClient } from "@supabase/supabase-js";
import { profitAndLoss, type SummaryRow } from "@/lib/finance/calc";
import { formatINR } from "@/lib/format";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelInvoiceReminders } from "./repo";

/**
 * Side effects of money events: bell + push notifications, and stopping reminders that are no longer needed.
 * Every function here swallows its own errors: an alert must never make the payment or expense itself fail.
 */
export async function onInvoicePayment(supabase: SupabaseClient, invoiceId: string, amount: number): Promise<void> {
  try {
    const { data: i } = await supabase.from("invoice_list")
      .select("number, client_name, client_company, project_name, balance_due, due_date").eq("id", invoiceId).maybeSingle();
    if (!i) return;
    const balance = Number(i.balance_due);
    const full = balance <= 0.004;
    if (full) await cancelInvoiceReminders(supabase, invoiceId, "The invoice has been paid in full.");
    const who = `${i.client_company || i.client_name || "Client"} · ${i.number}${i.project_name ? ` · ${i.project_name}` : ""}`;
    await notify("finance", {
      type: full ? "payment_received" : "payment_partial",
      title: full ? `Payment received: ${i.number} is paid in full` : `Partial payment received on ${i.number}`,
      body: full ? `${who} · ${formatINR(amount, { exact: true })} received` : `${who} · ${formatINR(amount, { exact: true })} received · ${formatINR(balance, { exact: true })} pending${i.due_date ? ` · due ${i.due_date}` : ""}`,
      url: `/invoices/${invoiceId}`, tag: `invoice-${invoiceId}`,
      data: { invoice_id: invoiceId, invoice_number: i.number, amount, pending: balance, due_date: i.due_date },
    });
  } catch (e) {
    console.error("[payment alert]", e);
  }
}

export async function onInvoiceCancelled(supabase: SupabaseClient, invoiceId: string): Promise<void> {
  await cancelInvoiceReminders(supabase, invoiceId, "The invoice was cancelled.");
}

/**
 * New project expense: tells the finance team, and raises a budget / profitability warning the first time a line is crossed.
 * Read with the service client so the figures are complete even when the person entering the expense cannot see revenue.
 */
export async function onExpenseRecorded(e: { projectId: string; categoryId: string; title: string; total: number; by: string }): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: s }, { data: b }] = await Promise.all([
      admin.from("project_finance_summary").select("*").eq("project_id", e.projectId).maybeSingle(),
      admin.from("budget_status").select("category_name, budget, actual, alert").eq("project_id", e.projectId).eq("category_id", e.categoryId).maybeSingle(),
    ]);
    if (!s) return;
    const url = `/projects/${e.projectId}?tab=expenses`;
    await notify("finance", {
      type: "expense_recorded", title: `Expense recorded on ${s.name}`, body: `${e.title} · ${formatINR(e.total, { exact: true })} · entered by ${e.by}`, url, tag: `project-${e.projectId}`,
    });
    if (b?.alert === "over" && Number(b.budget) > 0) {
      await notify("finance", {
        type: "budget_exceeded", title: `Budget exceeded: ${s.name}`,
        body: `${b.category_name}: ${formatINR(b.actual, { exact: true })} spent against a budget of ${formatINR(b.budget, { exact: true })}.`,
        url: `/projects/${e.projectId}?tab=budget`, dedupeKey: `budget-over:${e.projectId}:${e.categoryId}`,
      });
    }
    const pl = profitAndLoss(s as SummaryRow);
    if (pl.revenue_total > 0 && (pl.is_loss || (pl.profit_margin !== null && pl.profit_margin < 10))) {
      await notify("finance", {
        type: "profit_warning", title: pl.is_loss ? `${s.name} is running at a loss` : `Low margin on ${s.name}`,
        body: `Revenue ${formatINR(pl.revenue_total, { exact: true })}, expenses ${formatINR(pl.cost_total, { exact: true })}, margin ${pl.profit_margin?.toFixed(1) ?? "—"}%.`,
        url: `/projects/${e.projectId}`, dedupeKey: `profit-${pl.is_loss ? "loss" : "low"}:${e.projectId}`,
      });
    }
  } catch (err) {
    console.error("[expense alert]", (err as Error).message);
  }
}
