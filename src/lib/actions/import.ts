"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorized, getSettings } from "@/lib/auth";
import { analyzeImport, IMPORT_MAX_ROWS, leadDuplicateKey, type RawRow, type RowResult } from "@/lib/csv";
import { istLocalToIso } from "@/lib/datetime";
import { normalizeCompanyName, normalizeEmail, phoneDigits } from "@/lib/normalize";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, refresh } from "./util";

export type ImportRowReport = { row: number; status: "valid" | "duplicate" | "invalid"; messages: string[]; title?: string };
export type ImportPreview = {
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
  unknownHeaders: string[];
  rows: ImportRowReport[];
};
export type ImportSummary = {
  imported: number;
  skippedDuplicates: number;
  invalid: number;
  companiesCreated: number;
  companiesReused: number;
  contactsCreated: number;
  contactsReused: number;
  followUpsScheduled: number;
};

type Payload = { headers: string[]; rows: RawRow[] };

function validatePayload(p: Payload): string | null {
  if (!Array.isArray(p.headers) || !Array.isArray(p.rows)) return "The file could not be read.";
  if (p.rows.length === 0) return "The file contains no data rows.";
  if (p.rows.length > IMPORT_MAX_ROWS) return `A single import can contain at most ${IMPORT_MAX_ROWS} rows (this file has ${p.rows.length}). Split the file and import it in parts.`;
  return null;
}

async function existingLeadKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await supabase
      .from("lead_list").select("title, contact_email, contact_phone_digits, company_name").is("archived_at", null).range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) keys.add(leadDuplicateKey(l.title, l.contact_email, l.contact_phone_digits, l.company_name));
    if (!data || data.length < 1000) break;
  }
  return keys;
}

function toReport(r: RowResult): ImportRowReport {
  if (r.status === "invalid") return { row: r.row, status: "invalid", messages: r.errors };
  return { row: r.row, status: r.status, messages: r.status === "duplicate" ? [r.reason] : [], title: r.data.title };
}

/** Dry run: validates and reports every row without writing anything. */
export async function previewLeadImport(payload: Payload): Promise<ActionResult<ImportPreview>> {
  return authorized<ImportPreview>(async ({ supabase }) => {
    const problem = validatePayload(payload);
    if (problem) return fail(problem);
    const settings = await getSettings();
    const { results, unknownHeaders, missingRequiredHeader } = analyzeImport(
      payload.rows, payload.headers, settings.default_country_code, await existingLeadKeys(supabase),
    );
    if (missingRequiredHeader) return fail('The file needs a "title" column (also accepted: lead, lead_title, opportunity).');
    return {
      ok: true,
      data: {
        total: results.length,
        valid: results.filter((r) => r.status === "valid").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        invalid: results.filter((r) => r.status === "invalid").length,
        unknownHeaders,
        rows: results.filter((r) => r.status !== "valid").map(toReport),
      },
    };
  });
}

/**
 * Imports the valid rows (and, if requested, rows flagged as duplicates). The file is re-validated
 * here: the preview is never trusted. Invalid rows are never imported and are returned in the report.
 */
export async function commitLeadImport(
  payload: Payload,
  opts: { includeDuplicates: boolean },
): Promise<ActionResult<ImportSummary & { rows: ImportRowReport[] }>> {
  return authorized<ImportSummary & { rows: ImportRowReport[] }>(async ({ supabase, user }) => {
    const problem = validatePayload(payload);
    if (problem) return fail(problem);
    const settings = await getSettings();
    const { results, missingRequiredHeader } = analyzeImport(
      payload.rows, payload.headers, settings.default_country_code, await existingLeadKeys(supabase),
    );
    if (missingRequiredHeader) return fail('The file needs a "title" column.');

    const importable = results.filter(
      (r): r is Extract<RowResult, { data: unknown }> => r.status === "valid" || (opts.includeDuplicates && r.status === "duplicate"),
    );
    const summary: ImportSummary = {
      imported: 0, invalid: results.filter((r) => r.status === "invalid").length,
      skippedDuplicates: opts.includeDuplicates ? 0 : results.filter((r) => r.status === "duplicate").length,
      companiesCreated: 0, companiesReused: 0, contactsCreated: 0, contactsReused: 0, followUpsScheduled: 0,
    };
    const rowsReport = results.filter((r) => r.status !== "valid" && !(opts.includeDuplicates && r.status === "duplicate")).map(toReport);
    if (importable.length === 0) return { ok: true, data: { ...summary, rows: rowsReport } };

    // --- companies: reuse by normalised name, create the rest in one statement ---
    const companyIds = new Map<string, string>();
    const wantedCompanies = new Map<string, { name: string; website: string | null; city: string | null }>();
    for (const r of importable) {
      const name = r.data.company_name;
      if (name && !wantedCompanies.has(normalizeCompanyName(name))) {
        wantedCompanies.set(normalizeCompanyName(name), { name, website: r.data.website, city: r.data.city });
      }
    }
    if (wantedCompanies.size) {
      const { data: found, error } = await supabase
        .from("companies").select("id, name_normalized").in("name_normalized", [...wantedCompanies.keys()]).is("archived_at", null);
      if (error) return fail(friendlyDbError(error));
      for (const c of found ?? []) companyIds.set(c.name_normalized, c.id);
      summary.companiesReused = companyIds.size;
      const toCreate = [...wantedCompanies.entries()].filter(([k]) => !companyIds.has(k)).map(([, v]) => v);
      if (toCreate.length) {
        const { data: created, error: cErr } = await supabase.from("companies").insert(toCreate).select("id, name_normalized");
        if (cErr) return fail(friendlyDbError(cErr));
        for (const c of created ?? []) companyIds.set(c.name_normalized, c.id);
        summary.companiesCreated = toCreate.length;
      }
    }

    // --- contacts: reuse by email, then phone; create the rest in one statement ---
    const contactKeyOf = (d: (typeof importable)[number]["data"]) =>
      normalizeEmail(d.email) ?? phoneDigits(d.phone) ?? `${d.contact_name?.toLowerCase()}|${d.company_name ? normalizeCompanyName(d.company_name) : ""}`;
    const contactIds = new Map<string, string>();
    const emails = [...new Set(importable.map((r) => normalizeEmail(r.data.email)).filter((v): v is string => !!v))];
    const phones = [...new Set(importable.map((r) => phoneDigits(r.data.phone)).filter((v): v is string => !!v))];
    const byEmail = new Map<string, string>();
    const byPhone = new Map<string, string>();
    if (emails.length) {
      const { data } = await supabase.from("contacts").select("id, email_normalized").in("email_normalized", emails).is("archived_at", null);
      (data ?? []).forEach((c) => byEmail.set(c.email_normalized, c.id));
    }
    if (phones.length) {
      const { data } = await supabase.from("contacts").select("id, phone_normalized").in("phone_normalized", phones).is("archived_at", null);
      (data ?? []).forEach((c) => byPhone.set(c.phone_normalized, c.id));
    }
    const newContacts = new Map<string, Record<string, unknown>>();
    for (const r of importable) {
      const d = r.data;
      if (!d.contact_name) continue;
      const key = contactKeyOf(d);
      if (contactIds.has(key) || newContacts.has(key)) continue;
      const existing = (normalizeEmail(d.email) && byEmail.get(normalizeEmail(d.email)!)) || (phoneDigits(d.phone) && byPhone.get(phoneDigits(d.phone)!));
      if (existing) {
        contactIds.set(key, existing);
        summary.contactsReused++;
      } else {
        newContacts.set(key, {
          full_name: d.contact_name, designation: d.designation, email: d.email, phone: d.phone, whatsapp: d.whatsapp,
          company_id: d.company_name ? (companyIds.get(normalizeCompanyName(d.company_name)) ?? null) : null,
        });
      }
    }
    if (newContacts.size) {
      const keys = [...newContacts.keys()];
      const { data: created, error } = await supabase.from("contacts").insert(keys.map((k) => newContacts.get(k)!)).select("id");
      if (error || !created || created.length !== keys.length) return fail(error ? friendlyDbError(error) : "Contacts could not be created.");
      keys.forEach((k, i) => contactIds.set(k, created[i].id));
      summary.contactsCreated = keys.length;
    }

    // --- leads: one atomic insert ---
    const leadRows = importable.map((r) => {
      const d = r.data;
      return {
        title: d.title,
        company_id: d.company_name ? (companyIds.get(normalizeCompanyName(d.company_name)) ?? null) : null,
        contact_id: d.contact_name ? (contactIds.get(contactKeyOf(d)) ?? null) : null,
        source: d.source, service_category: d.service_category, event_name: d.event_name, event_date: d.event_date,
        city: d.city, venue: d.venue, budget_inr: d.budget_inr, expected_revenue_inr: d.expected_revenue_inr,
        status: d.status, priority: d.priority, assigned_to: user.id,
        last_contact_at: d.last_contact_date ? istLocalToIso(`${d.last_contact_date}T00:00`) : null,
        notes: d.notes, lost_reason: d.status === "lost" ? d.lost_reason : null,
      };
    });
    const { data: createdLeads, error: leadErr } = await supabase.from("leads").insert(leadRows).select("id");
    if (leadErr || !createdLeads || createdLeads.length !== leadRows.length) {
      return fail(`Import failed and no leads were added: ${leadErr ? friendlyDbError(leadErr) : "unexpected response"}.`);
    }
    summary.imported = createdLeads.length;

    // --- follow-ups for rows that specified next_follow_up (skipped for closed leads) ---
    const followUps = importable
      .map((r, i) => ({ r, id: createdLeads[i].id }))
      .filter(({ r }) => r.data.first_follow_up_at && r.data.status !== "won" && r.data.status !== "lost")
      .map(({ r, id }) => ({
        lead_id: id, title: `Follow up: ${r.data.contact_name ?? r.data.company_name ?? r.data.title}`,
        due_at: r.data.first_follow_up_at, type: settings.default_follow_up_type,
      }));
    if (followUps.length) {
      const { error } = await supabase.from("follow_ups").insert(followUps);
      if (!error) summary.followUpsScheduled = followUps.length;
    }

    refresh(["/leads", "/companies", "/contacts", "/followups", "/"]);
    return { ok: true, data: { ...summary, rows: rowsReport } };
  });
}
