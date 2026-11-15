import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/layout";
import type { BusinessBriefing } from "@/lib/briefing/core";
import { cn } from "@/lib/utils";

const safe = (href?: string) => (href && href.startsWith("/") && !href.startsWith("//") ? href : null);

/** The full report, as stored. Sections with nothing recorded say "No updates" rather than disappearing. */
export function BriefingView({ briefing: b, summary }: { briefing: BusinessBriefing; summary: string }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Good Morning – Executive Summary" />
        <p className="whitespace-pre-line p-5 text-sm leading-relaxed">{summary}</p>
        <div className="grid gap-3 border-t border-border p-5 sm:grid-cols-2 lg:grid-cols-4">
          {b.headline.map((h) => (
            <div key={h.label} className="rounded-lg border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{h.label}</p>
              <p className={cn("mt-1 text-lg font-semibold tabular-nums", h.tone === "bad" && "text-danger", h.tone === "good" && "text-success")}>{h.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Today's Recommended Action Plan" />
        {b.actionPlan.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No updates</p> : (
          <ol className="divide-y divide-border">
            {b.actionPlan.map((p, i) => {
              const href = safe(p.href);
              return (
                <li key={i} className="flex gap-3 px-5 py-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                  <div className="min-w-0">
                    <p>{href ? <Link href={href} className="font-semibold hover:text-accent hover:underline">{p.title}</Link> : <span className="font-semibold">{p.title}</span>} — {p.action}</p>
                    <p className="text-xs text-muted">Why: {p.reason}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {b.sections.map((s) => (
          <Card key={s.key}>
            <CardHeader title={s.title} action={s.more && safe(s.more.href) ? <Link href={s.more.href} className="text-xs font-medium text-accent hover:underline">{s.more.label} &rarr;</Link> : undefined} />
            {s.items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No updates</p> : (
              <ul className="divide-y divide-border">
                {s.items.map((i, n) => {
                  const href = safe(i.href);
                  const body = (
                    <>
                      <p className="text-sm">{i.priority === "high" && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger align-middle" aria-label="High priority" />}<span className="font-medium">{i.title}</span></p>
                      {i.detail && <p className="text-xs text-muted">{i.detail}</p>}
                    </>
                  );
                  return <li key={n}>{href ? <Link href={href} className="block px-5 py-2.5 hover:bg-surface-muted">{body}</Link> : <div className="px-5 py-2.5">{body}</div>}</li>;
                })}
              </ul>
            )}
            {s.note && <p className="border-t border-border px-5 py-2 text-xs text-muted">{s.note}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
