import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import type { Company, CompanyRow, Contact, ContactRow, Lead } from "@/lib/types";

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function listCompanies(supabase: SupabaseClient, opts: { q: string; page: number; archived: boolean }) {
  const [from, to] = pageRange(opts.page);
  let query = supabase.from("company_list").select("*", { count: "exact" });
  query = opts.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const s = sanitizeSearch(opts.q);
  if (s) query = query.or(`name.ilike.%${s}%,city.ilike.%${s}%,industry.ilike.%${s}%,website.ilike.%${s}%`);
  const { data, count, error } = await query.order("name").range(from, to);
  if (error) throw new Error(`Could not load companies: ${error.message}`);
  return { rows: (data ?? []) as CompanyRow[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function getCompany(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: company } = await supabase.from("company_list").select("*").eq("id", id).maybeSingle();
  if (!company) return null;
  const [{ data: contacts }, { data: leads }] = await Promise.all([
    supabase.from("contact_list").select("*").eq("company_id", id).is("archived_at", null).order("full_name"),
    supabase.from("lead_list").select("*").eq("company_id", id).is("archived_at", null).order("created_at", { ascending: false }),
  ]);
  return { company: company as CompanyRow, contacts: (contacts ?? []) as ContactRow[], leads: (leads ?? []) as Lead[] };
}

export async function listContacts(
  supabase: SupabaseClient,
  opts: { q: string; page: number; archived: boolean; companyId?: string | null },
) {
  const [from, to] = pageRange(opts.page);
  let query = supabase.from("contact_list").select("*", { count: "exact" });
  query = opts.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (opts.companyId && isUuid(opts.companyId)) query = query.eq("company_id", opts.companyId);
  const s = sanitizeSearch(opts.q);
  if (s) {
    const digits = s.replace(/\D/g, "");
    const parts = [`full_name.ilike.%${s}%`, `email.ilike.%${s}%`, `designation.ilike.%${s}%`, `company_name.ilike.%${s}%`, `phone.ilike.%${s}%`];
    if (digits.length >= 3) parts.push(`phone_normalized.ilike.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data, count, error } = await query.order("full_name").range(from, to);
  if (error) throw new Error(`Could not load contacts: ${error.message}`);
  return { rows: (data ?? []) as ContactRow[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function getContact(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: contact } = await supabase.from("contact_list").select("*").eq("id", id).maybeSingle();
  if (!contact) return null;
  const { data: leads } = await supabase
    .from("lead_list").select("*").eq("contact_id", id).is("archived_at", null).order("created_at", { ascending: false });
  return { contact: contact as ContactRow, leads: (leads ?? []) as Lead[] };
}

/** Light-weight company options for selects and autocompletion. */
export async function listCompanyOptions(supabase: SupabaseClient): Promise<Pick<Company, "id" | "name">[]> {
  const { data } = await supabase.from("companies").select("id, name").is("archived_at", null).order("name").limit(1000);
  return data ?? [];
}

export type { Company, Contact };
