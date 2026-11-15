"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorized } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { fail, isUuid, refresh } from "@/lib/actions/util";
import { fieldErrorsFrom } from "@/lib/validation/common";
import { parseImportRows, vendorProfileSchema, vendorRateSchema, type VendorProfileValues, type VendorRateValues } from "@/lib/vendors/core";
import { VENDOR_SETUP, type RateRow } from "@/lib/vendors/repo";

const PATHS = ["/products-services", "/finance/vendors"];
const NO_ACCESS = "Only an administrator or the accounts / management team can change vendors and their rates.";
const dbFail = (e: { code?: string; message: string }, dup = "This record already exists.") =>
  fail(e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || e.code === "42703" ? VENDOR_SETUP
    : e.code === "23505" ? dup : e.code === "42501" || e.message.startsWith("NOT_AUTHORISED") ? NO_ACCESS : "The record could not be saved. Please check the values and try again.");
const like = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
export async function saveVendorProfile(values: VendorProfileValues, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (id && !isUuid(id)) return fail("Vendor not found.");
    const parsed = vendorProfileSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const row = { ...parsed.data, updated_at: new Date().toISOString() };
    const dup = "A vendor with this name already exists. Open that vendor instead of creating a second one.";
    if (id) {
      const { data, error } = await supabase.from("vendors").update(row).eq("id", id).select("id");
      if (error) return dbFail(error, dup);
      if (!data?.length) return fail(NO_ACCESS);
      refresh([...PATHS, `/products-services/vendors/${id}`]);
      return { ok: true, data: { id } };
    }
    const { data, error } = await supabase.from("vendors").insert(row).select("id").single();
    if (error) return dbFail(error, dup);
    refresh(PATHS);
    return { ok: true, data: { id: data.id as string } };
  });
}

export async function addVendorCategory(name: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const n = name.trim().replace(/\s+/g, " ");
    if (n.length < 2 || n.length > 80) return fail("Enter a category name (2 to 80 characters).");
    const { error } = await supabase.from("vendor_categories").insert({ name: n, sort_order: 200 });
    if (error) return dbFail(error, "That category already exists.");
    refresh(PATHS);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
/** The catalogue item with this name (case-insensitive), created if it does not exist yet. Never duplicates an item. */
async function productIdFor(supabase: SupabaseClient, name: string, category: string, description: string, unit: string): Promise<{ id?: string; error?: { code?: string; message: string } }> {
  const { data: existing } = await supabase.from("products_services").select("id").ilike("name", like(name)).limit(1);
  if (existing?.length) return { id: existing[0].id as string };
  // default_rate is the SELLING default used by quotations; it stays 0 so a purchase cost can never leak into a client document.
  const { data, error } = await supabase.from("products_services").insert({ name, category: category || null, description: description || null, unit, default_rate: 0 }).select("id").single();
  return error ? { error } : { id: data.id as string };
}

export async function saveVendorRate(values: VendorRateValues, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (id && !isUuid(id)) return fail("Rate not found.");
    const parsed = vendorRateSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { product_id, product_name, product_category, description, effective_from, ...r } = parsed.data;
    let productId = product_id ?? undefined;
    if (!productId) {
      const p = await productIdFor(supabase, product_name, product_category, description, r.unit);
      if (p.error) return dbFail(p.error);
      productId = p.id;
    }
    const row = { ...r, product_id: productId, ...(effective_from ? { effective_from } : {}) };
    const dup = "This vendor already has a live rate of this type for this service. Update that rate instead: its previous price is kept in the history.";
    if (id) {
      // The database trigger writes the previous price to vendor_rate_history before this update lands.
      const { data, error } = await supabase.from("vendor_rates").update({ ...row, effective_from: effective_from ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) }).eq("id", id).select("id");
      if (error) return dbFail(error, dup);
      if (!data?.length) return fail(NO_ACCESS);
    } else {
      const { data, error } = await supabase.from("vendor_rates").insert(row).select("id").single();
      if (error) return dbFail(error, dup);
      id = data.id as string;
    }
    refresh([...PATHS, `/products-services/vendors/${r.vendor_id}`]);
    return { ok: true, data: { id: id! } };
  });
}

export async function setVendorRateActive(id: string, active: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Rate not found.");
    const { data, error } = await supabase.from("vendor_rates").update({ is_active: !!active }).eq("id", id).select("vendor_id");
    if (error) return dbFail(error, "This vendor already has another live rate of this type for this service.");
    if (!data?.length) return fail(NO_ACCESS);
    refresh([...PATHS, `/products-services/vendors/${data[0].vendor_id}`]);
    return { ok: true };
  });
}

/** Cost reference for the quotation builder. RLS returns nothing to people without a finance role. */
export async function searchVendorRates(q: string): Promise<ActionResult<{ rows: RateRow[] }>> {
  return authorized<{ rows: RateRow[] }>(async ({ supabase }) => {
    const s = q.trim().slice(0, 80).replace(/[^\p{L}\p{N} .&/x-]/gu, " ").trim();
    let query = supabase.from("vendor_rate_list").select("*").eq("is_active", true).neq("vendor_status", "blacklisted");
    if (s) query = query.or(`product_name.ilike.%${s}%,vendor_name.ilike.%${s}%,product_category.ilike.%${s}%`);
    const { data, error } = await query.order("product_name").order("estimated_cost").limit(40);
    if (error) return dbFail(error);
    return { ok: true, data: { rows: (data ?? []) as RateRow[] } };
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export type DeleteKind = "vendor" | "rate" | "item";

/**
 * vendor: soft delete (kept for the expenses and bills that reference it; an administrator can restore it in the database).
 * rate:   soft delete (hidden everywhere; its price history is kept).
 * item:   real delete of a catalogue item, refused while any vendor rate still uses it. Quotation and invoice lines that
 *         were created from it keep their own description and price.
 */
export async function deleteVendorRecord(kind: DeleteKind, id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id) || !["vendor", "rate", "item"].includes(kind)) return fail("Record not found.");
    const now = new Date().toISOString();
    if (kind === "item") {
      const { data, error } = await supabase.from("products_services").delete().eq("id", id).select("id");
      if (error) return error.code === "23503" ? fail("This item still has vendor rates. Delete those rates first, or switch the item to inactive.") : dbFail(error);
      if (!data?.length) return fail(NO_ACCESS);
    } else {
      const { data, error } = await supabase.from(kind === "vendor" ? "vendors" : "vendor_rates").update({ deleted_at: now }).eq("id", id).is("deleted_at", null).select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail(NO_ACCESS);
    }
    refresh(PATHS);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Import (rows the user has reviewed on screen; everything is validated again here)
// ---------------------------------------------------------------------------
export type ImportSummary = { vendorsCreated: number; servicesCreated: number; ratesCreated: number; ratesUpdated: number; skipped: { line: number; reason: string }[] };

export async function importVendorRates(rawRows: Record<string, unknown>[]): Promise<ActionResult<ImportSummary>> {
  return authorized<ImportSummary>(async ({ supabase }) => {
    if (!Array.isArray(rawRows) || rawRows.length === 0) return fail("There is nothing to import.");
    if (rawRows.length > 500) return fail("Import at most 500 rows at a time.");
    const { rows } = parseImportRows(rawRows);
    const out: ImportSummary = { vendorsCreated: 0, servicesCreated: 0, ratesCreated: 0, ratesUpdated: 0, skipped: [] };
    const vendorIds = new Map<string, string>();
    const productIds = new Map<string, string>();

    for (const r of rows) {
      if (r.errors.length) { out.skipped.push({ line: r.line, reason: r.errors.join("; ") }); continue; }
      const vKey = r.vendor.name.toLowerCase();
      let vendorId = vendorIds.get(vKey);
      if (!vendorId) {
        const { data: found } = await supabase.from("vendors").select("id").ilike("name", like(r.vendor.name)).is("deleted_at", null).limit(1);
        if (found?.length) vendorId = found[0].id as string;
        else {
          const { data, error } = await supabase.from("vendors").insert({ ...r.vendor, gst_registered: !!r.vendor.gstin }).select("id").single();
          if (error) { if (out.ratesCreated + out.ratesUpdated === 0 && out.skipped.length === 0) return dbFail(error); out.skipped.push({ line: r.line, reason: "The vendor could not be created" }); continue; }
          vendorId = data.id as string;
          out.vendorsCreated++;
        }
        vendorIds.set(vKey, vendorId);
      }
      const pKey = r.service.name.toLowerCase();
      let productId = productIds.get(pKey);
      if (!productId) {
        const { data: before } = await supabase.from("products_services").select("id").ilike("name", like(r.service.name)).limit(1);
        const p = await productIdFor(supabase, r.service.name, r.service.category, r.service.description, r.rate.unit);
        if (!p.id) { out.skipped.push({ line: r.line, reason: "The service could not be created" }); continue; }
        if (!before?.length) out.servicesCreated++;
        productId = p.id;
        productIds.set(pKey, productId);
      }
      const note = "Imported from spreadsheet";
      const { data: live } = await supabase.from("vendor_rates").select("id").eq("vendor_id", vendorId).eq("product_id", productId).eq("rate_type", r.rate.rate_type).eq("is_active", true).is("deleted_at", null).limit(1);
      if (live?.length) {
        // An existing rate is updated, never duplicated; the trigger keeps its previous price in the history.
        const { error } = await supabase.from("vendor_rates").update({ ...r.rate, change_note: note, effective_from: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) }).eq("id", live[0].id);
        if (error) out.skipped.push({ line: r.line, reason: "The rate could not be updated" }); else out.ratesUpdated++;
      } else {
        const { error } = await supabase.from("vendor_rates").insert({ ...r.rate, vendor_id: vendorId, product_id: productId, change_note: note });
        if (error) { if (error.code === "42501") return fail(NO_ACCESS); out.skipped.push({ line: r.line, reason: "The rate could not be saved" }); } else out.ratesCreated++;
      }
    }
    refresh(PATHS);
    return { ok: true, data: out };
  });
}
