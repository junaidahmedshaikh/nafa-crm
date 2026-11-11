import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAnalytics, loadAnalyticsInput } from "@/lib/email/analytics";
import { classifyContacts, groupMembers, loadContactRows, loadGroups, loadStaticMembership, loadSuppressions, type GroupDef } from "@/lib/email/audience";

export type GroupSummary = {
  id: string; name: string; description: string; group_type: "static" | "dynamic"; business_category: string; target_industry: string; location: string;
  status: string; created_at: string; filter_conditions: Record<string, unknown>;
  contacts: number;       // members right now
  eligible: number;       // members who can actually be emailed (valid, not suppressed, de-duplicated by email)
  lastCampaignAt: string | null;
};

/** One pass over contacts + memberships + campaign history for every group (list page). */
export async function loadGroupSummaries(supabase: SupabaseClient): Promise<GroupSummary[]> {
  const [{ data: groups }, defs, rows, staticMap, suppressed, campaigns] = await Promise.all([
    supabase.from("recipient_groups").select("*").order("name").limit(1000),
    loadGroups(supabase), loadContactRows(supabase), loadStaticMembership(supabase), loadSuppressions(supabase),
    supabase.from("email_campaigns").select("audience, status, scheduled_at, completed_at, created_at").in("status", ["sending", "completed", "paused", "stopped"]).limit(1000),
  ]);
  const defById = new Map(defs.map((d) => [d.id, d]));
  const last = new Map<string, string>();
  for (const c of campaigns.data ?? []) {
    const when = c.completed_at ?? c.scheduled_at ?? c.created_at;
    for (const gid of ((c.audience ?? {}) as { groupIds?: string[] }).groupIds ?? []) if (!last.get(gid) || when > last.get(gid)!) last.set(gid, when);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (groups ?? []).map((g: any) => {
    const members = groupMembers(defById.get(g.id) as GroupDef, rows, staticMap);
    return { ...g, contacts: members.length, eligible: classifyContacts(members, suppressed).eligible.length, lastCampaignAt: last.get(g.id) ?? null } as GroupSummary;
  });
}

export async function loadGroupDetail(supabase: SupabaseClient, id: string) {
  const { data: g } = await supabase.from("recipient_groups").select("*").eq("id", id).maybeSingle();
  if (!g) return null;
  const [rows, staticMap, suppressed, input, campaigns] = await Promise.all([
    loadContactRows(supabase), loadStaticMembership(supabase), loadSuppressions(supabase), loadAnalyticsInput(supabase),
    supabase.from("email_campaigns").select("id, name, status, subject, audience, scheduled_at, created_at").order("created_at", { ascending: false }).limit(500),
  ]);
  const members = groupMembers(g as GroupDef, rows, staticMap);
  const cls = classifyContacts(members, suppressed);
  const ids = new Set(members.map((m) => m.id));
  const emails = new Set(members.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean));
  const recipients = input.recipients.filter((r) => r.contact_id && ids.has(r.contact_id));
  const rIds = new Set(recipients.map((r) => r.id));
  const analytics = buildAnalytics({
    ...input, recipients,
    events: input.events.filter((e) => e.recipient_id && rIds.has(e.recipient_id)),
    replies: input.replies.filter((r) => emails.has(r.from_normalized)),
  });
  const history = (campaigns.data ?? []).filter((c) => (((c.audience ?? {}) as { groupIds?: string[] }).groupIds ?? []).includes(id));
  return { group: g, members, eligible: cls.eligible.length, excluded: cls.excluded, totals: analytics.totals, history };
}
