import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEAD_STATUSES, OPEN_STATUSES, PROPOSAL_STATUSES, QUALIFIED_STATUSES, type LeadStatus,
} from "@/lib/constants";
import { istMonthStart } from "@/lib/datetime";
import { followUpTabCounts } from "@/lib/data/followups";
import type { FollowUpRow, Lead } from "@/lib/types";

export type DashboardData = {
  metrics: {
    activeLeads: number;
    newThisMonth: number;
    qualified: number;
    proposalsPending: number;
    wonThisMonth: number;
    overdueFollowUps: number;
    dueToday: number;
  };
  pipeline: { status: LeadStatus; count: number; revenue: number }[];
  recentLeads: Lead[];
  upcomingFollowUps: FollowUpRow[];
  monthStartDate: string; // YYYY-MM-DD in IST, for drill-down links
  totalLeads: number;
};

export async function getDashboardData(supabase: SupabaseClient, now = new Date()): Promise<DashboardData> {
  const monthStart = istMonthStart(now);
  const leadCount = () => supabase.from("leads").select("id", { count: "exact", head: true }).is("archived_at", null);

  const [active, created, qualified, proposals, won, followCounts, pipelineRes, recent, upcoming, total] = await Promise.all([
    leadCount().in("status", OPEN_STATUSES),
    leadCount().gte("created_at", monthStart.toISOString()),
    leadCount().in("status", QUALIFIED_STATUSES),
    leadCount().in("status", PROPOSAL_STATUSES),
    leadCount().eq("status", "won").gte("closed_at", monthStart.toISOString()),
    followUpTabCounts(supabase, now),
    supabase.from("pipeline_summary").select("*"),
    supabase.from("lead_list").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(6),
    supabase
      .from("follow_up_list")
      .select("*")
      .eq("status", "pending")
      .order("due_at", { ascending: true })
      .limit(8),
    leadCount(),
  ]);

  const byStatus = new Map<string, { count: number; revenue: number }>();
  for (const r of (pipelineRes.data ?? []) as { status: string; lead_count: number; expected_revenue_inr: number | string }[]) {
    byStatus.set(r.status, { count: r.lead_count, revenue: Number(r.expected_revenue_inr) });
  }

  const ist = new Date(monthStart.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    metrics: {
      activeLeads: active.count ?? 0,
      newThisMonth: created.count ?? 0,
      qualified: qualified.count ?? 0,
      proposalsPending: proposals.count ?? 0,
      wonThisMonth: won.count ?? 0,
      overdueFollowUps: followCounts.overdue,
      dueToday: followCounts.today,
    },
    pipeline: LEAD_STATUSES.map((status) => ({
      status,
      count: byStatus.get(status)?.count ?? 0,
      revenue: byStatus.get(status)?.revenue ?? 0,
    })),
    recentLeads: (recent.data ?? []) as Lead[],
    upcomingFollowUps: (upcoming.data ?? []) as FollowUpRow[],
    monthStartDate: ist,
    totalLeads: total.count ?? 0,
  };
}
