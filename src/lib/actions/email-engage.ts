"use server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail, friendlyDbError, isUuid, refresh } from "@/lib/actions/util";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { isValidEmail, normalizeEmail } from "@/lib/email/audience";
import { composeEmail } from "@/lib/email/compose";
import { fetchRecentInbound, gmailConfigured } from "@/lib/email/gmail";
import type { EmailSettings } from "@/lib/email/processor";
import { rebuildRecipients } from "@/lib/email/recipients";
import { applyUnsubscribe, classifyStoredReply, ingestReplies, REPLY_CATEGORIES } from "@/lib/email/replies";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { formatFrom, sendMarketingEmail } from "@/lib/email/send";
import { emailConfigured } from "@/lib/documents/email";
import type { ActionResult } from "@/lib/types";
import { randomUUID } from "node:crypto";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";

const PATHS = ["/email-marketing/replies", "/email-marketing/analytics", "/email-marketing"];
const campaignPath = (id: string) => `/email-marketing/campaigns/${id}`;

async function requireDraft(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from("email_campaigns").select("id, status, subject, body_html").eq("id", id).maybeSingle();
  return data && data.status === "draft" ? data : null;
}

// ------------------------------------------------------------------------------------------ sequences
const stepsSchema = z.array(z.object({
  delay_days: z.number().int().min(1).max(60),
  subject: z.string().trim().max(300),
  body_html: z.string().max(40000),
})).max(6);

/** Saves the follow-up steps (Day offsets are measured from the previous email). Draft campaigns only. */
export async function saveSequence(campaignId: string, steps: z.input<typeof stepsSchema>): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const p = stepsSchema.safeParse(steps);
    if (!p.success) return fail("Each follow-up needs a delay of 1–60 days.");
    if (!(await requireDraft(supabase, campaignId))) return fail("Follow-ups can only be edited while the campaign is a draft.");
    if (p.data.some((s) => !s.body_html.trim())) return fail("Every follow-up needs a message body.");
    const del = await supabase.from("email_sequence_steps").delete().eq("campaign_id", campaignId);
    if (del.error) return fail(friendlyDbError(del.error));
    if (p.data.length) {
      const { error } = await supabase.from("email_sequence_steps").insert(p.data.map((s, i) => ({ campaign_id: campaignId, step: i + 1, delay_days: s.delay_days, subject: s.subject, body_html: sanitizeEmailHtml(s.body_html) })));
      if (error) return fail(friendlyDbError(error));
    }
    await supabase.from("email_audit_log").insert({ campaign_id: campaignId, action: "sequence_saved", details: { steps: p.data.length } });
    refresh([campaignPath(campaignId)]);
    return { ok: true };
  });
}

/** Drafts follow-up emails from the campaign's first email. The result is a suggestion for you to edit and save; nothing is saved or sent. */
export async function aiGenerateFollowUps(campaignId: string, days: number[]): Promise<ActionResult<{ delay_days: number; subject: string; body_html: string }[]>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const { data: c } = await supabase.from("email_campaigns").select("subject, body_html, objective").eq("id", campaignId).maybeSingle();
    if (!c || !c.body_html.trim()) return fail("Write the first email before generating follow-ups.");
    const gaps = days.filter((d) => d >= 1 && d <= 60).slice(0, 5);
    if (!gaps.length) return fail("Choose at least one follow-up day.");
    const r = await geminiGenerate({
      system: `${GROUNDING_RULES}\nYou write polite, short follow-up emails for NAFA Events & Activations. Never pressure, never invent facts, never claim the person has seen or ignored the earlier email. Keep placeholders such as {{first_name|there}} and {{company_name}}. HTML only with <p>, <br>, <ul>, <li>, <strong>, <a href="https://...">. No signature, address or unsubscribe text.`,
      prompt: `First email subject: ${c.subject}\nFirst email:\n${c.body_html}\n\nWrite ${gaps.length} follow-ups to be sent ${gaps.join(", ")} days (cumulative days since the first email) after it. Each should add a small new angle (e.g. a short recap, a specific way NAFA can help, a final gentle check-in). Return JSON: [{"subject": string, "body_html": string}, ...] in order.`,
      json: true, temperature: 0.7,
    });
    if (!r.ok) return fail("The AI service is busy or unavailable. Please try again in a moment.");
    try {
      const arr = JSON.parse(r.text) as { subject?: string; body_html?: string }[];
      let prev = 0;
      const out = gaps.map((d, i) => { const delay = Math.max(1, d - prev); prev = d; return { delay_days: delay, subject: String(arr[i]?.subject ?? `Re: ${c.subject}`).slice(0, 200), body_html: sanitizeEmailHtml(String(arr[i]?.body_html ?? "")) }; });
      return { ok: true, data: out };
    } catch {
      return fail("The AI returned an unreadable response. Please try again.");
    }
  });
}

// ------------------------------------------------------------------------------------------ A/B versions
const variantsSchema = z.array(z.object({ subject: z.string().trim().max(300), body_html: z.string().max(60000) })).max(3);

/** Saves versions B, C, D (version A is the campaign's own email) and re-splits recipients evenly between them. */
export async function saveVariants(campaignId: string, variants: z.input<typeof variantsSchema>): Promise<ActionResult<{ recipients: number }>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "heavy"))) return fail(TOO_MANY);
    const p = variantsSchema.safeParse(variants);
    if (!p.success) return fail("Please check the versions.");
    if (!(await requireDraft(supabase, campaignId))) return fail("Versions can only be edited while the campaign is a draft.");
    if (p.data.some((v) => !v.subject.trim() || !v.body_html.trim())) return fail("Every version needs a subject and a body.");
    const del = await supabase.from("email_campaign_variants").delete().eq("campaign_id", campaignId);
    if (del.error) return fail(friendlyDbError(del.error));
    if (p.data.length) {
      const { error } = await supabase.from("email_campaign_variants").insert(p.data.map((v, i) => ({ campaign_id: campaignId, label: "BCD"[i], subject: v.subject, body_html: sanitizeEmailHtml(v.body_html) })));
      if (error) return fail(friendlyDbError(error));
    }
    const r = await rebuildRecipients(supabase, campaignId);
    await supabase.from("email_audit_log").insert({ campaign_id: campaignId, action: "variants_saved", details: { versions: p.data.length + 1 } });
    refresh([campaignPath(campaignId)]);
    return { ok: true, data: { recipients: r.total - r.skippedMissing } };
  });
}

/** AI opinion on subject lines. It is a writing review, not a performance prediction — real results appear in Analytics. */
export async function aiCompareSubjects(subjects: string[]): Promise<ActionResult<{ review: string }>> {
  return authorized(async ({ user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const list = subjects.map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (list.length < 2) return fail("Enter at least two subject lines to compare.");
    const r = await geminiGenerate({
      system: `${GROUNDING_RULES}\nReview email subject lines for a B2B outreach from NAFA Events & Activations.`,
      prompt: `Compare these subject lines on clarity, relevance, length, spam-trigger risk and curiosity. For each give a one-line assessment, then say which is the strongest writing and why. State clearly that this is an opinion and only real send results can show what performs better. Plain text, under 150 words.\n\n${list.map((s, i) => `${"ABCD"[i]}: ${s}`).join("\n")}`,
      temperature: 0.4,
    });
    if (!r.ok) return fail("The AI service is busy or unavailable. Please try again in a moment.");
    return { ok: true, data: { review: r.text } };
  });
}

// ------------------------------------------------------------------------------------------ replies
export async function checkRepliesNow(): Promise<ActionResult<{ stored: number; unmatched: number; classified: number }>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "heavy"))) return fail(TOO_MANY);
    if (!gmailConfigured()) return fail("Gmail reply monitoring is not configured (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN). You can log replies manually.");
    try {
      const out = await ingestReplies(supabase, await fetchRecentInbound(7, 50), "gmail");
      refresh(PATHS);
      return { ok: true, data: out };
    } catch (e) {
      return fail((e as Error).message);
    }
  });
}

const manualSchema = z.object({
  fromEmail: z.string().trim().max(254),
  subject: z.string().trim().max(300).default(""),
  body: z.string().trim().min(1, "Paste the reply text").max(8000),
});
/** For replies that arrive outside the monitored mailbox: paste them in and they are matched and classified like any other. */
export async function logManualReply(input: z.input<typeof manualSchema>): Promise<ActionResult<{ stored: number }>> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const p = manualSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Please check the reply.");
    if (!isValidEmail(p.data.fromEmail)) return fail("Enter the sender's email address.");
    const out = await ingestReplies(supabase, [{ id: randomUUID(), fromEmail: p.data.fromEmail, subject: p.data.subject, text: p.data.body, receivedAt: new Date().toISOString() }], "manual");
    if (!out.stored) return fail("That address has not been emailed by any campaign, so the reply was not matched.");
    refresh(PATHS);
    return { ok: true, data: { stored: out.stored } };
  });
}

export async function reclassifyReply(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const r = await classifyStoredReply(supabase, id);
    if (!r.ok) return fail(r.error);
    refresh(PATHS);
    return { ok: true };
  });
}

export async function setReplyCategory(id: string, category: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!(REPLY_CATEGORIES as readonly string[]).includes(category)) return fail("Unknown category.");
    const { data: rep, error } = await supabase.from("email_replies").update({ category }).eq("id", id).select("from_email").maybeSingle();
    if (error || !rep) return fail("Reply not found.");
    if (category === "unsubscribe") await applyUnsubscribe(supabase, rep.from_email, "reply (team)");
    refresh(PATHS);
    return { ok: true };
  });
}

export async function markReplyHandled(id: string, handled: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const { error } = await supabase.from("email_replies").update({ handled }).eq("id", id);
    if (error) return fail(friendlyDbError(error));
    refresh(PATHS);
    return { ok: true };
  });
}

const sendReplySchema = z.object({ id: z.string().uuid(), subject: z.string().trim().min(1).max(300), bodyHtml: z.string().min(1).max(20000) });
/** Sends a response the user has reviewed and edited. The AI suggestion is only ever a starting point. */
export async function sendReplyEmail(input: z.input<typeof sendReplySchema>): Promise<ActionResult> {
  return authorized(async ({ supabase, profile, user }) => {
    if (!(await limitUser(user.id, "replyEmail", { failClosed: true }))) return fail(TOO_MANY);
    const p = sendReplySchema.safeParse(input);
    if (!p.success) return fail("Enter a subject and a message.");
    if (!emailConfigured()) return fail("Email is not configured on the server (RESEND_API_KEY / EMAIL_FROM).");
    const [{ data: rep }, { data: st }] = await Promise.all([
      supabase.from("email_replies").select("*").eq("id", p.data.id).maybeSingle(),
      supabase.from("email_settings").select("*").single(),
    ]);
    if (!rep) return fail("Reply not found.");
    if (rep.category === "unsubscribe") return fail("This person asked to be unsubscribed — do not email them.");
    const { data: supp } = await supabase.from("email_suppressions").select("id").eq("email_normalized", normalizeEmail(rep.from_email)).maybeSingle();
    if (supp) return fail("This address is on the do-not-email list.");
    const s = st as EmailSettings;
    if (!s.sender_email || !s.postal_address.trim()) return fail("Set the sender email and postal address in Email Settings first.");
    const { data: rcpt } = rep.recipient_id ? await supabase.from("email_recipients").select("unsubscribe_token, full_name").eq("id", rep.recipient_id).maybeSingle() : { data: null };
    const m = composeEmail({ subject: p.data.subject, bodyHtml: p.data.bodyHtml, fallbacks: {}, salespersonName: profile.full_name, senderName: s.sender_name },
      { postalAddress: s.postal_address, signatureHtml: s.signature_html }, { fullName: rcpt?.full_name ?? "" }, rcpt?.unsubscribe_token ?? randomUUID());
    if (m.missing.length) return fail(`Remove or fill these fields before sending: ${m.missing.join(", ")}`);
    const r = await sendMarketingEmail({ from: formatFrom(s.sender_name, s.sender_email), to: rep.from_email, replyTo: s.reply_to || undefined, subject: m.subject, html: m.html, text: m.text, idempotencyKey: randomUUID(), unsubscribeUrl: m.unsubscribeApiUrl });
    if (!r.ok) return fail(r.error);
    await supabase.from("email_replies").update({ handled: true }).eq("id", rep.id);
    await supabase.from("email_audit_log").insert({ campaign_id: rep.campaign_id, action: "reply_sent", details: { to: rep.from_email } });
    if (rep.lead_id) await supabase.from("lead_activities").insert({ lead_id: rep.lead_id, type: "message_sent", summary: "Replied by email to campaign response" });
    refresh(PATHS);
    return { ok: true };
  });
}

/** Creates a CRM lead from an interested reply (or links the contact's existing open lead). One click = approval. */
export async function convertReplyToLead(id: string): Promise<ActionResult<{ leadId: string; created: boolean }>> {
  return authorized(async ({ supabase, user }) => {
    const { data: rep } = await supabase.from("email_replies").select("*").eq("id", id).maybeSingle();
    if (!rep) return fail("Reply not found.");
    if (rep.lead_id) return fail("This reply is already linked to a lead.");
    if (!rep.contact_id) return fail("This reply is not linked to a CRM contact.");
    const { data: contact } = await supabase.from("contacts").select("id, full_name, company_id, company:companies(name)").eq("id", rep.contact_id).maybeSingle();
    if (!contact) return fail("The contact no longer exists.");
    const { data: open } = await supabase.from("leads").select("id").eq("contact_id", contact.id).is("archived_at", null).not("status", "in", "(won,lost)").limit(1);
    let leadId = open?.[0]?.id as string | undefined;
    const created = !leadId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const co: any = contact.company; const company = (Array.isArray(co) ? co[0] : co)?.name;
    if (!leadId) {
      const status = ["interested", "meeting_request", "price_enquiry", "request_for_details"].includes(rep.category ?? "") ? "qualified" : "contacted";
      const { data, error } = await supabase.from("leads").insert({
        title: `${company ?? contact.full_name} — email outreach reply`, company_id: contact.company_id, contact_id: contact.id,
        source: "email", status, priority: rep.category === "meeting_request" || rep.category === "price_enquiry" ? "high" : "medium", assigned_to: user.id,
        notes: `Created from a campaign reply.\n${rep.summary ?? ""}`.slice(0, 1000), last_contact_at: rep.received_at,
      }).select("id").single();
      if (error || !data) return fail(error ? friendlyDbError(error) : "Could not create the lead.");
      leadId = data.id as string;
    }
    await supabase.from("lead_activities").insert({ lead_id: leadId, type: "reply_received", summary: `Replied to email campaign${rep.summary ? `: ${rep.summary}` : ""}` });
    await supabase.from("email_replies").update({ lead_id: leadId }).eq("id", id);
    refresh([...PATHS, "/leads", "/ai-bdm"]);
    return { ok: true, data: { leadId, created } };
  });
}
