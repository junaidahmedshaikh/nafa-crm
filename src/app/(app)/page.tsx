import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  Clock,
  FileCheck2,
  FileClock,
  FileText,
  Inbox,
  Plus,
  ReceiptText,
  Target,
  Wallet,
} from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import {
  LEAD_STATUS_LABELS,
  OPEN_STATUSES,
  FOLLOW_UP_TYPE_LABELS,
} from "@/lib/constants";
import { getDashboardData } from "@/lib/data/dashboard";
import { formatDate, formatDateTime, istDayBounds, relativeDue } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function Metric({
  label,
  value,
  href,
  tone,
  icon: Icon,
  subtitle,
}: {
  label: string;
  value: number | string;
  href: string;
  tone?: "danger" | "warning" | "success" | "accent";
  icon?: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col justify-between rounded-xl border border-border bg-surface p-4.5 transition-all hover:border-border-strong hover:bg-surface-muted/60 shadow-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md border",
                tone === "danger"
                  ? "border-danger/20 bg-danger-soft text-danger"
                  : tone === "warning"
                  ? "border-warning/20 bg-warning-soft text-warning"
                  : tone === "success"
                  ? "border-success/20 bg-success-soft text-success"
                  : tone === "accent"
                  ? "border-accent/20 bg-accent-soft text-accent"
                  : "border-border bg-surface-muted text-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
          )}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        </div>
        <ArrowUpRight
          className="h-4 w-4 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
          aria-hidden
        />
      </div>
      <div className="mt-3">
        <p
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums",
            tone === "danger" && value !== 0 && "text-danger",
            tone === "warning" && value !== 0 && "text-warning",
            tone === "success" && "text-success",
          )}
        >
          {value}
        </p>
        {subtitle && <p className="mt-0.5 text-xs text-muted truncate">{subtitle}</p>}
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const { supabase } = await requireMember();
  const d = await getDashboardData(supabase);
  const now = new Date();
  const { end: todayEnd } = istDayBounds(now);
  const maxCount = Math.max(1, ...d.pipeline.map((p) => p.count));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Business overview & sales pipeline · ${formatDate(now)}`}
        actions={
          <div className="flex items-center gap-2">
            <LinkButton href="/leads/new" variant="primary">
              <Plus className="h-4 w-4" aria-hidden />
              <span>New lead</span>
            </LinkButton>
            <LinkButton href="/quotations/new" variant="secondary">
              <FileText className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">New quotation</span>
            </LinkButton>
          </div>
        }
      />

      {/* Financial & Document Metrics */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Documents &amp; Cashflow</h2>
          <Link href="/payments" className="text-xs text-accent hover:underline font-medium">
            View payments &rarr;
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Total Received"
            value={formatINR(d.metrics.totalReceived, { exact: true })}
            href="/payments"
            icon={Wallet}
            tone="success"
            subtitle="Recorded payments"
          />
          <Metric
            label="Invoices Due"
            value={d.metrics.invoicesOutstanding}
            href="/invoices?status=issued"
            icon={ReceiptText}
            subtitle="Awaiting client payment"
          />
          <Metric
            label="Overdue Invoices"
            value={d.metrics.invoicesOverdue}
            href="/invoices?status=overdue"
            icon={Clock}
            tone={d.metrics.invoicesOverdue > 0 ? "danger" : undefined}
            subtitle={d.metrics.invoicesOverdue > 0 ? "Action required" : "All current"}
          />
          <Metric
            label="Awaiting Response"
            value={d.metrics.quotationsAwaiting}
            href="/quotations?status=sent"
            icon={FileClock}
            subtitle="Quotations sent"
          />
          <Metric
            label="Accepted Quotes"
            value={d.metrics.quotationsAccepted}
            href="/quotations?status=accepted"
            icon={FileCheck2}
            tone="accent"
            subtitle="Ready to invoice"
          />
        </div>
      </div>

      {/* CRM & Sales Metrics */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Sales Pipeline &amp; Tasks</h2>
          <Link href="/leads" className="text-xs text-accent hover:underline font-medium">
            View all leads &rarr;
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Active Leads"
            value={d.metrics.activeLeads}
            href={`/leads?status=${OPEN_STATUSES.join(",")}`}
            icon={Target}
            subtitle="Open opportunities"
          />
          <Metric
            label="New This Month"
            value={d.metrics.newThisMonth}
            href={`/leads?from=${d.monthStartDate}`}
            icon={Plus}
            subtitle={`Since ${formatDate(d.monthStartDate)}`}
          />
          <Metric
            label="Follow-ups Due Today"
            value={d.metrics.dueToday}
            href="/followups?tab=today"
            icon={CalendarClock}
            tone={d.metrics.dueToday > 0 ? "warning" : undefined}
            subtitle="Scheduled for today"
          />
          <Metric
            label="Overdue Follow-ups"
            value={d.metrics.overdueFollowUps}
            href="/followups?tab=overdue"
            icon={Clock}
            tone={d.metrics.overdueFollowUps > 0 ? "danger" : undefined}
            subtitle={d.metrics.overdueFollowUps > 0 ? "Requires attention" : "All cleared"}
          />
        </div>
      </div>

      {d.totalLeads === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="No leads yet"
            description="Add your first lead, or import an existing list from a spreadsheet. Your dashboard will fill in as you work."
            action={
              <div className="flex gap-2">
                <LinkButton href="/leads/new" variant="primary">Add a lead</LinkButton>
                <LinkButton href="/leads/import">Import from CSV</LinkButton>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-1">
              <CardHeader title="Pipeline by Status" action={<span className="text-xs text-muted font-normal">{d.totalLeads} total</span>} />
              <ul className="space-y-1 p-3">
                {d.pipeline.map((p) => (
                  <li key={p.status}>
                    <Link href={`/leads?status=${p.status}`} className="block rounded-lg px-2.5 py-2 hover:bg-surface-muted transition-colors">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-foreground">{LEAD_STATUS_LABELS[p.status]}</span>
                        <span className="tabular-nums font-semibold text-foreground">{p.count}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-foreground/5 overflow-hidden" aria-hidden>
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            p.status === "won" ? "bg-success" : p.status === "lost" ? "bg-danger/60" : "bg-nav",
                          )}
                          style={{ width: `${(p.count / maxCount) * 100}%` }}
                        />
                      </div>
                      {p.revenue > 0 && <p className="mt-1 text-xs text-muted">Expected {formatINR(p.revenue)}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader
                title="Upcoming Follow-ups"
                action={
                  <Link href="/followups" className="text-xs font-semibold text-accent hover:underline">
                    View all &rarr;
                  </Link>
                }
              />
              {d.upcomingFollowUps.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Schedule follow-ups from a lead to see them here." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.upcomingFollowUps.map((f) => {
                    const overdue = new Date(f.due_at) < now;
                    const today = new Date(f.due_at) < todayEnd;
                    return (
                      <li key={f.id}>
                        <Link href={`/leads/${f.lead_id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-muted transition-colors">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{f.title}</p>
                            <p className="truncate text-xs text-muted">
                              {FOLLOW_UP_TYPE_LABELS[f.type]} · {f.lead_title}{f.company_name ? ` · ${f.company_name}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn("text-sm font-medium tabular-nums", overdue ? "text-danger" : today ? "text-warning" : "text-foreground")}>
                              {formatDateTime(f.due_at)}
                            </p>
                            <p className="text-xs text-muted">{relativeDue(f.due_at, now)}</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader
              title="Recently Added Leads"
              action={
                <Link href="/leads" className="text-xs font-semibold text-accent hover:underline">
                  View all leads &rarr;
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {d.recentLeads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-muted transition-colors">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{l.title}</p>
                      <p className="truncate text-xs text-muted">
                        {formatLeadNumber(l.lead_number)} · {l.company_name ?? l.contact_name ?? "No company"} · added {formatDate(l.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="hidden text-sm font-medium tabular-nums sm:inline text-foreground">{formatINR(l.expected_revenue_inr)}</span>
                      <StatusBadge status={l.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}