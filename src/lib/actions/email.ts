"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { isValidEmail, normalizeEmail, resolveAudience, type AudienceFilters } from "@/lib/email/audience";
import { composeEmail, type CampaignContent } from "@/lib/email/compose";
import { rebuildRecipients } from "@/lib/email/recipients";
import { processEmailQueue, type EmailSettings, type ProcessSummary } from "@/lib/email/processor";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { formatFrom, sendMarketingEmail } from "@/lib/email/send";
import { istLocalToIso } from "@/lib/datetime";
import { emailConfigured } from "@/lib/documents/email";
import type { ActionResult } from "@/lib/types";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";

const PATHS = ["/email-marketing", "/email-marketing/campaigns", "/email-marketing/outbox"];
const log = (supabase: import("@supabase/supabase-js").SupabaseClient, campaign_id: string | null, action: string, details: object = {}) =>
  supabase.from("email_audit_log").insert({ campaign_id, action, details });

// ---------------------------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------------------------
const filtersSchema = z.object({
  categories: z.array(z.string().max(60)).max(20).optional(),
  industries: z.array(z.string().max(80)).max(20).optional(),
  cities: z.array(z.string().max(80)).max(20).optional(),
  states: z.array(z.string().max(80)).max(20).optional(),
  leadStatuses: z.array(z.string().max(40)).max(10).optional(),
  notContactedDays: z.number().int().min(1).max(3650).optional(),
  contactedCampaignBefore: z.enum(["yes", "no"]).optional(),
  search: z.string().max(100).optional(),
  contactIds: z.array(z.string().uuid()).max(5000).optional(),
  groupIds: z.array(z.string().uuid()).max(200).optional(),
  leadPriorities: z.array(z.string().max(10)).max(3).optional(),
  emailVerifiedOnly: z.boolean().optional(),
});

export type AudiencePreview = {
  totalContacts: number; matched: number; eligible: number;
  excluded: Record<string, number>;
  perGroup: { id: string; name: string; type: string; count: number }[];
  totalWithDuplicates: number;
  sample: { id: string; name: string; email: string; company: string | null; city: string | null }[];
};

export async function previewAudience(filters: AudienceFilters): Promise<ActionResult<AudiencePreview>> {
  return authorized(async ({ supabase }) => {
    const f = filtersSchema.safeParse(filters);
    if (!f.success) return fail("Invalid filters.");
    const a = await resolveAudience(supabase, f.data);
    const excluded: Record<string, number> = {};
    for (const e of a.excluded) excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
    return {
      ok: true,
      data: {
        totalContacts: a.totalContacts, matched: a.matched.length, eligible: a.eligible.length, excluded, perGroup: a.perGroup, totalWithDuplicates: a.totalWithDuplicates,
        sample: a.eligible.slice(0, 8).map((c) => ({ id: c.id, name: c.fullName, email: c.email!, company: c.companyName, city: c.city })),
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Campaign drafts
// ---------------------------------------------------------------------------------------------
const campaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Campaign name is required").max(200),
  objective: z.string().trim().max(500).default(""),
  subject: z.string().trim().max(300).default(""),
  bodyHtml: z.string().max(60000).default(""),
  style: z.string().max(40).default("professional"),
  senderName: z.string().trim().max(120).default(""),
  senderEmail: z.string().trim().max(254).default(""),
  replyTo: z.string().trim().max(254).default(""),
  salespersonName: z.string().trim().max(120).default(""),
  audience: filtersSchema,
  fallbacks: z.record(z.string(), z.string().max(120)).default({}),
  dailyLimit: z.number().int().min(1).max(5000).nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
});
export type CampaignInput = z.input<typeof campaignSchema>;

/** Saves a campaign as a draft and (re)builds its recipient list. Never activates anything. */
export async function saveCampaignDraft(input: CampaignInput): Promise<ActionResult<{ id: string; recipients: number; missingFields: number }>> {
  return authorized(async ({ supabase, profile, user }) => {
    if (!(await limitUser(user.id, "heavy"))) return fail(TOO_MANY);
    const p = campaignSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the campaign details.");
    const d = p.data;
    for (const [label, v] of [["Sender email", d.senderEmail], ["Reply-to email", d.replyTo]] as const) if (v && !isValidEmail(v)) return fail(`${label} is not a valid email address.`);
    const values = {
      name: d.name, objective: d.objective, subject: d.subject, body_html: sanitizeEmailHtml(d.bodyHtml), style: d.style,
      sender_name: d.senderName, sender_email: d.senderEmail, reply_to: d.replyTo, audience: d.audience, fallbacks: d.fallbacks,
      daily_limit: d.dailyLimit ?? null, template_id: d.templateId ?? null, salesperson_name: d.salespersonName || profile.full_name,
    };
    let id = d.id;
    if (id) {
      const { data: existing } = await supabase.from("email_campaigns").select("status").eq("id", id).maybeSingle();
      if (!existing) return fail("That campaign no longer exists.");
      if (existing.status !== "draft") return fail("Only a draft can be edited. Use “Edit campaign” to move it back to draft first.");
      const { error } = await supabase.from("email_campaigns").update(values).eq("id", id);
      if (error) return fail(friendlyDbError(error));
    } else {
      const { data, error } = await supabase.from("email_campaigns").insert(values).select("id").single();
      if (error || !data) return fail(error ? friendlyDbError(error) : "Could not save the campaign.");
      id = data.id as string;
      await log(supabase, id, "created", { name: d.name });
    }
    const r = await rebuildRecipients(supabase, id!);
    await log(supabase, id!, "draft_saved", { recipients: r.total });
    refresh(PATHS);
    return { ok: true, data: { id: id!, recipients: r.total - r.skippedMissing, missingFields: r.skippedMissing } };
  });
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { data, error } = await supabase.from("email_campaigns").delete().eq("id", id).eq("status", "draft").select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("Only draft campaigns can be deleted.");
    refresh(PATHS);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Preview and test send
// ---------------------------------------------------------------------------------------------
export type RenderedPreview = { email: string; name: string; subject: string; html: string; missing: string[] };

export async function previewCampaignRecipients(campaignId: string, count = 3): Promise<ActionResult<RenderedPreview[]>> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(campaignId)) return fail("Invalid campaign.");
    const [{ data: camp }, { data: st }, { data: rcpts }] = await Promise.all([
      supabase.from("email_campaigns").select("*").eq("id", campaignId).maybeSingle(),
      supabase.from("email_settings").select("*").single(),
      supabase.from("email_recipients").select("*").eq("campaign_id", campaignId).in("status", ["pending", "skipped"]).limit(300),
    ]);
    if (!camp) return fail("That campaign no longer exists.");
    const settings = st as EmailSettings;
    const pool = [...(rcpts ?? [])].sort(() => Math.random() - 0.5).slice(0, Math.min(count, 5));
    const ids = pool.map((r) => r.contact_id).filter(Boolean);
    const { data: contacts } = ids.length ? await supabase.from("contacts").select("id, designation, company:companies(name, industry, city, website)").in("id", ids) : { data: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmap = new Map((contacts ?? []).map((c: any) => [c.id, c]));
    const content: CampaignContent = { subject: camp.subject, bodyHtml: camp.body_html, fallbacks: camp.fallbacks ?? {}, salespersonName: camp.salesperson_name, senderName: camp.sender_name || settings.sender_name };
    const out = pool.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = cmap.get(r.contact_id); const co = Array.isArray(c?.company) ? c.company[0] : c?.company;
      const m = composeEmail(content, { postalAddress: settings.postal_address || "[Postal address not set]", signatureHtml: settings.signature_html },
        { fullName: r.full_name, companyName: co?.name, designation: c?.designation, industry: co?.industry, city: co?.city, website: co?.website }, r.unsubscribe_token);
      return { email: r.email, name: r.full_name, subject: m.subject, html: m.html, missing: m.missing };
    });
    return { ok: true, data: out };
  });
}

/** Sends ONE test copy to an address you choose (not a campaign recipient). A test is required before approval. */
export async function sendTestEmail(campaignId: string, to: string): Promise<ActionResult> {
  return authorized(async ({ supabase, profile, user }) => {
    if (!(await limitUser(user.id, "testEmail", { failClosed: true }))) return fail(TOO_MANY);
    if (!isUuid(campaignId)) return fail("Invalid campaign.");
    if (!isValidEmail(to)) return fail("Enter a valid test email address.");
    if (!emailConfigured()) return fail("Email is not configured on the server (RESEND_API_KEY / EMAIL_FROM).");
    const [{ data: camp }, { data: st }, { data: first }] = await Promise.all([
      supabase.from("email_campaigns").select("*").eq("id", campaignId).maybeSingle(),
      supabase.from("email_settings").select("*").single(),
      supabase.from("email_recipients").select("*").eq("campaign_id", campaignId).eq("status", "pending").limit(1).maybeSingle(),
    ]);
    if (!camp) return fail("That campaign no longer exists.");
    const s = st as EmailSettings;
    const senderEmail = camp.sender_email || s.sender_email;
    if (!senderEmail) return fail("Set a sender email in Email Settings first.");
    if (!s.postal_address.trim()) return fail("Add NAFA's postal address in Email Settings first.");
    const content: CampaignContent = { subject: camp.subject, bodyHtml: camp.body_html, fallbacks: camp.fallbacks ?? {}, salespersonName: camp.salesperson_name || profile.full_name, senderName: camp.sender_name || s.sender_name };
    const m = composeEmail(content, { postalAddress: s.postal_address, signatureHtml: s.signature_html },
      { fullName: first?.full_name || profile.full_name || "Test Recipient", companyName: "Sample Company" }, first?.unsubscribe_token ?? randomUUID());
    if (m.missing.length) return fail(`These fields have no value or fallback: ${m.missing.join(", ")}. Add fallbacks before testing.`);
    const r = await sendMarketingEmail({ from: formatFrom(camp.sender_name || s.sender_name, senderEmail), to, replyTo: camp.reply_to || s.reply_to || undefined, subject: `[TEST] ${m.subject}`, html: m.html, text: m.text, idempotencyKey: randomUUID(), unsubscribeUrl: m.unsubscribeApiUrl });
    if (!r.ok) return fail(r.error);
    await log(supabase, campaignId, "test_sent", { to });
    refresh(PATHS);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Approval and lifecycle
// ---------------------------------------------------------------------------------------------
export async function approveCampaign(campaignId: string, scheduleLocal: string | null): Promise<ActionResult> {
  return authorized(async ({ supabase, profile, user }) => {
    if (profile.role !== "admin") return fail("Only an administrator can approve and activate a campaign.");
    const [{ data: camp }, { data: st }, tests, { count: pending }] = await Promise.all([
      supabase.from("email_campaigns").select("*").eq("id", campaignId).maybeSingle(),
      supabase.from("email_settings").select("*").single(),
      supabase.from("email_audit_log").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("action", "test_sent"),
      supabase.from("email_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending"),
    ]);
    if (!camp) return fail("That campaign no longer exists.");
    if (camp.status !== "draft") return fail("Only a draft campaign can be approved.");
    const s = st as EmailSettings;
    if (!(camp.sender_email || s.sender_email)) return fail("Set a sender email in Email Settings first.");
    if (!s.postal_address.trim()) return fail("Add NAFA's postal address in Email Settings first — it is required in every email.");
    if (!camp.subject.trim() || !camp.body_html.trim()) return fail("The subject and email body cannot be empty.");
    if (!pending) return fail("This campaign has no eligible recipients.");
    if (!tests.count) return fail("Send yourself a test email first, then approve.");
    let when = new Date();
    if (scheduleLocal) {
      const iso = istLocalToIso(scheduleLocal);
      if (!iso) return fail("Enter a valid schedule date and time (IST).");
      when = new Date(iso);
    }
    const { error } = await supabase.from("email_campaigns").update({ status: "scheduled", scheduled_at: when.toISOString(), approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", campaignId).eq("status", "draft");
    if (error) return fail(friendlyDbError(error));
    await log(supabase, campaignId, "approved", { scheduled_at: when.toISOString(), recipients: pending });
    refresh(PATHS);
    return { ok: true };
  });
}

type Transition = "pause" | "resume" | "stop" | "edit";
export async function changeCampaignState(campaignId: string, t: Transition): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    const { data: camp } = await supabase.from("email_campaigns").select("status").eq("id", campaignId).maybeSingle();
    if (!camp) return fail("That campaign no longer exists.");
    const st = camp.status as string;
    let next: string | null = null;
    if (t === "pause" && (st === "scheduled" || st === "sending")) next = "paused";
    if (t === "resume" && st === "paused") { if (profile.role !== "admin") return fail("Only an administrator can resume a campaign."); next = "sending"; }
    if (t === "stop" && ["scheduled", "sending", "paused"].includes(st)) next = "stopped";
    if (t === "edit" && ["scheduled", "paused", "stopped"].includes(st)) next = "draft";
    if (!next) return fail("That action is not available for this campaign’s current status.");
    const patch: Record<string, unknown> = { status: next };
    if (next === "draft") { patch.approved_by = null; patch.approved_at = null; patch.scheduled_at = null; }
    const { error } = await supabase.from("email_campaigns").update(patch).eq("id", campaignId);
    if (error) return fail(friendlyDbError(error));
    if (next === "stopped") await supabase.from("email_recipients").update({ status: "skipped", skip_reason: "stopped" }).eq("campaign_id", campaignId).in("status", ["pending", "sending"]);
    if (next === "draft") {
      await supabase.from("email_recipients").update({ status: "pending", skip_reason: null }).eq("campaign_id", campaignId).eq("skip_reason", "stopped");
    }
    await log(supabase, campaignId, `state_${t}`, { from: st, to: next });
    refresh([...PATHS, `/email-marketing/campaigns/${campaignId}`]);
    return { ok: true };
  });
}

/** Administrator-triggered pass of the sending queue (the scheduled cron route does the same automatically). */
export async function sendNextBatch(campaignId?: string): Promise<ActionResult<ProcessSummary>> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can run the sending queue.");
    const out = await processEmailQueue(supabase, { campaignId });
    if (!out.ok) return fail(out.error ?? "The sending queue failed.");
    refresh([...PATHS, campaignId ? `/email-marketing/campaigns/${campaignId}` : "/email-marketing"]);
    return { ok: true, data: out };
  });
}

// ---------------------------------------------------------------------------------------------
// Templates, suppression list, settings
// ---------------------------------------------------------------------------------------------
const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Template name is required").max(200),
  category: z.string().trim().max(60).default("general"),
  subject: z.string().trim().max(300).default(""),
  bodyHtml: z.string().max(60000).default(""),
});
export async function saveTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult<{ id: string }>> {
  return authorized(async ({ supabase }) => {
    const p = templateSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the template.");
    const v = { name: p.data.name, category: p.data.category, subject: p.data.subject, body_html: sanitizeEmailHtml(p.data.bodyHtml) };
    const q = p.data.id ? supabase.from("email_templates").update(v).eq("id", p.data.id).select("id").single() : supabase.from("email_templates").insert(v).select("id").single();
    const { data, error } = await q;
    if (error || !data) return fail(error ? friendlyDbError(error) : "That template is read-only. Duplicate it to make an editable copy.");
    refresh(["/email-marketing/templates"]);
    return { ok: true, data: { id: data.id } };
  });
}
export async function duplicateTemplate(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { data: t } = await supabase.from("email_templates").select("*").eq("id", id).maybeSingle();
    if (!t) return fail("Template not found.");
    const { error } = await supabase.from("email_templates").insert({ name: `${t.name} (copy)`, category: t.category, subject: t.subject, body_html: t.body_html });
    if (error) return fail(friendlyDbError(error));
    refresh(["/email-marketing/templates"]);
    return { ok: true };
  });
}
export async function deleteTemplate(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { data, error } = await supabase.from("email_templates").delete().eq("id", id).select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("System templates cannot be deleted. Duplicate one to customise it.");
    refresh(["/email-marketing/templates"]);
    return { ok: true };
  });
}

export async function addSuppression(email: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isValidEmail(email)) return fail("Enter a valid email address.");
    const n = normalizeEmail(email);
    const { error } = await supabase.from("email_suppressions").upsert({ email_normalized: n, email: email.trim(), reason: "manual", source: "added by team" }, { onConflict: "email_normalized", ignoreDuplicates: true });
    if (error) return fail(friendlyDbError(error));
    await supabase.from("email_recipients").update({ status: "skipped", skip_reason: "suppressed" }).eq("email_normalized", n).in("status", ["pending", "sending"]);
    refresh(["/email-marketing/suppressions"]);
    return { ok: true };
  });
}
export async function removeSuppression(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can re-enable an address.");
    const { data, error } = await supabase.from("email_suppressions").delete().eq("id", id).select("email_normalized");
    if (error) return fail(friendlyDbError(error));
    for (const r of data ?? []) await supabase.from("contacts").update({ email_status: "valid" }).eq("email_normalized", r.email_normalized).in("email_status", ["unsubscribed", "bounced"]);
    refresh(["/email-marketing/suppressions"]);
    return { ok: true };
  });
}

const settingsSchema = z.object({
  sender_name: z.string().trim().min(1).max(120),
  sender_email: z.string().trim().max(254).refine((v) => v === "" || isValidEmail(v), "Enter a valid sender email"),
  reply_to: z.string().trim().max(254).refine((v) => v === "" || isValidEmail(v), "Enter a valid reply-to email"),
  postal_address: z.string().trim().max(500),
  signature_html: z.string().max(5000),
  daily_limit: z.number().int().min(1).max(5000),
  batch_size: z.number().int().min(1).max(100),
  window_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  window_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export async function saveEmailSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change email settings.");
    const p = settingsSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the values.");
    if (p.data.window_end <= p.data.window_start) return fail("The sending window must end after it starts.");
    const { data, error } = await supabase.from("email_settings").update({ ...p.data, signature_html: sanitizeEmailHtml(p.data.signature_html) }).eq("id", true).select("id");
    if (error || !data?.length) return fail("Could not save the settings.");
    refresh(["/email-marketing/settings"]);
    return { ok: true };
  });
}
