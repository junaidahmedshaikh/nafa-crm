import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_STATUS_LABELS, OPEN_STATUSES, type LeadStatus } from "@/lib/constants";
import { normalizeCompanyName, normalizeEmail, phoneDigits, websiteDomain } from "@/lib/normalize";
import type { DuplicateMatch, DuplicateReport } from "@/lib/types";

export const emptyReport = (): DuplicateReport => ({ companies: [], contacts: [], leads: [] });
export const hasDuplicates = (r: DuplicateReport) => r.companies.length + r.contacts.length + r.leads.length > 0;

type CompanyHit = { id: string; name: string; city: string | null; website: string | null };
type ContactHit = { id: string; full_name: string; email: string | null; phone: string | null; company_id: string | null; company_name: string | null };

/** Active companies whose normalised name equals this name (or that share the website domain). */
export async function findCompanyMatches(
  supabase: SupabaseClient,
  name: string | null,
  website: string | null = null,
  excludeId?: string,
): Promise<CompanyHit[]> {
  const normalized = name ? normalizeCompanyName(name) : "";
  const domain = websiteDomain(website);
  const hits = new Map<string, CompanyHit>();
  if (normalized) {
    const { data } = await supabase
      .from("companies").select("id, name, city, website").eq("name_normalized", normalized).is("archived_at", null).limit(5);
    (data ?? []).forEach((c) => hits.set(c.id, c));
  }
  if (domain) {
    const { data } = await supabase
      .from("companies").select("id, name, city, website").ilike("website", `%${domain.replace(/[%_,()]/g, "")}%`).is("archived_at", null).limit(10);
    (data ?? []).filter((c) => websiteDomain(c.website) === domain).forEach((c) => hits.set(c.id, c));
  }
  if (excludeId) hits.delete(excludeId);
  return [...hits.values()];
}

/** Active contacts that share the normalised email or phone number. */
export async function findContactMatches(
  supabase: SupabaseClient,
  email: string | null,
  phone: string | null,
  excludeId?: string,
): Promise<ContactHit[]> {
  const e = normalizeEmail(email);
  const p = phoneDigits(phone);
  const hits = new Map<string, ContactHit>();
  const select = "id, full_name, email, phone, company_id, company_name";
  if (e) {
    const { data } = await supabase.from("contact_list").select(select).eq("email_normalized", e).is("archived_at", null).limit(5);
    (data ?? []).forEach((c) => hits.set(c.id, c as ContactHit));
  }
  if (p) {
    const { data } = await supabase.from("contact_list").select(select).eq("phone_normalized", p).is("archived_at", null).limit(5);
    (data ?? []).forEach((c) => hits.set(c.id, c as ContactHit));
  }
  if (excludeId) hits.delete(excludeId);
  return [...hits.values()];
}

export async function findOpenLeadsForContact(supabase: SupabaseClient, contactId: string) {
  const { data } = await supabase
    .from("leads").select("id, lead_number, title, status")
    .eq("contact_id", contactId).is("archived_at", null).in("status", OPEN_STATUSES).limit(5);
  return data ?? [];
}

export const companyMatchToDuplicate = (c: CompanyHit): DuplicateMatch => ({
  id: c.id, label: c.name, detail: [c.city, c.website].filter(Boolean).join(" · ") || "Existing company", href: `/companies/${c.id}`,
});
export const contactMatchToDuplicate = (c: ContactHit): DuplicateMatch => ({
  id: c.id, label: c.full_name,
  detail: [c.company_name, c.email, c.phone].filter(Boolean).join(" · ") || "Existing contact", href: `/contacts/${c.id}`,
});
export const leadMatchToDuplicate = (l: { id: string; lead_number: number; title: string; status: LeadStatus }): DuplicateMatch => ({
  id: l.id, label: l.title, detail: `Open lead · ${LEAD_STATUS_LABELS[l.status]}`, href: `/leads/${l.id}`,
});

export type { CompanyHit, ContactHit };
