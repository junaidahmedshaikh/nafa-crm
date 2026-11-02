import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import type { WaSettings } from "./engine";
import type { AudienceContact } from "./audience";

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type WaTemplate = {
  id: string; name: string; language: string; category: "marketing" | "utility"; body: string; footer: string | null;
  status: "draft" | "pending" | "approved" | "rejected"; meta_template_id: string | null; rejection_reason: string | null;
  archived_at: string | null; created_at: string; updated_at: string;
};
export type WaCampaign = {
  id: string; name: string; template_id: string; status: "ready" | "sending" | "paused" | "completed" | "cancelled"; mode: "dry_run" | "live";
  custom_values: Record<string, string>; paused_reason: string | null; created_at: string; started_at: string | null; completed_at: string | null;
};
export type Counts = Record<string, number>;
export type WaMessage = {
  id: string; contact_id: string; to_phone: string; body: string; status: string; error: string | null;
  sent_at: string | null; delivered_at: string | null; read_at: string | null; contact: { full_name: string } | null;
};
export type AudienceRow = AudienceContact & { company_name: string | null; designation: string | null; whatsapp_consent_source: string | null; whatsapp_consent_at: string | null };

const NOT_SET_UP = "WhatsApp messaging is not set up yet. Run the latest database migration (20261104000001_whatsapp.sql) in Supabase, then reload.";
function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42883" || error.code === "PGRST202" || error.code === "42703") throw new Error(NOT_SET_UP);
  throw new Error(error.message);
}

export async function getWaSettings(supabase: SupabaseClient): Promise<WaSettings> {
  const { data, error } = await supabase.from("whatsapp_settings").select("*").maybeSingle();
  check(error);
  if (!data) throw new Error(NOT_SET_UP);
  return { ...data, cost_per_message: data.cost_per_message == null ? null : Number(data.cost_per_message) } as WaSettings;
}

export async function listTemplates(supabase: SupabaseClient, opts: { archived?: boolean } = {}): Promise<WaTemplate[]> {
  let q = supabase.from("whatsapp_templates").select("*");
  q = opts.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data, error } = await q.order("name");
  check(error);
  return (data ?? []) as WaTemplate[];
}

export async function getTemplate(supabase: SupabaseClient, id: string): Promise<WaTemplate | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("whatsapp_templates").select("*").eq("id", id).maybeSingle();
  check(error);
  return (data as WaTemplate | null) ?? null;
}

export async function campaignCounts(supabase: SupabaseClient, id: string): Promise<Counts> {
  const { data, error } = await supabase.rpc("whatsapp_campaign_counts", { p_campaign: id });
  check(error);
  return Object.fromEntries(((data ?? []) as { status: string; n: number }[]).map((r) => [r.status, r.n]));
}

export const totalOf = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

export async function listCampaigns(supabase: SupabaseClient, page = 1) {
  const [from, to] = pageRange(page);
  const { data, count, error } = await supabase
    .from("whatsapp_campaigns").select("*, template:whatsapp_templates(name, category)", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  check(error);
  const rows = (data ?? []) as (WaCampaign & { template: { name: string; category: string } | null })[];
  const counts = await Promise.all(rows.map((r) => campaignCounts(supabase, r.id)));
  return { rows: rows.map((r, i) => ({ ...r, counts: counts[i] })), total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function getCampaign(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("whatsapp_campaigns").select("*, template:whatsapp_templates(*)").eq("id", id).maybeSingle();
  check(error);
  if (!data) return null;
  const template = (Array.isArray(data.template) ? data.template[0] : data.template) as WaTemplate;
  return { campaign: data as WaCampaign, template, counts: await campaignCounts(supabase, id) };
}

export async function listCampaignMessages(supabase: SupabaseClient, id: string, opts: { status?: string; page: number }) {
  const [from, to] = pageRange(opts.page);
  let q = supabase.from("whatsapp_messages").select("id, contact_id, to_phone, body, status, error, sent_at, delivered_at, read_at, contact:contacts(full_name)", { count: "exact" }).eq("campaign_id", id);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, count, error } = await q.order("queued_at").order("id").range(from, to);
  check(error);
  const rows = ((data ?? []) as unknown as (Omit<WaMessage, "contact"> & { contact: { full_name: string } | { full_name: string }[] | null })[]).map((r) => ({
    ...r, contact: Array.isArray(r.contact) ? (r.contact[0] ?? null) : r.contact,
  })) as WaMessage[];
  return { rows, total: count ?? 0, pageSize: PAGE_SIZE };
}

/** Contacts available for a campaign (active only), with consent, for the audience picker. */
export async function listAudience(supabase: SupabaseClient, opts: { q: string; consent: "" | "opted_in" | "unknown" | "opted_out"; companyId?: string }, limit = 1000) {
  let query = supabase
    .from("contact_list")
    .select("id, full_name, phone, whatsapp, whatsapp_consent, whatsapp_consent_source, whatsapp_consent_at, archived_at, company_name, designation", { count: "exact" })
    .is("archived_at", null);
  if (opts.consent) query = query.eq("whatsapp_consent", opts.consent);
  if (opts.companyId && isUuid(opts.companyId)) query = query.eq("company_id", opts.companyId);
  const s = sanitizeSearch(opts.q);
  if (s) {
    const digits = s.replace(/\D/g, "");
    const parts = [`full_name.ilike.%${s}%`, `company_name.ilike.%${s}%`, `designation.ilike.%${s}%`, `phone.ilike.%${s}%`];
    if (digits.length >= 3) parts.push(`phone_normalized.ilike.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data, count, error } = await query.order("full_name").limit(limit);
  check(error);
  return { rows: (data ?? []) as AudienceRow[], total: count ?? 0 };
}

export async function consentTotals(supabase: SupabaseClient): Promise<Record<"opted_in" | "unknown" | "opted_out", number>> {
  const one = async (v: string) => {
    const { count, error } = await supabase.from("contacts").select("id", { count: "exact", head: true }).is("archived_at", null).eq("whatsapp_consent", v);
    check(error);
    return count ?? 0;
  };
  const [opted_in, unknown, opted_out] = await Promise.all([one("opted_in"), one("unknown"), one("opted_out")]);
  return { opted_in, unknown, opted_out };
}

/** Contact ids that were sent a message inside the repeat window. */
export async function recentlyMessaged(supabase: SupabaseClient, days: number, ids: string[]): Promise<Set<string>> {
  if (days <= 0 || ids.length === 0) return new Set();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("whatsapp_messages").select("contact_id").in("contact_id", ids.slice(i, i + 100)).in("status", ["sent", "delivered", "read"]).gte("sent_at", since);
    check(error);
    for (const r of data ?? []) out.add(r.contact_id as string);
  }
  return out;
}

export async function sentLast24h(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("whatsapp_sent_last_24h");
  check(error);
  return Number(data ?? 0);
}

/** True once the WhatsApp migration has been run (contact consent columns exist). */
export async function whatsappReady(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("whatsapp_settings").select("id").limit(1);
  return !error;
}

export function liveConnected(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.WHATSAPP_ACCESS_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}
