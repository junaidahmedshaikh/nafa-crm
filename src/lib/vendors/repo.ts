import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { isUuid } from "@/lib/ids";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import { RATE_TYPES, VENDOR_STATUSES } from "./core";

export const VENDOR_SETUP = "Vendor rates are not set up yet. Run supabase/migrations/20261120000001_vendor_rates.sql in the Supabase SQL editor.";

export type VendorRow = {
  id: string; name: string; contact_person: string; phone: string; whatsapp: string; email: string; website: string; city: string; state: string;
  service_locations: string; address: string; category: string; services_provided: string; gst_registered: boolean; gstin: string; pan: string;
  payment_terms: string; credit_period_days: number | null; advance_requirement: string; status: string; is_preferred: boolean;
  rating_quality: number | null; rating_pricing: number | null; rating_reliability: number | null; rating_timeliness: number | null;
  feedback: string; past_projects: string; notes: string; overall_rating: number | string | null; rate_count: number; deleted_at: string | null;
};
export type RateRow = {
  id: string; vendor_id: string; vendor_name: string; vendor_city: string; vendor_status: string; is_preferred: boolean; vendor_category: string;
  vendor_rating: number | string | null; product_id: string; product_name: string; product_category: string | null; rate_type: string; unit: string;
  rate: number | string; min_order_qty: number | string | null; rental_duration: string; weekly_rate: number | string | null; monthly_rate: number | string | null;
  security_deposit: number | string | null; damage_charges: string; setup_charges: number | string; transport_charges: number | string; other_charges: number | string;
  gst_percent: number | string; valid_until: string | null; availability: string; service_location: string; specifications: string; notes: string;
  is_active: boolean; effective_from: string; updated_at: string; estimated_cost: number | string; is_expired: boolean;
};
export type RateHistoryRow = {
  id: number; rate_id: string; old_rate: number | string; new_rate: number | string; old_setup_charges: number | string; old_transport_charges: number | string;
  old_other_charges: number | string; old_gst_percent: number | string; old_unit: string; old_effective_from: string; effective_from: string; note: string;
  changed_at: string; author: { full_name: string } | null;
};

export type VendorFilters = { q: string; category: string; status: string; city: string; page: number };
export async function listVendorProfiles(supabase: SupabaseClient, f: VendorFilters) {
  const [from, to] = pageRange(f.page);
  let q = supabase.from("vendor_list").select("*", { count: "exact" }).is("deleted_at", null);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`name.ilike.%${s}%,contact_person.ilike.%${s}%,services_provided.ilike.%${s}%,city.ilike.%${s}%`);
  if (f.category) q = q.eq("category", f.category);
  if ((VENDOR_STATUSES as readonly string[]).includes(f.status)) q = q.eq("status", f.status);
  const c = sanitizeSearch(f.city);
  if (c) q = q.ilike("city", `%${c}%`);
  const { data, count, error } = await q.order("is_preferred", { ascending: false }).order("name").range(from, to);
  return { rows: (data ?? []) as VendorRow[], total: count ?? 0, pageSize: PAGE_SIZE, setupNeeded: !!error };
}

export type RateFilters = { q: string; category: string; vendorCategory: string; type: string; city: string; gst: string; validity: string; min: string; max: string; page: number; sort: string };
export async function listRates(supabase: SupabaseClient, f: RateFilters) {
  const [from, to] = pageRange(f.page);
  let q = supabase.from("vendor_rate_list").select("*", { count: "exact" }).eq("is_active", true);
  const s = sanitizeSearch(f.q);
  if (s) q = q.or(`product_name.ilike.%${s}%,vendor_name.ilike.%${s}%,product_category.ilike.%${s}%,specifications.ilike.%${s}%`);
  if (f.category) q = q.eq("product_category", f.category);
  if (f.vendorCategory) q = q.eq("vendor_category", f.vendorCategory);
  if ((RATE_TYPES as readonly string[]).includes(f.type)) q = q.eq("rate_type", f.type);
  const c = sanitizeSearch(f.city);
  if (c) q = q.or(`vendor_city.ilike.%${c}%,service_location.ilike.%${c}%`);
  if (f.gst === "yes") q = q.gt("gst_percent", 0);
  if (f.gst === "no") q = q.eq("gst_percent", 0);
  if (f.validity === "valid") q = q.eq("is_expired", false);
  if (f.validity === "expired") q = q.eq("is_expired", true);
  if (f.min && Number.isFinite(Number(f.min))) q = q.gte("rate", Number(f.min));
  if (f.max && Number.isFinite(Number(f.max))) q = q.lte("rate", Number(f.max));
  q = f.sort === "highest" ? q.order("estimated_cost", { ascending: false }) : f.sort === "lowest" ? q.order("estimated_cost") : q.order("product_name").order("estimated_cost");
  const { data, count, error } = await q.range(from, to);
  return { rows: (data ?? []) as RateRow[], total: count ?? 0, pageSize: PAGE_SIZE, setupNeeded: !!error };
}

/** Every live rate for one catalogue item, for the side-by-side comparison. */
export async function ratesForProduct(supabase: SupabaseClient, productId: string): Promise<RateRow[]> {
  if (!isUuid(productId)) return [];
  const { data } = await supabase.from("vendor_rate_list").select("*").eq("product_id", productId).eq("is_active", true).limit(200);
  return (data ?? []) as RateRow[];
}

/** Catalogue items that have at least one vendor rate, with how many vendors quote them. */
export async function comparableProducts(supabase: SupabaseClient): Promise<{ id: string; name: string; vendors: number }[]> {
  const { data } = await supabase.from("vendor_rate_list").select("product_id, product_name").eq("is_active", true).limit(5000);
  const m = new Map<string, { id: string; name: string; vendors: number }>();
  for (const r of (data ?? []) as { product_id: string; product_name: string }[]) {
    const cur = m.get(r.product_id) ?? { id: r.product_id, name: r.product_name, vendors: 0 };
    cur.vendors++;
    m.set(r.product_id, cur);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getVendorProfile(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: vendor } = await supabase.from("vendor_list").select("*").eq("id", id).maybeSingle();
  if (!vendor) return null;
  const { data: rates } = await supabase.from("vendor_rate_list").select("*").eq("vendor_id", id).order("is_active", { ascending: false }).order("product_name").limit(500);
  const ids = (rates ?? []).map((r) => r.id as string);
  const { data: history } = ids.length
    ? await supabase.from("vendor_rate_history").select("*, author:profiles(full_name)").in("rate_id", ids).order("changed_at", { ascending: false }).limit(300)
    : { data: [] };
  return { vendor: vendor as VendorRow, rates: (rates ?? []) as RateRow[], history: (history ?? []) as unknown as RateHistoryRow[] };
}

export async function listVendorCategories(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("vendor_categories").select("name").order("sort_order").order("name");
  return (data ?? []).map((c) => c.name as string);
}

export async function vendorOptions(supabase: SupabaseClient): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("vendors").select("id, name").is("deleted_at", null).order("name").limit(2000);
  return (data ?? []) as { id: string; name: string }[];
}
