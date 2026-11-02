"use server";

import { authorized, getSettings } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { fieldErrorsFrom } from "@/lib/validation/common";
import { evaluateAudience, SKIP_LABELS, type AudienceContact } from "@/lib/whatsapp/audience";
import { processBatch, type BatchResult } from "@/lib/whatsapp/engine";
import { ProviderNotConfigured, providerFor } from "@/lib/whatsapp/provider";
import { getWaSettings, liveConnected, recentlyMessaged } from "@/lib/whatsapp/repo";
import {
  campaignInputSchema, consentInputSchema, templateInputSchema, waSettingsSchema, TEMPLATE_STATUSES,
  type CampaignInput, type TemplateInput, type WaSettingsInput,
} from "@/lib/whatsapp/schemas";
import { checkTemplate, customPlaceholders, renderTemplate } from "@/lib/whatsapp/template";

const DB_MESSAGES: Record<string, string> = {
  ADMIN_ONLY: "Only an admin can do that.",
  OPT_OUT_LOCKED: "Someone in this list opted out of WhatsApp. Only an admin can record a new opt-in for them.",
};
function dbMessage(error: { code?: string; message: string }): string {
  const code = /^[A-Z_]+/.exec(error.message)?.[0];
  if (code && DB_MESSAGES[code]) return DB_MESSAGES[code];
  if (error.code === "23505") return "A template with this name and language already exists.";
  if (error.message.includes("whatsapp_opt_in_has_source")) return "Say how consent was given (for example “Signed form, 12 Oct”).";
  return friendlyDbError(error);
}
const notSetUp = (e: unknown) => (e instanceof Error && e.message.includes("not set up") ? e.message : null);
const PATHS = ["/whatsapp", "/whatsapp/templates"];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function saveTemplate(values: TemplateInput, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized(async ({ supabase }) => {
    const parsed = templateInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Template not found.");
    const t = parsed.data;
    const c = checkTemplate({ body: t.body, footer: t.footer, category: t.category });
    if (c.errors.length) return fail(c.errors[0], { body: c.errors[0] });
    const row = { ...t, footer: t.footer };
    if (id) {
      const { data, error } = await supabase.from("whatsapp_templates").update(row).eq("id", id).select("id").maybeSingle();
      if (error) return fail(dbMessage(error));
      if (!data) return fail("This template no longer exists.");
      refresh([...PATHS, `/whatsapp/templates/${id}`]);
      return { ok: true, data: { id } };
    }
    const { data, error } = await supabase.from("whatsapp_templates").insert(row).select("id").single();
    if (error) return fail(dbMessage(error));
    refresh(PATHS);
    return { ok: true, data: { id: data.id } };
  });
}

export async function setTemplateArchived(id: string, archived: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Template not found.");
    const { data, error } = await supabase.from("whatsapp_templates").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("This template no longer exists.");
    refresh([...PATHS, `/whatsapp/templates/${id}`]);
    return { ok: true };
  });
}

/** Admin only (enforced in the database). While live sending is not connected, this records the approval by hand. */
export async function setTemplateStatus(id: string, status: string, rejectionReason?: string): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (!isUuid(id) || !(TEMPLATE_STATUSES as readonly string[]).includes(status)) return fail("Template not found.");
    if (profile.role !== "admin") return fail(DB_MESSAGES.ADMIN_ONLY);
    const { data, error } = await supabase.from("whatsapp_templates")
      .update({ status, rejection_reason: status === "rejected" ? (rejectionReason?.trim() || null) : null }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("This template no longer exists.");
    refresh([...PATHS, `/whatsapp/templates/${id}`]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
export async function setContactsConsent(values: { contact_ids: string[]; status: string; source?: string }): Promise<ActionResult<{ updated: number }>> {
  return authorized(async ({ supabase, profile }) => {
    const parsed = consentInputSchema.safeParse(values);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the selection.");
    const { contact_ids, status, source } = parsed.data;
    if (status === "opted_in" && !source) return fail("Say how consent was given (for example “Signed form, 12 Oct”).", { source: "Required" });
    let updated = 0;
    for (let i = 0; i < contact_ids.length; i += 100) {
      let q = supabase.from("contacts").update({ whatsapp_consent: status, whatsapp_consent_source: status === "opted_in" ? source : status === "unknown" ? null : (source ?? "Recorded in CRM") }).in("id", contact_ids.slice(i, i + 100));
      // Someone who opted out is only re-opted-in by an admin; skip them for everyone else instead of failing the batch.
      if (status === "opted_in" && profile.role !== "admin") q = q.neq("whatsapp_consent", "opted_out");
      const { data, error } = await q.select("id");
      if (error) return fail(dbMessage(error));
      updated += data?.length ?? 0;
    }
    refresh(["/contacts", "/whatsapp/campaigns/new"]);
    return { ok: true, data: { updated } };
  });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
type CampaignCreated = { id: string; queued: number; skipped: number };

export async function createCampaign(values: CampaignInput): Promise<ActionResult<CampaignCreated>> {
  return authorized<CampaignCreated>(async ({ supabase }) => {
    const parsed = campaignInputSchema.safeParse(values);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please fix the form.", fieldErrorsFrom(parsed.error));
    const input = parsed.data;

    let settings;
    try { settings = await getWaSettings(supabase); } catch (e) { return fail(notSetUp(e) ?? "Could not load WhatsApp settings."); }

    const { data: template } = await supabase.from("whatsapp_templates").select("*").eq("id", input.template_id).maybeSingle();
    if (!template || template.archived_at) return fail("Choose an active template.");
    if (template.status === "rejected") return fail("WhatsApp rejected this template. Edit it and get it approved again.");
    if (settings.mode === "live") {
      if (template.status !== "approved") return fail("Live campaigns can only use templates that WhatsApp has approved.");
      if (!liveConnected()) return fail("Live sending is not connected yet. Add the WhatsApp credentials to the server environment, or switch to dry-run.");
    }

    // Campaign-wide placeholders (event name, date…) must all be filled in.
    const needed = customPlaceholders(template.body);
    const custom: Record<string, string> = {};
    const fieldErrors: Record<string, string> = {};
    for (const name of needed) {
      const v = (input.custom_values[name] ?? "").trim();
      if (!v) fieldErrors[`custom.${name}`] = "Required";
      else custom[name] = v;
    }
    if (Object.keys(fieldErrors).length) return fail("Fill in the template values.", fieldErrors);

    const ids = [...new Set(input.contact_ids)];
    const rows: (AudienceContact & { company_name: string | null; designation: string | null })[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from("contact_list").select("id, full_name, phone, whatsapp, whatsapp_consent, archived_at, company_name, designation").in("id", ids.slice(i, i + 100));
      if (error) return fail(dbMessage(error));
      rows.push(...((data ?? []) as typeof rows));
    }
    const country = (await getSettings()).default_country_code;
    const recent = await recentlyMessaged(supabase, settings.repeat_window_days, ids);
    const audience = evaluateAudience(rows, { defaultCountryCode: country, recentlyMessaged: recent });
    if (audience.eligible.length === 0) {
      const why = Object.entries(audience.skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} × ${SKIP_LABELS[k as keyof typeof SKIP_LABELS]}`).join(", ");
      return fail(`Nobody in this selection can be messaged (${why || "no contacts found"}).`);
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    const messages = audience.eligible.map((e) => {
      const c = byId.get(e.contact.id)!;
      const r = renderTemplate(template, { full_name: c.full_name, company_name: c.company_name, designation: c.designation }, custom);
      return { contact_id: c.id, to_phone: e.phone, body: r.text, params: r.params };
    });

    const { data: campaign, error: cErr } = await supabase.from("whatsapp_campaigns")
      .insert({ name: input.name, template_id: template.id, mode: settings.mode, custom_values: custom }).select("id").single();
    if (cErr) return fail(dbMessage(cErr));
    for (let i = 0; i < messages.length; i += 500) {
      const { error } = await supabase.from("whatsapp_messages").insert(messages.slice(i, i + 500).map((m) => ({ ...m, campaign_id: campaign.id })));
      if (error) {
        await supabase.from("whatsapp_campaigns").delete().eq("id", campaign.id); // cascades to the messages queued so far
        return fail("Could not queue the messages. Nothing was sent.");
      }
    }
    refresh(PATHS);
    return { ok: true, data: { id: campaign.id, queued: messages.length, skipped: ids.length - messages.length } };
  });
}

/** Sends the next small batch. The campaign page calls this repeatedly until the queue is empty or paused. */
export async function sendNextBatch(campaignId: string): Promise<ActionResult<BatchResult>> {
  return authorized<BatchResult>(async ({ supabase }) => {
    if (!isUuid(campaignId)) return fail("Campaign not found.");
    const { data: campaign } = await supabase.from("whatsapp_campaigns").select("mode").eq("id", campaignId).maybeSingle();
    if (!campaign) return fail("Campaign not found.");
    let provider;
    try { provider = providerFor(campaign.mode); } catch (e) {
      if (e instanceof ProviderNotConfigured) return fail(e.message);
      throw e;
    }
    const result = await processBatch(supabase, campaignId, provider);
    refresh([`/whatsapp/campaigns/${campaignId}`, "/whatsapp"]);
    return { ok: true, data: result };
  });
}

export async function pauseCampaign(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Campaign not found.");
    const { data, error } = await supabase.from("whatsapp_campaigns").update({ status: "paused", paused_reason: "Paused by a team member." }).eq("id", id).in("status", ["ready", "sending"]).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("This campaign is not running.");
    refresh([`/whatsapp/campaigns/${id}`, "/whatsapp"]);
    return { ok: true };
  });
}

export async function resumeCampaign(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Campaign not found.");
    const { data, error } = await supabase.from("whatsapp_campaigns").update({ status: "ready", paused_reason: null }).eq("id", id).eq("status", "paused").select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("This campaign is not paused.");
    refresh([`/whatsapp/campaigns/${id}`, "/whatsapp"]);
    return { ok: true };
  });
}

export async function cancelCampaign(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Campaign not found.");
    const { data, error } = await supabase.from("whatsapp_campaigns").update({ status: "cancelled", paused_reason: null, completed_at: new Date().toISOString() }).eq("id", id).in("status", ["ready", "sending", "paused"]).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("This campaign has already finished.");
    await supabase.from("whatsapp_messages").update({ status: "skipped", error: "Campaign cancelled before this was sent." }).eq("campaign_id", id).eq("status", "queued");
    refresh([`/whatsapp/campaigns/${id}`, "/whatsapp"]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Settings (admin)
// ---------------------------------------------------------------------------
export async function saveWaSettings(values: WaSettingsInput): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail(DB_MESSAGES.ADMIN_ONLY);
    const parsed = waSettingsSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (parsed.data.mode === "live" && !liveConnected()) {
      return fail("Live sending needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the server environment first.", { mode: "Not connected yet" });
    }
    const { error } = await supabase.from("whatsapp_settings").update(parsed.data).eq("id", true);
    if (error) return fail(dbMessage(error));
    refresh([...PATHS, "/whatsapp/settings"]);
    return { ok: true };
  });
}
