import type { SupabaseClient } from "@supabase/supabase-js";
import { analyse } from "@/lib/bdm/engine";
import type { ActivityFact, BdmInput, BdmSettingsFact, BriefingData, DocFact, FollowUpFact, LeadFact } from "@/lib/bdm/types";

export type BdmSettingsRow = {
  enabled: boolean;
  briefing_time: string; // HH:MM:SS (IST)
  email_enabled: boolean;
  email_recipients: string[];
  inactive_days: number;
  proposal_followup_days: number;
};

export const DEFAULT_BDM_SETTINGS: BdmSettingsRow = {
  enabled: true, briefing_time: "08:30:00", email_enabled: false, email_recipients: [], inactive_days: 30, proposal_followup_days: 3,
};

export async function loadBdmSettings(supabase: SupabaseClient): Promise<BdmSettingsRow> {
  const { data } = await supabase.from("bdm_settings").select("*").maybeSingle();
  return (data as BdmSettingsRow | null) ?? DEFAULT_BDM_SETTINGS;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Reads the CRM through whichever client it is given. With a signed-in user's client the user's RLS applies;
 * the scheduled job passes the service-role client. Throws on query errors so a failed run is visible, not silently empty.
 */
export async function loadBdmInput(supabase: SupabaseClient, settings: BdmSettingsRow, now = new Date()): Promise<BdmInput> {
  const since = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString();
  const [leadsRes, companiesRes, fuRes, meetRes, actRes, quoRes, propRes] = await Promise.all([
    supabase.from("lead_list").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(1000),
    supabase.from("companies").select("id, industry").is("archived_at", null).limit(1000),
    supabase.from("follow_ups").select("id, lead_id, type, title, due_at").eq("status", "pending").limit(1000),
    supabase.from("follow_ups").select("lead_id, completed_at").eq("status", "completed").eq("type", "meeting").limit(1000),
    supabase.from("lead_activities").select("lead_id, type, created_at").in("type", ["reply_received", "message_sent", "follow_up_completed"]).gte("created_at", since).limit(3000),
    supabase.from("quotations").select("id, number, lead_id, client_company, status, sent_at, valid_until, grand_total").in("status", ["sent", "revised"]).limit(500),
    supabase.from("proposals").select("id, number, lead_id, client_company, status, sent_at").in("status", ["sent", "revised"]).limit(500),
  ]);
  for (const r of [leadsRes, companiesRes, fuRes, meetRes, actRes, quoRes, propRes]) if (r.error) throw new Error(`CRM read failed: ${r.error.message}`);

  const industry = new Map((companiesRes.data ?? []).map((c: { id: string; industry: string | null }) => [c.id, c.industry]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leads: LeadFact[] = (leadsRes.data ?? []).map((l: any) => ({
    id: l.id, number: l.lead_number, title: l.title, companyId: l.company_id, companyName: l.company_name,
    industry: (l.company_id && industry.get(l.company_id)) || null,
    contactName: l.contact_name, contactDesignation: l.contact_designation, contactEmail: l.contact_email,
    contactPhone: l.contact_phone, contactWhatsapp: l.contact_whatsapp, source: l.source, serviceCategory: l.service_category,
    eventName: l.event_name, eventDate: l.event_date, city: l.city, budget: num(l.budget_inr), expectedRevenue: num(l.expected_revenue_inr),
    status: l.status, priority: l.priority, assignedTo: l.assigned_to, assignedName: l.assigned_name,
    lastContactAt: l.last_contact_at, nextFollowUpAt: l.next_follow_up_at, createdAt: l.created_at, closedAt: l.closed_at,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const followUps: FollowUpFact[] = (fuRes.data ?? []).map((f: any) => ({ id: f.id, leadId: f.lead_id, type: f.type, title: f.title, dueAt: f.due_at }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedMeetings = (meetRes.data ?? []).map((m: any) => ({ leadId: m.lead_id, at: m.completed_at }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities: ActivityFact[] = (actRes.data ?? []).map((a: any) => ({ leadId: a.lead_id, type: a.type, createdAt: a.created_at }));
  const docs: DocFact[] = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(quoRes.data ?? []).map((q: any): DocFact => ({ kind: "quotation", id: q.id, number: q.number, leadId: q.lead_id, companyName: q.client_company, status: q.status, sentAt: q.sent_at, validUntil: q.valid_until, amount: num(q.grand_total) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(propRes.data ?? []).map((p: any): DocFact => ({ kind: "proposal", id: p.id, number: p.number, leadId: p.lead_id, companyName: p.client_company, status: p.status, sentAt: p.sent_at, validUntil: null, amount: null })),
  ];
  const s: BdmSettingsFact = { inactiveDays: settings.inactive_days, proposalFollowupDays: settings.proposal_followup_days };
  return { now, settings: s, leads, followUps, completedMeetings, activities, docs };
}

export async function buildBriefingData(supabase: SupabaseClient, now = new Date()): Promise<{ data: BriefingData; settings: BdmSettingsRow }> {
  const settings = await loadBdmSettings(supabase);
  const input = await loadBdmInput(supabase, settings, now);
  return { data: analyse(input), settings };
}
