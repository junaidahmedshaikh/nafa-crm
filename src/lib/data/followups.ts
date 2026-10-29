import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { istDayBounds } from "@/lib/datetime";
import { pageRange } from "@/lib/lead-filters";
import type { FollowUpRow } from "@/lib/types";

export const FOLLOW_UP_TABS = ["today", "overdue", "upcoming", "completed"] as const;
export type FollowUpTab = (typeof FOLLOW_UP_TABS)[number];

/**
 * Tab definitions (IST calendar days):
 *  - overdue:   pending, due before the start of today
 *  - today:     pending, due any time today (past-due times today are highlighted in the UI)
 *  - upcoming:  pending, due after today
 *  - completed: completed tasks, newest first
 */
export async function listFollowUps(supabase: SupabaseClient, tab: FollowUpTab, page: number, now = new Date()) {
  const { start, end } = istDayBounds(now);
  const [from, to] = pageRange(page);
  let q = supabase.from("follow_up_list").select("*", { count: "exact" });
  switch (tab) {
    case "overdue":
      q = q.eq("status", "pending").lt("due_at", start.toISOString()).order("due_at", { ascending: true });
      break;
    case "today":
      q = q.eq("status", "pending").gte("due_at", start.toISOString()).lt("due_at", end.toISOString()).order("due_at", { ascending: true });
      break;
    case "upcoming":
      q = q.eq("status", "pending").gte("due_at", end.toISOString()).order("due_at", { ascending: true });
      break;
    case "completed":
      q = q.eq("status", "completed").order("completed_at", { ascending: false });
      break;
  }
  const { data, count, error } = await q.range(from, to);
  if (error) throw new Error(`Could not load follow-ups: ${error.message}`);
  return { rows: (data ?? []) as FollowUpRow[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function followUpTabCounts(supabase: SupabaseClient, now = new Date()) {
  const { start, end } = istDayBounds(now);
  const base = () => supabase.from("follow_up_list").select("id", { count: "exact", head: true });
  const [overdue, today, upcoming] = await Promise.all([
    base().eq("status", "pending").lt("due_at", start.toISOString()),
    base().eq("status", "pending").gte("due_at", start.toISOString()).lt("due_at", end.toISOString()),
    base().eq("status", "pending").gte("due_at", end.toISOString()),
  ]);
  return { overdue: overdue.count ?? 0, today: today.count ?? 0, upcoming: upcoming.count ?? 0 };
}
