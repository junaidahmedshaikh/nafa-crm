import Link from "next/link";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { Card, CardHeader } from "@/components/ui/layout";
import { formatDate } from "@/lib/datetime";
import { formatINR } from "@/lib/format";
import type { Receivable } from "@/lib/scheduled/repo";
import { cn } from "@/lib/utils";

/** Dashboard card: invoices with money still to come in, most urgent first. Renders nothing when everything is paid. */
export function PendingPayments({ receivables }: { receivables: Receivable[] }) {
  if (!receivables.length) return null;
  const total = receivables.reduce((a, r) => a + r.balance_due, 0);
  const overdue = receivables.filter((r) => r.payment_status === "overdue").length;
  return (
    <Card className="mb-6">
      <CardHeader
        title={`Pending payments · ${formatINR(total, { exact: true })}`}
        action={<Link href="/payment-reminders" className="text-xs font-medium text-accent hover:underline">{overdue > 0 ? `${overdue} overdue · ` : ""}Reminders &rarr;</Link>}
      />
      <ul className="divide-y divide-border">
        {receivables.slice(0, 6).map((r) => (
          <li key={r.id}>
            <Link href={`/invoices/${r.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm hover:bg-surface-muted">
              <span className="min-w-0">
                <span className="font-medium">{r.client_company || r.client_name || "Client"}</span>
                <span className="text-muted"> · {r.number}{r.project_name ? ` · ${r.project_name}` : ""}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className={cn("text-xs", r.payment_status === "overdue" ? "font-medium text-danger" : "text-muted")}>{r.due_date ? `Due ${formatDate(r.due_date)}` : "No due date"}</span>
                <span className="font-semibold tabular-nums">{formatINR(r.balance_due, { exact: true })}</span>
                <DocStatusBadge status={r.payment_status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {receivables.length > 6 && <p className="border-t border-border px-5 py-2 text-xs text-muted">and {receivables.length - 6} more on the Payment Reminders page.</p>}
    </Card>
  );
}
