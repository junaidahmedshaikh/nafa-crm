import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardHeader } from "@/components/ui/layout";
import type { BusinessBriefing } from "@/lib/briefing/core";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * Dashboard card: the latest stored briefing (today's when it has run). Shows nothing for people who may not read
 * briefings (RLS returns no row) or before the first one exists.
 */
export async function DashboardBriefing({ supabase }: { supabase: SupabaseClient }) {
  const { data } = await supabase.from("daily_briefings").select("id, briefing_date, data").order("generated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const b = data.data as BusinessBriefing;
  if (!b?.headline || !b.actionPlan) return null;
  const href = `/briefing/${data.id}`;
  return (
    <Card className="mb-6">
      <CardHeader title={`Daily Briefing · ${formatDate(data.briefing_date)}`} action={<Link href={href} className="text-xs font-medium text-accent hover:underline">View Full Briefing &rarr;</Link>} />
      <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        {b.headline.map((h) => (
          <div key={h.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{h.label}</p>
            <p className={cn("text-base font-semibold tabular-nums", h.tone === "bad" && "text-danger", h.tone === "good" && "text-success")}>{h.value}</p>
          </div>
        ))}
      </div>
      {b.actionPlan.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No urgent actions were found in the CRM records.</p> : (
        <ol className="divide-y divide-border">
          {b.actionPlan.slice(0, 5).map((p, i) => {
            const ok = p.href?.startsWith("/") && !p.href.startsWith("//");
            const body = <><span className="font-medium">{i + 1}. {p.title}</span> — {p.action}<span className="block text-xs text-muted">{p.reason}</span></>;
            return <li key={i} className="text-sm">{ok ? <Link href={p.href!} className="block px-5 py-2.5 hover:bg-surface-muted">{body}</Link> : <div className="px-5 py-2.5">{body}</div>}</li>;
          })}
        </ol>
      )}
    </Card>
  );
}
