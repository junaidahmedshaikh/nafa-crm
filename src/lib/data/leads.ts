import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { applyLeadFilters, pageRange, type LeadFilters } from "@/lib/lead-filters";
import type { FollowUp, Lead, LeadActivity } from "@/lib/types";

export async function listLeads(supabase: SupabaseClient, filters: LeadFilters) {
  const [from, to] = pageRange(filters.page);
  const query = applyLeadFilters(supabase.from("lead_list").select("*", { count: "exact" }), filters).range(from, to);
  const { data, count, error } = await query;
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return { rows: (data ?? []) as Lead[], total: count ?? 0, pageSize: PAGE_SIZE };
}

/** Every lead matching the filters (used by CSV export), fetched in pages. */
export async function listAllLeads(supabase: SupabaseClient, filters: LeadFilters, cap = 10_000) {
  const out: Lead[] = [];
  for (let offset = 0; offset < cap; offset += 1000) {
    const { data, error } = await applyLeadFilters(supabase.from("lead_list").select("*"), filters).range(offset, offset + 999);
    if (error) throw new Error(`Could not export leads: ${error.message}`);
    out.push(...((data ?? []) as Lead[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getLead(supabase: SupabaseClient, id: string): Promise<Lead | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("lead_list").select("*").eq("id", id).maybeSingle();
  return (data as Lead | null) ?? null;
}

export async function getLeadActivities(supabase: SupabaseClient, leadId: string): Promise<LeadActivity[]> {
  const { data } = await supabase
    .from("lead_activities")
    .select("*, author:profiles(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as unknown as LeadActivity[];
}

export async function getLeadFollowUps(supabase: SupabaseClient, leadId: string): Promise<FollowUp[]> {
  const { data } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("lead_id", leadId)
    .order("status", { ascending: true })
    .order("due_at", { ascending: true });
  return (data ?? []) as FollowUp[];
}
