import { Card, CardHeader } from "@/components/ui/layout";
import type { CostGroup } from "@/lib/finance/calc";
import { formatDate } from "@/lib/datetime";
import { formatINR } from "@/lib/format";

/** The expense lines behind a project's "Total expenses", grouped by category, each by its title. */
export function PnlExpenseDetail({ groups, total, itemCount, budgetBy }: { groups: CostGroup[]; total: number; itemCount: number; budgetBy: Map<string, number> }) {
  return (
    <Card>
      <CardHeader title="Expense details in this Profit & Loss" action={<span className="text-xs text-muted">{itemCount} item{itemCount === 1 ? "" : "s"} · GST-exclusive</span>} />
      {groups.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No approved expenses yet. Add one with “Quick add expense”; it appears here by title once approved.</p>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => {
            const budget = budgetBy.get(g.category_id) ?? 0;
            const over = budget > 0 && g.total > budget;
            return (
              <details key={g.category_id} open>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-surface-muted px-5 py-2.5 text-sm font-semibold">
                  <span>
                    {g.category_name}{" "}
                    <span className="font-normal text-muted">· {g.lines.length} item{g.lines.length === 1 ? "" : "s"}{g.share_pct != null ? ` · ${g.share_pct}% of expenses` : ""}</span>
                  </span>
                  <span className="tabular-nums">
                    {formatINR(g.total, { exact: true })}
                    {budget > 0 && <span className={`ml-2 text-xs font-normal ${over ? "text-danger" : "text-muted"}`}>of {formatINR(budget)} budget</span>}
                  </span>
                </summary>
                <ul className="divide-y divide-border">
                  {g.lines.map((l) => (
                    <li key={`${l.source}-${l.id}`} className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {l.title}
                          {l.source === "reimbursement" && <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">Reimbursement</span>}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(l.date)}
                          {l.vendor ? ` · ${l.vendor}` : ""}
                          {l.note && l.source === "expense" ? ` · ${l.note}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        {formatINR(l.amount, { exact: true })}
                        {Number(l.gst_recoverable) > 0 && <p className="text-[11px] text-muted">GST {formatINR(l.gst_recoverable, { exact: true })} recoverable, not counted</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
          <div className="flex items-center justify-between px-5 py-3 text-sm font-semibold">
            <span>Total expenses</span>
            <span className="tabular-nums">{formatINR(total, { exact: true })}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
