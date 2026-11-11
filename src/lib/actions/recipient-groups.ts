"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { contactIdsMatching } from "@/lib/data/directory";
import { isValidEmail, normalizeEmail } from "@/lib/email/audience";
import { syncContactGroups } from "@/lib/email/group-sync";
import type { ActionResult } from "@/lib/types";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";

const PATHS = ["/email-marketing/groups", "/contacts"];
const MAX_BULK = 5000;

const audit = (supabase: SupabaseClient, action: string, group_id: string | null, details: object) =>
  supabase.from("recipient_group_audit").insert({ action, group_id, details });

// ------------------------------------------------------------------------------------------ groups
const filtersSchema = z.object({
  categories: z.array(z.string().max(60)).max(20).optional(),
  industries: z.array(z.string().max(80)).max(20).optional(),
  cities: z.array(z.string().max(80)).max(20).optional(),
  states: z.array(z.string().max(80)).max(20).optional(),
  leadStatuses: z.array(z.string().max(40)).max(10).optional(),
  leadPriorities: z.array(z.enum(["high", "medium", "low"])).max(3).optional(),
  notContactedDays: z.number().int().min(1).max(3650).optional(),
  emailVerifiedOnly: z.boolean().optional(),
  search: z.string().max(100).optional(),
}).strict();

const groupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Group name is required").max(120),
  description: z.string().trim().max(500).default(""),
  group_type: z.enum(["static", "dynamic"]),
  business_category: z.string().trim().max(80).default(""),
  target_industry: z.string().trim().max(80).default(""),
  location: z.string().trim().max(80).default(""),
  filter_conditions: filtersSchema.default({}),
});
export type GroupInput = z.input<typeof groupSchema>;

export async function saveGroup(input: GroupInput): Promise<ActionResult<{ id: string }>> {
  return authorized(async ({ supabase }) => {
    const p = groupSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the group details.");
    const d = p.data;
    if (d.group_type === "dynamic" && !Object.values(d.filter_conditions).some((v) => (Array.isArray(v) ? v.length : v))) return fail("A dynamic group needs at least one condition.");
    const values = { name: d.name, description: d.description, group_type: d.group_type, business_category: d.business_category, target_industry: d.target_industry, location: d.location, filter_conditions: d.group_type === "dynamic" ? d.filter_conditions : {} };
    if (d.id) {
      const { data: cur } = await supabase.from("recipient_groups").select("group_type").eq("id", d.id).maybeSingle();
      if (!cur) return fail("That group no longer exists.");
      if (cur.group_type !== d.group_type) return fail("A group cannot change between static and dynamic. Create a new group instead.");
      const { error } = await supabase.from("recipient_groups").update(values).eq("id", d.id);
      if (error) return fail(error.code === "23505" ? "A group with that name already exists." : friendlyDbError(error));
      await audit(supabase, "update_group", d.id, { name: d.name });
      refresh(PATHS);
      return { ok: true, data: { id: d.id } };
    }
    const { data, error } = await supabase.from("recipient_groups").insert(values).select("id").single();
    if (error || !data) return fail(error?.code === "23505" ? "A group with that name already exists." : friendlyDbError(error ?? { message: "" }));
    await audit(supabase, "create_group", data.id, { name: d.name, type: d.group_type });
    refresh(PATHS);
    return { ok: true, data: { id: data.id } };
  });
}

export async function setGroupStatus(id: string, status: "active" | "archived"): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { data, error } = await supabase.from("recipient_groups").update({ status }).eq("id", id).select("name").maybeSingle();
    if (error || !data) return fail("That group no longer exists.");
    await audit(supabase, status === "archived" ? "archive_group" : "restore_group", id, { name: data.name });
    refresh(PATHS);
    return { ok: true };
  });
}

/** Deletes the group and its assignments only — contacts are never deleted. Administrators only. */
export async function deleteGroup(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can delete a group. You can archive it instead.");
    const { data: g } = await supabase.from("recipient_groups").select("name").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from("recipient_groups").delete().eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("That group no longer exists.");
    await audit(supabase, "delete_group", null, { name: g?.name });
    refresh(PATHS);
    return { ok: true };
  });
}

const SUGGESTED: { name: string; category: string; industry: string }[] = [
  { name: "Wedding Planners", category: "Wedding", industry: "Wedding planning" },
  { name: "Wedding Decorators", category: "Wedding", industry: "Decoration" },
  { name: "Wedding Management Companies", category: "Wedding", industry: "Wedding management" },
  { name: "Event Management Agencies", category: "Events", industry: "Event management" },
  { name: "Corporate HR & Admin", category: "Corporate", industry: "Corporate" },
  { name: "Corporate Marketing Teams", category: "Corporate", industry: "Corporate" },
  { name: "Advertising Agencies", category: "Agencies", industry: "Advertising" },
  { name: "Digital Marketing Agencies", category: "Agencies", industry: "Digital marketing" },
  { name: "Brand Activation Agencies", category: "Agencies", industry: "Brand activation" },
  { name: "Hotels & Banquet Halls", category: "Hospitality", industry: "Hospitality" },
  { name: "Wedding Venues", category: "Hospitality", industry: "Venues" },
  { name: "Production Companies", category: "Production", industry: "Production" },
  { name: "MICE Companies", category: "Events", industry: "MICE" },
  { name: "Existing Clients", category: "Clients", industry: "" },
  { name: "Business Partners", category: "Partners", industry: "" },
  { name: "Potential Corporate Clients", category: "Corporate", industry: "Corporate" },
];

/** Adds NAFA's suggested groups (empty static groups). Existing names are left alone, so it is safe to run again. */
export async function createSuggestedGroups(): Promise<ActionResult<{ created: number }>> {
  return authorized(async ({ supabase }) => {
    const { data: existing } = await supabase.from("recipient_groups").select("name");
    const have = new Set((existing ?? []).map((g: { name: string }) => g.name.trim().toLowerCase()));
    const rows = SUGGESTED.filter((s) => !have.has(s.name.toLowerCase())).map((s) => ({ name: s.name, group_type: "static", business_category: s.category, target_industry: s.industry, description: `Suggested group: ${s.name}` }));
    if (rows.length) {
      const { error } = await supabase.from("recipient_groups").insert(rows);
      if (error) return fail(friendlyDbError(error));
      await audit(supabase, "create_group", null, { suggested: rows.length });
    }
    refresh(PATHS);
    return { ok: true, data: { created: rows.length } };
  });
}

// ------------------------------------------------------------------------------------------ selections + bulk
const selectionSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_BULK) }),
  z.object({ all: z.object({ q: z.string().max(100).default(""), archived: z.boolean().default(false) }) }),
]);
export type Selection = z.input<typeof selectionSchema>;

async function resolveSelection(supabase: SupabaseClient, sel: Selection): Promise<string[] | null> {
  const p = selectionSchema.safeParse(sel);
  if (!p.success) return null;
  if ("ids" in p.data) return [...new Set(p.data.ids)];
  return contactIdsMatching(supabase, { q: p.data.all.q, archived: p.data.all.archived }, MAX_BULK);
}

async function staticGroups(supabase: SupabaseClient, groupIds: string[]) {
  if (!groupIds.length || groupIds.some((g) => !isUuid(g))) return [];
  const { data } = await supabase.from("recipient_groups").select("id, name, group_type").in("id", groupIds).eq("group_type", "static");
  return (data ?? []) as { id: string; name: string; group_type: string }[];
}

/** Adds contacts to one or more STATIC groups. Existing assignments are skipped, so no duplicates are ever created. */
export async function assignToGroups(sel: Selection, groupIds: string[]): Promise<ActionResult<{ contacts: number; added: number }>> {
  return authorized(async ({ supabase }) => {
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const groups = await staticGroups(supabase, groupIds);
    if (!groups.length) return fail("Choose at least one static group. Dynamic groups fill themselves from their conditions.");
    let added = 0;
    for (const g of groups) {
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await supabase.from("contact_recipient_groups")
          .upsert(ids.slice(i, i + 500).map((contact_id) => ({ contact_id, group_id: g.id })), { onConflict: "contact_id,group_id", ignoreDuplicates: true }).select("id");
        if (error) return fail(friendlyDbError(error));
        added += data?.length ?? 0;
      }
    }
    await audit(supabase, "assign", groups.length === 1 ? groups[0].id : null, { groups: groups.map((g) => g.name), contacts: ids.length, newAssignments: added, sample: ids.slice(0, 20) });
    refresh(PATHS);
    return { ok: true, data: { contacts: ids.length, added } };
  });
}

export async function removeFromGroups(sel: Selection, groupIds: string[]): Promise<ActionResult<{ removed: number }>> {
  return authorized(async ({ supabase }) => {
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const groups = await staticGroups(supabase, groupIds);
    if (!groups.length) return fail("Choose at least one static group.");
    let removed = 0;
    for (const g of groups) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from("contact_recipient_groups").delete().eq("group_id", g.id).in("contact_id", ids.slice(i, i + 200)).select("id");
        if (error) return fail(friendlyDbError(error));
        removed += data?.length ?? 0;
      }
    }
    await audit(supabase, "unassign", groups.length === 1 ? groups[0].id : null, { groups: groups.map((g) => g.name), contacts: ids.length, removed, sample: ids.slice(0, 20) });
    refresh(PATHS);
    return { ok: true, data: { removed } };
  });
}

/** Sets which static groups ONE contact belongs to (used by the contact form and profile). Dynamic groups are untouched. */
export async function setContactGroups(contactId: string, groupIds: string[]): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(contactId)) return fail("Contact not found.");
    const r = await syncContactGroups(supabase, contactId, groupIds);
    if (r.error) return fail("Could not update the groups. Please try again.");
    refresh([...PATHS, `/contacts/${contactId}`]);
    return { ok: true };
  });
}

/** Changes the industry of the selected contacts' companies (industry lives on the company, so colleagues at the same company change too). */
export async function bulkChangeIndustry(sel: Selection, industry: string): Promise<ActionResult<{ companies: number; skipped: number }>> {
  return authorized(async ({ supabase }) => {
    const value = industry.trim().slice(0, 120);
    if (!value) return fail("Enter an industry.");
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const companyIds = new Set<string>();
    let skipped = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("contacts").select("id, company_id").in("id", ids.slice(i, i + 200));
      for (const c of data ?? []) {
        if (c.company_id) companyIds.add(c.company_id);
        else skipped++;
      }
    }
    const list = [...companyIds];
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await supabase.from("companies").update({ industry: value }).in("id", list.slice(i, i + 200));
      if (error) return fail(friendlyDbError(error));
    }
    await audit(supabase, "bulk_industry", null, { industry: value, contacts: ids.length, companies: list.length, skipped, sample: ids.slice(0, 20) });
    refresh([...PATHS, "/companies"]);
    return { ok: true, data: { companies: list.length, skipped } };
  });
}

export async function bulkSetArchived(sel: Selection, archived: boolean): Promise<ActionResult<{ contacts: number }>> {
  return authorized(async ({ supabase }) => {
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from("contacts").update({ archived_at: archived ? new Date().toISOString() : null }).in("id", ids.slice(i, i + 200));
      if (error) return fail(friendlyDbError(error));
    }
    await audit(supabase, "bulk_status", null, { status: archived ? "archived" : "active", contacts: ids.length, sample: ids.slice(0, 20) });
    refresh(PATHS);
    return { ok: true, data: { contacts: ids.length } };
  });
}

/**
 * Permanently deletes contacts. Administrators only (also enforced by the database). A contact that still has leads is NOT deleted —
 * archive it instead — so no lead is ever left without its contact. Group assignments go with the contact; quotations,
 * proposals and past email records keep their data but lose the link.
 */
export async function deleteContacts(sel: Selection): Promise<ActionResult<{ deleted: number; blocked: number }>> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can permanently delete contacts. You can archive them instead.");
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const withLeads = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("leads").select("contact_id").in("contact_id", ids.slice(i, i + 200));
      for (const l of data ?? []) if (l.contact_id) withLeads.add(l.contact_id);
    }
    const deletable = ids.filter((id) => !withLeads.has(id));
    let deleted = 0;
    for (let i = 0; i < deletable.length; i += 200) {
      const { data, error } = await supabase.from("contacts").delete().in("id", deletable.slice(i, i + 200)).select("id");
      if (error) return fail(friendlyDbError(error));
      deleted += data?.length ?? 0;
    }
    await audit(supabase, "delete_contacts", null, { requested: ids.length, deleted, blockedByLeads: withLeads.size });
    if (!deleted) return fail(withLeads.size ? "These contacts have leads, so they cannot be deleted. Archive them instead." : "Nothing was deleted.");
    refresh([...PATHS, "/companies", "/email-marketing"]);
    return { ok: true, data: { deleted, blocked: withLeads.size } };
  });
}

/** Adds one contact to one static group (group detail page). */
export async function addMembersByContact(groupId: string, contactId: string): Promise<ActionResult> {
  const r = await assignToGroups({ ids: [contactId] }, [groupId]);
  return r.ok ? { ok: true } : r;
}

/** CSV text of the selected contacts (up to 5,000). */
export async function exportContacts(sel: Selection): Promise<ActionResult<{ csv: string }>> {
  return authorized(async ({ supabase }) => {
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const rows: Record<string, string>[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("contact_list").select("full_name, designation, company_name, email, phone").in("id", ids.slice(i, i + 200));
      for (const r of data ?? []) rows.push({ name: r.full_name, designation: r.designation ?? "", company: r.company_name ?? "", email: r.email ?? "", phone: r.phone ?? "" });
    }
    const head = ["name", "designation", "company", "email", "phone"];
    const esc = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
    const csv = [head.join(","), ...rows.map((r) => head.map((h) => `"${esc(r[h])}"`).join(","))].join("\r\n");
    return { ok: true, data: { csv } };
  });
}

/** Puts the selection into a new static group so it can be used as the recipients of a campaign. */
export async function createGroupFromSelection(sel: Selection, name?: string): Promise<ActionResult<{ groupId: string; contacts: number }>> {
  return authorized(async ({ supabase }) => {
    const ids = await resolveSelection(supabase, sel);
    if (!ids?.length) return fail("No contacts selected.");
    const label = (name?.trim() || `Selection ${new Date().toISOString().slice(0, 16).replace("T", " ")}`).slice(0, 120);
    const { data: g, error } = await supabase.from("recipient_groups").insert({ name: label, group_type: "static", description: "Created from selected contacts for an email campaign." }).select("id").single();
    if (error || !g) return fail(error?.code === "23505" ? "A group with that name already exists." : friendlyDbError(error ?? { message: "" }));
    for (let i = 0; i < ids.length; i += 500) {
      const { error: e2 } = await supabase.from("contact_recipient_groups").insert(ids.slice(i, i + 500).map((contact_id) => ({ contact_id, group_id: g.id })));
      if (e2) return fail(friendlyDbError(e2));
    }
    await audit(supabase, "create_group", g.id, { name: label, contacts: ids.length, fromSelection: true });
    refresh(PATHS);
    return { ok: true, data: { groupId: g.id, contacts: ids.length } };
  });
}

/** Contact search for hand-picking recipients in a campaign. */
export async function searchContactsForCampaign(q: string): Promise<ActionResult<{ id: string; name: string; company: string | null; email: string }[]>> {
  return authorized(async ({ supabase }) => {
    const s = q.replace(/[%,()]/g, " ").trim().slice(0, 60);
    if (s.length < 2) return { ok: true, data: [] };
    const { data } = await supabase.from("contact_list").select("id, full_name, company_name, email").is("archived_at", null).not("email", "is", null)
      .or(`full_name.ilike.%${s}%,email.ilike.%${s}%,company_name.ilike.%${s}%`).order("full_name").limit(15);
    return { ok: true, data: (data ?? []).map((c: { id: string; full_name: string; company_name: string | null; email: string }) => ({ id: c.id, name: c.full_name, company: c.company_name, email: c.email })) };
  });
}

// ------------------------------------------------------------------------------------------ CSV import with group mapping
/** Spreadsheet cells are messy: trim them and cut over-long values instead of rejecting the whole batch. */
const cell = (max: number) => z.string().nullish().transform((v) => (v ?? "").trim().slice(0, max));
const importSchema = z.object({
  rows: z.array(z.object({
    full_name: cell(200), email: cell(320), company: cell(200), designation: cell(120), industry: cell(120), city: cell(120),
    state: cell(120), website: cell(200), category: cell(60),
    groups: cell(500),     // group names separated by ; or |
    phone: cell(40),
  })).min(1).max(2000),
  category: z.string().trim().max(60).optional(),
  groupIds: z.array(z.string().uuid()).max(50).default([]),   // applied to every row
});
/**
 * Imports contacts and assigns groups, in a handful of batched queries (not one round trip per row), so a few hundred rows finish in seconds.
 * Existing contacts (same email) are NOT duplicated: they just get the groups. Missing named groups are created as static groups.
 */
export async function importContactsWithGroups(input: z.input<typeof importSchema>): Promise<ActionResult<{ created: number; existing: number; invalid: number; assigned: number; groupsCreated: number }>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "import"))) return fail(TOO_MANY);
    const p = importSchema.safeParse(input);
    if (!p.success) {
      const i = p.error.issues[0];
      return fail(i?.path[0] === "rows" && typeof i.path[1] === "number" ? `Row ${i.path[1] + 1} could not be read (${String(i.path[2] ?? "value")}).` : "Upload a CSV with between 1 and 2,000 rows.");
    }

    // ---- validate + de-duplicate inside the file
    type Valid = (typeof p.data.rows)[number] & { n: string };
    const valid: Valid[] = [];
    const seen = new Set<string>();
    let invalid = 0, existing = 0;
    for (const r of p.data.rows) {
      if (!isValidEmail(r.email) || !r.full_name) { invalid++; continue; }
      const n = normalizeEmail(r.email);
      if (seen.has(n)) { existing++; continue; }
      seen.add(n);
      valid.push({ ...r, n });
    }

    // ---- which of these people already exist?
    const contactIdByEmail = new Map<string, string>();
    for (let i = 0; i < valid.length; i += 100) {
      const { data } = await supabase.from("contacts").select("id, email_normalized").in("email_normalized", valid.slice(i, i + 100).map((v) => v.n));
      for (const c of data ?? []) contactIdByEmail.set(c.email_normalized as string, c.id as string);
    }
    existing += valid.filter((v) => contactIdByEmail.has(v.n)).length;
    const fresh = valid.filter((v) => !contactIdByEmail.has(v.n));

    // ---- companies: reuse by name (case-insensitive), create the missing ones in bulk
    const companyId = new Map<string, string>();
    const { data: comps } = await supabase.from("companies").select("id, name").is("archived_at", null).limit(10000);
    for (const c of comps ?? []) companyId.set((c.name as string).trim().toLowerCase(), c.id as string);
    const newCompanies = new Map<string, { name: string; industry: string | null; city: string | null; website: string | null }>();
    for (const r of fresh) {
      const key = r.company?.trim().toLowerCase();
      if (key && !companyId.has(key) && !newCompanies.has(key)) newCompanies.set(key, { name: r.company!.trim(), industry: r.industry || null, city: r.city || null, website: r.website || null });
    }
    const toCreate = [...newCompanies.values()];
    for (let i = 0; i < toCreate.length; i += 100) {
      const { data } = await supabase.from("companies").insert(toCreate.slice(i, i + 100)).select("id, name");
      for (const c of data ?? []) companyId.set((c.name as string).trim().toLowerCase(), c.id as string);
    }

    // ---- contacts: bulk insert; if a chunk is rejected, retry row by row so one bad row cannot sink the rest
    const record = (r: Valid) => ({
      full_name: r.full_name, email: r.email, phone: r.phone || null, designation: r.designation || null,
      company_id: r.company ? companyId.get(r.company.trim().toLowerCase()) ?? null : null, state: r.state || null,
      categories: [r.category || p.data.category].filter(Boolean) as string[],
    });
    let created = 0;
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100);
      const { data, error } = await supabase.from("contacts").insert(chunk.map(record)).select("id, email_normalized");
      if (!error) {
        for (const c of data ?? []) contactIdByEmail.set(c.email_normalized as string, c.id as string);
        created += data?.length ?? 0;
        continue;
      }
      for (const r of chunk) {
        const one = await supabase.from("contacts").insert(record(r)).select("id, email_normalized").single();
        if (one.error || !one.data) invalid++;
        else { contactIdByEmail.set(one.data.email_normalized as string, one.data.id as string); created++; }
      }
    }

    // ---- groups
    const groupByName = new Map<string, string>();
    const { data: existingGroups } = await supabase.from("recipient_groups").select("id, name, group_type");
    for (const g of existingGroups ?? []) if (g.group_type === "static") groupByName.set((g.name as string).trim().toLowerCase(), g.id as string);
    const dynamicNames = new Set((existingGroups ?? []).filter((g) => g.group_type === "dynamic").map((g) => (g.name as string).trim().toLowerCase()));
    let groupsCreated = 0;
    const ensureGroup = async (name: string): Promise<string | null> => {
      const key = name.trim().toLowerCase();
      if (!key || dynamicNames.has(key)) return null;
      const have = groupByName.get(key);
      if (have) return have;
      const { data } = await supabase.from("recipient_groups").insert({ name: name.trim().slice(0, 120), group_type: "static" }).select("id").single();
      if (data) { groupByName.set(key, data.id); groupsCreated++; return data.id; }
      return null;
    };
    const pairs: { contact_id: string; group_id: string }[] = [];
    for (const r of valid) {
      const cid = contactIdByEmail.get(r.n);
      if (!cid) continue;
      const ids = new Set<string>(p.data.groupIds);
      for (const name of (r.groups ?? "").split(/[;|]/)) { const gid = await ensureGroup(name); if (gid) ids.add(gid); }
      for (const gid of ids) pairs.push({ contact_id: cid, group_id: gid });
    }
    let assigned = 0;
    for (let i = 0; i < pairs.length; i += 500) {
      const { data } = await supabase.from("contact_recipient_groups").upsert(pairs.slice(i, i + 500), { onConflict: "contact_id,group_id", ignoreDuplicates: true }).select("id");
      assigned += data?.length ?? 0;
    }
    await audit(supabase, "import", null, { created, existing, invalid, assigned, groupsCreated });
    refresh(["/contacts", "/email-marketing", ...PATHS]);
    return { ok: true, data: { created, existing, invalid, assigned, groupsCreated } };
  });
}
