import type { SupabaseClient } from "@supabase/supabase-js";
import { POSITIVE } from "@/lib/email/reply-categories";

export type AnalyticsInput = {
  campaigns: { id: string; name: string; subject: string; template_id: string | null }[];
  variants: { campaign_id: string; label: string; subject: string }[];
  recipients: { id: string; campaign_id: string; email_normalized: string; contact_id: string | null; status: string; step: number; variant: string | null }[];
  events: { recipient_id: string | null; type: string }[];
  replies: { campaign_id: string | null; from_normalized: string; category: string | null; lead_id: string | null }[];
  leads: { id: string; status: string }[];
  contacts: { id: string; industry: string | null; city: string | null; categories: string[] }[];
  templates: { id: string; name: string }[];
};

export type Metrics = {
  recipients: number;       // people we actually emailed (at least one email sent)
  emailsSent: number;       // all emails sent, including follow-ups
  delivered: number; bounced: number; opened: number; clicked: number;
  replies: number; positive: number; meetings: number; leads: number; opportunities: number; won: number;
};
export type Row = { key: string; label: string } & Metrics;

const empty = (): Metrics => ({ recipients: 0, emailsSent: 0, delivered: 0, bounced: 0, opened: 0, clicked: 0, replies: 0, positive: 0, meetings: 0, leads: 0, opportunities: 0, won: 0 });
const OPPORTUNITY = ["qualified", "brief_received", "proposal_in_progress", "proposal_sent", "negotiation", "won"];
export const MIN_SAMPLE = 30;

type Person = { campaign: string; variant: string | null; contact: string | null; sent: boolean; emails: number; delivered: boolean; bounced: boolean; opened: boolean; clicked: boolean; replyCats: string[]; leadIds: string[] };

export function buildAnalytics(d: AnalyticsInput) {
  const people = new Map<string, Person>();
  const byRecipient = new Map<string, string>();
  const keyOf = (campaign: string, email: string) => `${campaign}|${email}`;
  for (const r of d.recipients) {
    const k = keyOf(r.campaign_id, r.email_normalized);
    byRecipient.set(r.id, k);
    const p = people.get(k) ?? { campaign: r.campaign_id, variant: r.variant, contact: r.contact_id, sent: false, emails: 0, delivered: false, bounced: false, opened: false, clicked: false, replyCats: [], leadIds: [] };
    if (r.step === 0) { p.variant = r.variant; p.contact = r.contact_id; }
    if (r.status === "sent") { p.sent = true; p.emails++; }
    people.set(k, p);
  }
  for (const e of d.events) {
    const p = e.recipient_id ? people.get(byRecipient.get(e.recipient_id) ?? "") : undefined;
    if (!p) continue;
    if (e.type === "delivered") p.delivered = true;
    if (e.type === "bounced") p.bounced = true;
    if (e.type === "opened") p.opened = true;
    if (e.type === "clicked") p.clicked = true;
  }
  for (const r of d.replies) {
    if (!r.campaign_id) continue;
    const p = people.get(keyOf(r.campaign_id, r.from_normalized));
    if (!p) continue;
    p.replyCats.push(r.category ?? "unclassified");
    if (r.lead_id) p.leadIds.push(r.lead_id);
  }
  const leadStatus = new Map(d.leads.map((l) => [l.id, l.status]));

  const add = (m: Metrics, p: Person) => {
    if (!p.sent) return;
    m.recipients++; m.emailsSent += p.emails;
    if (p.delivered) m.delivered++;
    if (p.bounced) m.bounced++;
    if (p.opened) m.opened++;
    if (p.clicked) m.clicked++;
    if (p.replyCats.length) m.replies++;
    if (p.replyCats.some((c) => (POSITIVE as string[]).includes(c))) m.positive++;
    if (p.replyCats.includes("meeting_request")) m.meetings++;
    const statuses = p.leadIds.map((id) => leadStatus.get(id)).filter(Boolean) as string[];
    if (statuses.length) m.leads++;
    if (statuses.some((s) => OPPORTUNITY.includes(s))) m.opportunities++;
    if (statuses.includes("won")) m.won++;
  };
  const group = (keyFn: (p: Person) => { key: string; label: string } | null): Row[] => {
    const map = new Map<string, Row>();
    for (const p of people.values()) {
      const g = keyFn(p);
      if (!g) continue;
      const row = map.get(g.key) ?? { ...g, ...empty() };
      add(row, p);
      map.set(g.key, row);
    }
    return [...map.values()].filter((r) => r.recipients > 0).sort((a, b) => b.recipients - a.recipients);
  };

  const camp = new Map(d.campaigns.map((c) => [c.id, c]));
  const contact = new Map(d.contacts.map((c) => [c.id, c]));
  const tpl = new Map(d.templates.map((t) => [t.id, t.name]));
  const subjectFor = (p: Person) => {
    const c = camp.get(p.campaign);
    if (!c) return null;
    const v = p.variant && p.variant !== "A" ? d.variants.find((x) => x.campaign_id === p.campaign && x.label === p.variant) : null;
    return v?.subject || c.subject;
  };

  const totals = empty();
  for (const p of people.values()) add(totals, p);

  const byCampaign = group((p) => ({ key: p.campaign, label: camp.get(p.campaign)?.name ?? "Deleted campaign" }));
  const bySubject = group((p) => { const s = subjectFor(p); return s ? { key: s, label: s } : null; });
  const byIndustry = group((p) => { const i = (p.contact && contact.get(p.contact)?.industry?.trim()) || "Not recorded"; return { key: i.toLowerCase(), label: i }; });
  const byCity = group((p) => { const i = (p.contact && contact.get(p.contact)?.city?.trim()) || "Not recorded"; return { key: i.toLowerCase(), label: i }; });
  const byCategory = group((p) => { const c = p.contact ? contact.get(p.contact)?.categories?.[0] : null; return { key: c ?? "none", label: c ? c.replace(/_/g, " ") : "Uncategorised" }; });
  const byTemplate = group((p) => { const t = camp.get(p.campaign)?.template_id; return t ? { key: t, label: tpl.get(t) ?? "Template" } : { key: "none", label: "Written from scratch" }; });

  // A/B results per campaign. A winner is only named with enough data in every version and a real gap.
  const abMap = new Map<string, Map<string, Metrics>>();
  for (const p of people.values()) {
    if (!p.variant) continue;
    const m = abMap.get(p.campaign) ?? new Map<string, Metrics>();
    const row = m.get(p.variant) ?? empty();
    add(row, p);
    m.set(p.variant, row);
    abMap.set(p.campaign, m);
  }
  const abTests = [...abMap].map(([campaignId, versions]) => {
    const rows = [...versions].map(([label, m]) => ({ label, ...m, replyRate: m.recipients ? m.replies / m.recipients : 0 })).sort((a, b) => a.label.localeCompare(b.label));
    const enough = rows.length > 1 && rows.every((r) => r.recipients >= MIN_SAMPLE);
    const sorted = [...rows].sort((a, b) => b.replyRate - a.replyRate);
    const winner = enough && sorted[0].replyRate - sorted[1].replyRate >= 0.02 ? sorted[0].label : null;
    return { campaignId, name: camp.get(campaignId)?.name ?? "Campaign", rows, enough, winner };
  });

  const replyCategories: Record<string, number> = {};
  for (const r of d.replies) { const c = r.category ?? "unclassified"; replyCategories[c] = (replyCategories[c] ?? 0) + 1; }

  return { totals, byCampaign, bySubject, byIndustry, byCity, byCategory, byTemplate, abTests, replyCategories };
}

export async function loadAnalyticsInput(supabase: SupabaseClient): Promise<AnalyticsInput> {
  const [campaigns, variants, recipients, events, replies, templates, contacts] = await Promise.all([
    supabase.from("email_campaigns").select("id, name, subject, template_id").limit(500),
    supabase.from("email_campaign_variants").select("campaign_id, label, subject").limit(2000),
    supabase.from("email_recipients").select("id, campaign_id, email_normalized, contact_id, status, step, variant").in("status", ["sent", "failed"]).limit(50000),
    supabase.from("email_events").select("recipient_id, type").limit(100000),
    supabase.from("email_replies").select("campaign_id, from_normalized, category, lead_id").limit(20000),
    supabase.from("email_templates").select("id, name").limit(500),
    supabase.from("contacts").select("id, categories, company:companies(industry, city)").limit(10000),
  ]);
  const leadIds = [...new Set((replies.data ?? []).map((r) => r.lead_id).filter(Boolean))] as string[];
  const leads = leadIds.length ? await supabase.from("leads").select("id, status").in("id", leadIds) : { data: [] as { id: string; status: string }[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contactRows = (contacts.data ?? []).map((c: any) => { const co = Array.isArray(c.company) ? c.company[0] : c.company; return { id: c.id, industry: co?.industry ?? null, city: co?.city ?? null, categories: c.categories ?? [] }; });
  return {
    campaigns: campaigns.data ?? [], variants: variants.data ?? [], recipients: recipients.data ?? [], events: events.data ?? [],
    replies: replies.data ?? [], leads: leads.data ?? [], contacts: contactRows, templates: templates.data ?? [],
  };
}
