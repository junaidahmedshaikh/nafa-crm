import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { ExportLink } from "@/components/shared/export-link";
import { FollowUpActions } from "@/components/followups/followup-actions";
import { StatusBadge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { FOLLOW_UP_TYPE_LABELS } from "@/lib/constants";
import { FOLLOW_UP_TABS, followUpTabCounts, listFollowUps, type FollowUpTab } from "@/lib/data/followups";
import { formatDateTime, isoToIstLocal, relativeDue } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const metadata = { title: "Follow-ups" };

const TAB_LABELS: Record<FollowUpTab, string> = { today: "Today", overdue: "Overdue", upcoming: "Upcoming", completed: "Completed" };
const EMPTY: Record<FollowUpTab, [string, string]> = {
  today: ["Nothing due today", "You’re all caught up for today."],
  overdue: ["No overdue follow-ups", "Everything due before today has been handled."],
  upcoming: ["No upcoming follow-ups", "Schedule follow-ups from a lead page."],
  completed: ["No completed follow-ups yet", "Completed tasks will be listed here."],
};

export default async function FollowUpsPage({ searchParams }: PageProps<"/followups">) {
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: FollowUpTab = FOLLOW_UP_TABS.includes(tabParam as FollowUpTab) ? (tabParam as FollowUpTab) : "today";
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page)) || 1);

  const { supabase } = await requireMember();
  const now = new Date();
  const [{ rows, total, pageSize }, counts] = await Promise.all([listFollowUps(supabase, tab, page, now), followUpTabCounts(supabase, now)]);
  const [emptyTitle, emptyText] = EMPTY[tab];

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Tasks are grouped by India time (IST). Completed tasks never appear as pending."
        actions={
          <ExportLink href="/api/export/followups" />
        }
      />
      <nav aria-label="Follow-up views" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {FOLLOW_UP_TABS.map((t) => {
          const count = t === "completed" ? null : counts[t];
          return (
            <Link
              key={t}
              href={`/followups?tab=${t}`}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium",
                t === tab ? "border-nav text-foreground" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {TAB_LABELS[t]}
              {count !== null && count > 0 && (
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", t === "overdue" ? "bg-danger-soft text-danger" : "bg-black/[0.06] text-foreground/70")}>{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={CalendarCheck} title={emptyTitle} description={emptyText} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {rows.map((f) => {
                const due = new Date(f.due_at);
                const late = f.status === "pending" && due < now;
                return (
                  <li key={f.id} className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-3.5", tab === "overdue" && "border-l-2 border-l-danger")}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>{FOLLOW_UP_TYPE_LABELS[f.type]}</span>
                        <span aria-hidden>·</span>
                        <Link href={`/leads/${f.lead_id}`} className="font-medium text-foreground hover:text-accent hover:underline">
                          {f.lead_title}{f.company_name ? ` — ${f.company_name}` : ""}
                        </Link>
                        <StatusBadge status={f.lead_status} />
                      </p>
                      {f.notes && <p className="mt-1 text-xs text-muted">{f.notes}</p>}
                    </div>
                    <div className="text-right">
                      {f.status === "completed" ? (
                        <p className="text-sm text-muted">Completed {formatDateTime(f.completed_at)}</p>
                      ) : (
                        <>
                          <p className={cn("text-sm tabular-nums", late ? "font-medium text-danger" : "text-foreground")}>{formatDateTime(f.due_at)}</p>
                          <p className={cn("text-xs", late ? "text-danger" : "text-muted")}>{relativeDue(f.due_at, now)}</p>
                        </>
                      )}
                    </div>
                    {f.status === "pending" && <FollowUpActions id={f.id} title={f.title} dueLocal={isoToIstLocal(f.due_at)} />}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/followups?tab=${tab}&page=${p}`} />
          </>
        )}
      </Card>
    </>
  );
}
