"use server";

import { authorized, getSettings } from "@/lib/auth";
import {
  companyMatchToDuplicate, contactMatchToDuplicate, emptyReport, findCompanyMatches, findContactMatches, hasDuplicates,
} from "@/lib/data/resolve";
import { fieldErrorsFrom } from "@/lib/validation/common";
import {
  companySchema, contactSchema, type CompanyFormInput, type ContactFormInput,
} from "@/lib/validation/schemas";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, isUuid, refresh } from "./util";

export async function saveCompany(
  input: CompanyFormInput,
  opts: { id?: string; confirmDuplicate?: boolean } = {},
): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    const parsed = companySchema.safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (opts.id && !isUuid(opts.id)) return fail("Company not found.");

    if (!opts.confirmDuplicate) {
      const matches = await findCompanyMatches(supabase, parsed.data.name, parsed.data.website, opts.id);
      if (matches.length) {
        const report = { ...emptyReport(), companies: matches.map(companyMatchToDuplicate) };
        return { ok: false, error: "A company with the same name or website already exists.", duplicates: report };
      }
    }
    if (opts.id) {
      const { data, error } = await supabase.from("companies").update(parsed.data).eq("id", opts.id).select("id").maybeSingle();
      if (error) return fail(friendlyDbError(error));
      if (!data) return fail("This company no longer exists.");
      refresh(["/companies", `/companies/${opts.id}`, "/leads"]);
      return { ok: true, data: { id: opts.id } };
    }
    const { data, error } = await supabase.from("companies").insert(parsed.data).select("id").single();
    if (error) return fail(friendlyDbError(error));
    refresh(["/companies"]);
    return { ok: true, data: { id: data.id } };
  });
}

export async function setCompanyArchived(id: string, archived: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Company not found.");
    const { data, error } = await supabase
      .from("companies").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This company no longer exists.");
    refresh(["/companies", `/companies/${id}`]);
    return { ok: true };
  });
}

export async function saveContact(
  input: ContactFormInput,
  opts: { id?: string; confirmDuplicate?: boolean } = {},
): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    const settings = await getSettings();
    const parsed = contactSchema(settings.default_country_code).safeParse(input);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (opts.id && !isUuid(opts.id)) return fail("Contact not found.");

    if (!opts.confirmDuplicate) {
      const matches = await findContactMatches(supabase, parsed.data.email, parsed.data.phone, opts.id);
      if (matches.length) {
        const report = { ...emptyReport(), contacts: matches.map(contactMatchToDuplicate) };
        if (hasDuplicates(report)) {
          return { ok: false, error: "A contact with the same email or phone number already exists.", duplicates: report };
        }
      }
    }
    if (opts.id) {
      const { data, error } = await supabase.from("contacts").update(parsed.data).eq("id", opts.id).select("id").maybeSingle();
      if (error) return fail(friendlyDbError(error));
      if (!data) return fail("This contact no longer exists.");
      refresh(["/contacts", `/contacts/${opts.id}`, "/leads"]);
      return { ok: true, data: { id: opts.id } };
    }
    const { data, error } = await supabase.from("contacts").insert(parsed.data).select("id").single();
    if (error) return fail(friendlyDbError(error));
    refresh(["/contacts", "/companies"]);
    return { ok: true, data: { id: data.id } };
  });
}

export async function setContactArchived(id: string, archived: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Contact not found.");
    const { data, error } = await supabase
      .from("contacts").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(friendlyDbError(error));
    if (!data) return fail("This contact no longer exists.");
    refresh(["/contacts", `/contacts/${id}`]);
    return { ok: true };
  });
}
