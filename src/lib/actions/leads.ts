"use server";

import { authorized, getSettings, type MemberContext } from "@/lib/auth";
import { istLocalToIso } from "@/lib/datetime";
import {
  companyMatchToDuplicate, contactMatchToDuplicate, emptyReport, findCompanyMatches, findContactMatches,
  findOpenLeadsForContact, hasDuplicates, leadMatchToDuplicate,
} from "@/lib/data/resolve";
import { normalizeCompanyName } from "@/lib/normalize";
import { fieldErrorsFrom } from "@/lib/validation/common";
import {
  leadSchema, noteSchema, statusChangeSchema, type LeadFormData, type LeadFormInput,
} from "@/lib/validation/schemas";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, isUuid, refresh } from "./util";

export type DuplicateResolution = "use_existing" | "create_new";

async function resolveCompany(
  { supabase }: MemberContext,
  data: LeadFormData,
  currentCompanyId: string | null,
  resolution: DuplicateResolution | undefined,
): Promise<string | null> {
  if (!data.company_name) return null;

  // Editing: keep the lead on its current company when the name still refers to it.
  if (currentCompanyId) {
    const { data: current } = await supabase.from("companies").select("id, name").eq("id", currentCompanyId).maybeSingle();
    if (current && normalizeCompanyName(current.name) === normalizeCompanyName(data.company_name)) {
      if (data.website) await supabase.from("companies").update({ website: data.website }).eq("id", current.id).is("website", null);
      return current.id;
    }
  }
  if (resolution !== "create_new") {
    const [match] = await findCompanyMatches(supabase, data.company_name, null);
    if (match) return match.id;
  }
  const { data: created, error } = await supabase
    .from("companies").insert({ name: data.company_name, website: data.website, city: data.city }).select("id").single();
  if (error) throw error;
  return created.id;
}

async function resolveContact(
  { supabase }: MemberContext,
  data: LeadFormData,
  companyId: string | null,
  currentContactId: string | null,
  resolution: DuplicateResolution | undefined,
): Promise<string | null> {
  if (!data.contact_name) return null;
  const fields = {
    full_name: data.contact_name, designation: data.designation, email: data.email,
    phone: data.phone, whatsapp: data.whatsapp, company_id: companyId,
  };

  if (resolution !== "create_new") {
    const [match] = await findContactMatches(supabase, data.email, data.phone, currentContactId ?? undefined);
    if (match) {
      if (!match.company_id && companyId) await supabase.from("contacts").update({ company_id: companyId }).eq("id", match.id);
      return match.id;
    }
  }
  if (currentContactId) {
    const { error } = await supabase.from("contacts").update(fields).eq("id", currentContactId);
    if (error) throw error;
    return currentContactId;
  }
  const { data: created, error } = await supabase.from("contacts").insert(fields).select("id").single();
  if (error) throw error;
  return created.id;
}

/**
 * Creates (no `id`) or updates a lead, finding-or-creating the linked company and contact.
 * On create, if the company/contact already exists or the contact has other open leads, nothing is
 * written until the user chooses a `resolution` ("use existing records" or "create new records").
 */
export async function saveLead(
  input: LeadFormInput,
  opts: { id?: string; resolution?: DuplicateResolution } = {},
): Promise<ActionResult<{ id: string; warning?: string }>> {
  return authorized<{ id: string; warning?: string }>(async (ctx) => {
    const settings = await getSettings();
    const parsed = leadSchema(settings.default_country_code).safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const data = parsed.data;
    const { supabase, user } = ctx;
    if (opts.id && !isUuid(opts.id)) return fail("Lead not found.");

    let existing: { company_id: string | null; contact_id: string | null } | null = null;
    if (opts.id) {
      const { data: row } = await supabase.from("leads").select("company_id, contact_id").eq("id", opts.id).maybeSingle();
      if (!row) return fail("This lead no longer exists.");
      existing = row;
    } else if (!opts.resolution) {
      const report = emptyReport();
      if (data.company_name) report.companies = (await findCompanyMatches(supabase, data.company_name)).map(companyMatchToDuplicate);
      const contacts = data.contact_name ? await findContactMatches(supabase, data.email, data.phone) : [];
      report.contacts = contacts.map(contactMatchToDuplicate);
      for (const c of contacts) {
        report.leads.push(...(await findOpenLeadsForContact(supabase, c.id)).map(leadMatchToDuplicate));
      }
      if (hasDuplicates(report)) {
        return { ok: false, error: "This looks like it may already exist in your CRM.", duplicates: report };
      }
    }

    const companyId = await resolveCompany(ctx, data, existing?.company_id ?? null, opts.resolution);
    const contactId = await resolveContact(ctx, data, companyId, existing?.contact_id ?? null, opts.resolution);

    const row = {
      title: data.title, company_id: companyId, contact_id: contactId,
      source: data.source, service_category: data.service_category,
      event_name: data.event_name, event_date: data.event_date, city: data.city, venue: data.venue,
      budget_inr: data.budget_inr, expected_revenue_inr: data.expected_revenue_inr,
      status: data.status, priority: data.priority,
      assigned_to: data.assigned_to ?? (opts.id ? null : user.id),
      last_contact_at: data.last_contact_date ? istLocalToIso(`${data.last_contact_date}T00:00`) : null,
      notes: data.notes, lost_reason: data.status === "lost" ? data.lost_reason : null,
    };

    if (opts.id) {
      const { error } = await supabase.from("leads").update(row).eq("id", opts.id);
      if (error) return fail(friendlyDbError(error));
      refresh(["/leads", `/leads/${opts.id}`, "/"]);
      return { ok: true, data: { id: opts.id } };
    }

    const { data: created, error } = await supabase.from("leads").insert(row).select("id").single();
    if (error) return fail(friendlyDbError(error));

    let warning: string | undefined;
    if (data.first_follow_up_at) {
      const { error: fuError } = await supabase.from("follow_ups").insert({
        lead_id: created.id,
        title: `Follow up: ${data.contact_name ?? data.company_name ?? data.title}`,
        due_at: data.first_follow_up_at,
        type: settings.default_follow_up_type,
      });
      if (fuError) warning = "The lead was created, but its follow-up could not be scheduled. Add it from the lead page.";
    }
    refresh(["/leads", "/companies", "/contacts", "/followups", "/"]);
    return { ok: true, data: { id: created.id, warning } };
  });
}

export async function changeLeadStatus(leadId: string, input: { status: string; lost_reason?: string }): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(leadId)) return fail("Lead not found.");
    const parsed = statusChangeSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { data, error } = await supabase
      .from("leads")
      .update({ status: parsed.data.status, lost_reason: parsed.data.status === "lost" ? parsed.data.lost_reason : null })
      .eq("id", leadId).select("id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This lead no longer exists.");
    refresh(["/leads", `/leads/${leadId}`, "/followups", "/"]);
    return { ok: true };
  });
}

export async function addLeadNote(leadId: string, input: { note: string }): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(leadId)) return fail("Lead not found.");
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { error } = await supabase.from("lead_activities").insert({ lead_id: leadId, type: "note", summary: parsed.data.note });
    if (error) return fail(friendlyDbError(error));
    refresh([`/leads/${leadId}`]);
    return { ok: true };
  });
}

export async function setLeadArchived(leadId: string, archived: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(leadId)) return fail("Lead not found.");
    const { data, error } = await supabase
      .from("leads").update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", leadId).select("id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This lead no longer exists.");
    refresh(["/leads", `/leads/${leadId}`, "/followups", "/"]);
    return { ok: true };
  });
}
