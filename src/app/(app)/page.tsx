import Link from "next/link";
import { ArrowUpRight, CalendarClock, Inbox, Plus, Target } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import {
  LEAD_STATUS_LABELS, OPEN_STATUSES, PROPOSAL_STATUSES, QUALIFIED_STATUSES, FOLLOW_UP_TYPE_LABELS,
} from "@/lib/constants";
import { getDashboardData } from "@/lib/data/dashboard";
import { formatDate, formatDateTime, istDayBounds, relativeDue } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function Metric({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "danger" | "warning" }) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted"
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <ArrowUpRight className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </div>
      <p className={cn("mt-2 text-3xl font-semibold tabular-nums", tone === "danger" && value > 0 && "text-danger", tone === "warning" && value > 0 && "text-warning")}>
        {value}
      </p>
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
        description={`Sales overview · ${formatDate(now)}`}
        actions={<LinkButton href="/leads/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New lead</LinkButton>}
      />

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
          <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Active leads" value={d.metrics.activeLeads} href={`/leads?status=${OPEN_STATUSES.join(",")}`} />
            <Metric label="New this month" value={d.metrics.newThisMonth} href={`/leads?from=${d.monthStartDate}`} />
            <Metric label="Qualified opportunities" value={d.metrics.qualified} href={`/leads?status=${QUALIFIED_STATUSES.join(",")}`} />
            <Metric label="Proposals pending" value={d.metrics.proposalsPending} href={`/leads?status=${PROPOSAL_STATUSES.join(",")}`} />
            <Metric label="Won this month" value={d.metrics.wonThisMonth} href={`/leads?status=won&closed_from=${d.monthStartDate}`} />
            <Metric label="Overdue follow-ups" value={d.metrics.overdueFollowUps} href="/followups?tab=overdue" tone="danger" />
            <Metric label="Follow-ups due today" value={d.metrics.dueToday} href="/followups?tab=today" tone="warning" />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-1">
              <CardHeader title="Pipeline by status" />
              <ul className="space-y-1 p-3">
                {d.pipeline.map((p) => (
                  <li key={p.status}>
                    <Link href={`/leads?status=${p.status}`} className="block rounded-md px-2 py-1.5 hover:bg-surface-muted">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{LEAD_STATUS_LABELS[p.status]}</span>
                        <span className="tabular-nums font-medium">{p.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-black/5" aria-hidden>
                        <div
                          className={cn("h-full rounded-full", p.status === "won" ? "bg-success" : p.status === "lost" ? "bg-danger/60" : "bg-nav")}
                          style={{ width: `${(p.count / maxCount) * 100}%` }}
                        />
                      </div>
                      {p.revenue > 0 && <p className="mt-0.5 text-xs text-muted">Expected {formatINR(p.revenue)}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader title="Upcoming follow-ups" action={<Link href="/followups" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
              {d.upcomingFollowUps.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Schedule follow-ups from a lead to see them here." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.upcomingFollowUps.map((f) => {
                    const overdue = new Date(f.due_at) < now;
                    const today = new Date(f.due_at) < todayEnd;
                    return (
                      <li key={f.id}>
                        <Link href={`/leads/${f.lead_id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-muted">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{f.title}</p>
                            <p className="truncate text-xs text-muted">
                              {FOLLOW_UP_TYPE_LABELS[f.type]} · {f.lead_title}{f.company_name ? ` · ${f.company_name}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn("text-sm tabular-nums", overdue ? "font-medium text-danger" : today ? "text-warning" : "text-foreground")}>
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
            <CardHeader title="Recently added leads" action={<Link href="/leads" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
            <ul className="divide-y divide-border">
              {d.recentLeads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-muted">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.title}</p>
                      <p className="truncate text-xs text-muted">
                        {formatLeadNumber(l.lead_number)} · {l.company_name ?? l.contact_name ?? "No company"} · added {formatDate(l.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="hidden text-sm tabular-nums sm:inline">{formatINR(l.expected_revenue_inr)}</span>
                      <StatusBadge status={l.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {d.totalLeads === 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><Target className="h-3.5 w-3.5" aria-hidden />All figures on this page are calculated live from your database.</p>
      )}
    </>
  );
}
