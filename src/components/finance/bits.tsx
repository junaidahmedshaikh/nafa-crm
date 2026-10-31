import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState } from "@/components/ui/layout";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetAlert } from "@/lib/finance/calc";
import { BUDGET_ALERT_LABEL } from "@/lib/finance/calc";
import { PROJECT_STATUS_LABELS } from "@/lib/finance/schemas";

type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

export function StatCard({ label, value, hint, tone = "neutral", href }: { label: string; value: string; hint?: string; tone?: "neutral" | "good" | "bad"; href?: string }) {
  const inner = (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-1.5 text-xl font-semibold tabular-nums tracking-tight", tone === "good" && "text-success", tone === "bad" && "text-danger")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}

/** Profit in green, loss in red, zero neutral. */
export function Profit({ value, exact = true, className }: { value: number; exact?: boolean; className?: string }) {
  return <span className={cn("tabular-nums", value > 0 && "text-success", value < 0 && "text-danger", className)}>{formatINR(value, { exact })}</span>;
}
export const pctText = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

const PAY_TONE: Record<string, Tone> = { paid: "success", partial: "warning", pending: "neutral", overdue: "danger" };
const PAY_LABEL: Record<string, string> = { paid: "Paid", partial: "Partially paid", pending: "Pending", overdue: "Overdue" };
export const PaymentStatusBadge = ({ status }: { status: string }) => <Badge tone={PAY_TONE[status] ?? "neutral"}>{PAY_LABEL[status] ?? status}</Badge>;

const APPROVAL_TONE: Record<string, Tone> = { approved: "success", submitted: "warning", rejected: "danger", reimbursed: "info" };
export const ApprovalBadge = ({ status }: { status: string }) => <Badge tone={APPROVAL_TONE[status] ?? "neutral"}>{status[0].toUpperCase() + status.slice(1)}</Badge>;

const PROJECT_TONE: Record<string, Tone> = { planning: "neutral", confirmed: "info", in_progress: "accent", completed: "success", settled: "success", cancelled: "danger" };
export const ProjectStatusBadge = ({ status }: { status: string }) => <Badge tone={PROJECT_TONE[status] ?? "neutral"}>{PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] ?? status}</Badge>;

const ALERT_TONE: Record<BudgetAlert, Tone> = { ok: "neutral", warning: "warning", critical: "danger", over: "danger" };
export const BudgetAlertBadge = ({ alert }: { alert: BudgetAlert }) => <Badge tone={ALERT_TONE[alert]}>{BUDGET_ALERT_LABEL[alert]}</Badge>;

export function NoFinanceAccess() {
  return (
    <Card>
      <EmptyState
        icon={Lock}
        title="Financial data is restricted"
        description="Your account has not been given access to project finances. Ask an administrator to assign you a finance role."
      />
    </Card>
  );
}

export function Meter({ pct, alert }: { pct: number | null; alert: BudgetAlert }) {
  const w = Math.min(100, Math.max(0, pct ?? (alert === "over" ? 100 : 0)));
  const color = alert === "over" || alert === "critical" ? "var(--danger)" : alert === "warning" ? "var(--warning)" : "var(--success)";
  return <div className="h-1.5 w-full min-w-16 rounded-full bg-foreground/5"><div className="h-1.5 rounded-full" style={{ width: `${w}%`, background: color }} /></div>;
}
