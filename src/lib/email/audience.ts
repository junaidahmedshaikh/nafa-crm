import type { SupabaseClient } from "@supabase/supabase-js";

/** Filters that pick recipients out of existing CRM contacts. */
export type AudienceFilters = {
  categories?: string[];          // contact category tags, e.g. wedding_planners
  industries?: string[];          // matched (case-insensitive, partial) against company industry
  cities?: string[];
  states?: string[];
  leadStatuses?: string[];        // contact has a lead in one of these statuses
  notContactedDays?: number;      // no lead contact in the last N days (or never)
  contactedCampaignBefore?: "yes" | "no"; // previous campaign activity
  search?: string;
  contactIds?: string[];          // individual contacts picked by hand
  groupIds?: string[];            // recipient groups (static or dynamic); a contact in ANY selected group matches
  leadPriorities?: string[];      // high | medium | low
  emailVerifiedOnly?: boolean;    // only contacts whose email status is "valid"
};

export const AUDIENCE_PRESETS: { key: string; label: string; industry?: string; category?: string }[] = [
  { key: "all", label: "All CRM contacts" },
  { key: "wedding_planners", label: "Wedding planners", category: "wedding_planners", industry: "wedding" },
  { key: "wedding_decorators", label: "Wedding decorators", category: "wedding_decorators", industry: "decor" },
  { key: "event_agencies", label: "Event management companies", category: "event_agencies", industry: "event" },
  { key: "corporate_hr", label: "Corporate HR & Admin", category: "corporate_hr", industry: "corporate" },
  { key: "advertising_agencies", label: "Advertising agencies", category: "advertising_agencies", industry: "advertis" },
  { key: "digital_agencies", label: "Digital marketing agencies", category: "digital_agencies", industry: "digital" },
  { key: "hotels_venues", label: "Hotels & banquet venues", category: "hotels_venues", industry: "hotel" },
  { key: "activation_agencies", label: "Brand activation agencies", category: "activation_agencies", industry: "activation" },
];

export type ContactRow = {
  id: string;
  fullName: string;
  email: string | null;
  emailStatus: string;
  designation: string | null;
  companyName: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  categories: string[];
  lastContactAt: string | null;
  leadStatuses: string[];
  leadPriorities: string[];
};

export type Classified = {
  eligible: ContactRow[];
  excluded: { contact: ContactRow; reason: "no_email" | "invalid" | "duplicate" | "unsubscribed" | "bounced" | "suppressed" }[];
};

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isValidEmail = (e: string) => e.length <= 254 && EMAIL_RE.test(e.trim());

/** Pure: decides who may be emailed. `suppressed` maps normalised address -> suppression reason. */
export function classifyContacts(rows: ContactRow[], suppressed: Map<string, string>, alreadyInCampaign: Set<string> = new Set()): Classified {
  const seen = new Set<string>(alreadyInCampaign);
  const out: Classified = { eligible: [], excluded: [] };
  for (const c of rows) {
    const raw = c.email?.trim();
    if (!raw) { out.excluded.push({ contact: c, reason: "no_email" }); continue; }
    if (!isValidEmail(raw) || c.emailStatus === "invalid") { out.excluded.push({ contact: c, reason: "invalid" }); continue; }
    const n = normalizeEmail(raw);
    const supp = suppressed.get(n);
    if (c.emailStatus === "unsubscribed" || supp === "unsubscribed") { out.excluded.push({ contact: c, reason: "unsubscribed" }); continue; }
    if (c.emailStatus === "bounced" || supp === "bounced") { out.excluded.push({ contact: c, reason: "bounced" }); continue; }
    if (supp) { out.excluded.push({ contact: c, reason: "suppressed" }); continue; }
    if (seen.has(n)) { out.excluded.push({ contact: c, reason: "duplicate" }); continue; }
    seen.add(n);
    out.eligible.push(c);
  }
  return out;
}

/** Pure: applies the filters to already-loaded rows. */
export function applyFilters(rows: ContactRow[], f: AudienceFilters, now = new Date(), campaignContactIds: Set<string> = new Set(), groupMembers?: Set<string>): ContactRow[] {
  const has = (v: string | null, list?: string[]) => !list?.length || (!!v && list.some((x) => v.toLowerCase().includes(x.toLowerCase())));
  return rows.filter((r) => {
    if (f.contactIds?.length && !f.contactIds.includes(r.id)) return false;
    if (f.groupIds?.length && !groupMembers?.has(r.id)) return false;
    if (f.emailVerifiedOnly && r.emailStatus !== "valid") return false;
    if (f.leadPriorities?.length && !r.leadPriorities.some((p) => f.leadPriorities!.includes(p))) return false;
    if (f.categories?.length || f.industries?.length) {
      const catOk = !!f.categories?.length && r.categories.some((c) => f.categories!.includes(c));
      const indOk = !!f.industries?.length && has(r.industry, f.industries);
      if (!catOk && !indOk) return false;
    }
    if (!has(r.city, f.cities)) return false;
    if (!has(r.state, f.states)) return false;
    if (f.leadStatuses?.length && !r.leadStatuses.some((s) => f.leadStatuses!.includes(s))) return false;
    if (f.notContactedDays) {
      const cutoff = now.getTime() - f.notContactedDays * 86400000;
      if (r.lastContactAt && new Date(r.lastContactAt).getTime() > cutoff) return false;
    }
    if (f.contactedCampaignBefore === "yes" && !campaignContactIds.has(r.id)) return false;
    if (f.contactedCampaignBefore === "no" && campaignContactIds.has(r.id)) return false;
    if (f.search) {
      const hay = `${r.fullName} ${r.companyName ?? ""} ${r.email ?? ""}`.toLowerCase();
      if (!hay.includes(f.search.toLowerCase())) return false;
    }
    return true;
  });
}

/** Loads CRM contacts (with company and lead facts) through the caller's Supabase client, so RLS applies. */
export async function loadContactRows(supabase: SupabaseClient): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, full_name, email, email_status, designation, state, categories, company:companies(name, industry, city, website), leads(status, last_contact_at, priority)")
    .is("archived_at", null)
    .limit(5000);
  if (error) throw new Error(`Could not load contacts: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((c: any): ContactRow => {
    const company = Array.isArray(c.company) ? c.company[0] : c.company;
    const leads = (c.leads ?? []) as { status: string; last_contact_at: string | null; priority: string }[];
    const last = leads.map((l) => l.last_contact_at).filter(Boolean).sort().pop() ?? null;
    return {
      id: c.id, fullName: c.full_name, email: c.email, emailStatus: c.email_status, designation: c.designation,
      companyName: company?.name ?? null, industry: company?.industry ?? null, city: company?.city ?? null, state: c.state,
      website: company?.website ?? null, categories: c.categories ?? [], lastContactAt: last, leadStatuses: leads.map((l) => l.status), leadPriorities: leads.map((l) => l.priority),
    };
  });
}

export async function loadSuppressions(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("email_suppressions").select("email_normalized, reason").limit(20000);
  if (error) throw new Error(`Could not load the suppression list: ${error.message}`);
  return new Map((data ?? []).map((r: { email_normalized: string; reason: string }) => [r.email_normalized, r.reason]));
}

/** Static memberships: group id -> set of contact ids. */
export async function loadStaticMembership(supabase: SupabaseClient): Promise<Map<string, Set<string>>> {
  const { data, error } = await supabase.from("contact_recipient_groups").select("contact_id, group_id").limit(200000);
  if (error) throw new Error(`Could not load group memberships: ${error.message}`);
  const map = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { contact_id: string; group_id: string }[]) {
    const set = map.get(r.group_id) ?? new Set<string>();
    set.add(r.contact_id);
    map.set(r.group_id, set);
  }
  return map;
}

export type GroupDef = { id: string; name: string; group_type: "static" | "dynamic"; filter_conditions: AudienceFilters; status: string };

/** Who is in a group right now. Static: the assigned contacts. Dynamic: everyone matching the saved conditions. */
export function groupMembers(g: GroupDef, rows: ContactRow[], staticMap: Map<string, Set<string>>, now = new Date()): ContactRow[] {
  if (g.group_type === "static") {
    const ids = staticMap.get(g.id);
    return ids ? rows.filter((r) => ids.has(r.id)) : [];
  }
  return applyFilters(rows, { ...g.filter_conditions, groupIds: undefined, contactIds: undefined }, now);
}

export async function loadGroups(supabase: SupabaseClient): Promise<GroupDef[]> {
  const { data, error } = await supabase.from("recipient_groups").select("id, name, group_type, filter_conditions, status").order("name").limit(1000);
  if (error) throw new Error(`Could not load recipient groups: ${error.message}`);
  return (data ?? []) as GroupDef[];
}

export async function resolveAudience(supabase: SupabaseClient, filters: AudienceFilters) {
  const needGroups = !!filters.groupIds?.length;
  const [rows, suppressed, sentBefore, groups, staticMap] = await Promise.all([
    loadContactRows(supabase),
    loadSuppressions(supabase),
    filters.contactedCampaignBefore
      ? supabase.from("email_recipients").select("contact_id").eq("status", "sent").not("contact_id", "is", null).limit(20000)
      : Promise.resolve({ data: [] as { contact_id: string }[] }),
    needGroups ? loadGroups(supabase) : Promise.resolve([] as GroupDef[]),
    needGroups ? loadStaticMembership(supabase) : Promise.resolve(new Map<string, Set<string>>()),
  ]);
  const before = new Set((sentBefore.data ?? []).map((r: { contact_id: string }) => r.contact_id));

  // Union of the selected (active) groups; remember each group's own size for the selection screen.
  let members: Set<string> | undefined;
  const perGroup: { id: string; name: string; type: string; count: number }[] = [];
  let totalWithDuplicates = 0;
  if (needGroups) {
    members = new Set();
    for (const g of groups.filter((x) => filters.groupIds!.includes(x.id) && x.status === "active")) {
      const m = groupMembers(g, rows, staticMap);
      perGroup.push({ id: g.id, name: g.name, type: g.group_type, count: m.length });
      totalWithDuplicates += m.length;
      for (const r of m) members.add(r.id);
    }
  }
  const matched = applyFilters(rows, filters, new Date(), before, members);
  return { totalContacts: rows.length, matched, perGroup, totalWithDuplicates, ...classifyContacts(matched, suppressed) };
}
