import type { SupabaseClient } from "@supabase/supabase-js";
import { istDayBounds } from "@/lib/datetime";
import { emailConfigured } from "@/lib/documents/email";
import { composeEmail, type CampaignContent } from "@/lib/email/compose";
import { formatFrom, sendMarketingEmail } from "@/lib/email/send";
import { notify } from "@/lib/push";

export type EmailSettings = {
  sender_name: string; sender_email: string; reply_to: string; postal_address: string; signature_html: string;
  daily_limit: number; batch_size: number; window_start: string; window_end: string;
};
export const MAX_ATTEMPTS = 4;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const DAY = 86400000;

export type ProcessSummary = { ok: boolean; skipped?: string; sent: number; failed: number; skippedRecipients: number; retried: number; campaigns: number; followUpsQueued: number; error?: string };
type Step = { step: number; delay_days: number; subject: string; body_html: string };
type Version = { subject: string; body_html: string };

/** Replies that stop a sequence. An out-of-office auto-reply does not. */
export const STOPPING_REPLY = (category: string | null) => category !== "out_of_office";

/**
 * Queues the next follow-up for recipients whose previous email was sent long enough ago.
 * A recipient is NOT queued if they replied, are suppressed/bounced, or the campaign is not active.
 * Returns how many were queued and how many are still waiting for their next step (so the campaign is not
 * marked completed while follow-ups are still due).
 */
export async function scheduleFollowUps(supabase: SupabaseClient, campaignId: string, steps: Step[], now: Date): Promise<{ queued: number; waiting: number }> {
  if (!steps.length) return { queued: 0, waiting: 0 };
  const maxStep = Math.max(...steps.map((s) => s.step));
  const byStep = new Map(steps.map((s) => [s.step, s]));
  const [{ data: rows }, { data: replies }, { data: supp }] = await Promise.all([
    supabase.from("email_recipients").select("*").eq("campaign_id", campaignId).limit(50000),
    supabase.from("email_replies").select("from_normalized, category").eq("campaign_id", campaignId).limit(20000),
    supabase.from("email_suppressions").select("email_normalized").limit(50000),
  ]);
  const replied = new Set((replies ?? []).filter((r) => STOPPING_REPLY(r.category)).map((r) => r.from_normalized));
  const suppressed = new Set((supp ?? []).map((r) => r.email_normalized));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latest = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rows ?? []) as any[]) { const cur = latest.get(r.email_normalized); if (!cur || r.step > cur.step) latest.set(r.email_normalized, r); }

  const toInsert = [];
  let waiting = 0;
  for (const r of latest.values()) {
    if (r.status !== "sent" || r.step >= maxStep) continue;
    if (replied.has(r.email_normalized) || suppressed.has(r.email_normalized)) continue;
    const next = byStep.get(r.step + 1);
    if (!next) continue;
    if (new Date(r.sent_at).getTime() + next.delay_days * DAY <= now.getTime()) {
      toInsert.push({ campaign_id: campaignId, contact_id: r.contact_id, email: r.email, email_normalized: r.email_normalized, full_name: r.full_name, step: r.step + 1, variant: r.variant, status: "pending" });
    } else waiting++;
  }
  let queued = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const { data } = await supabase.from("email_recipients").upsert(toInsert.slice(i, i + 500), { onConflict: "campaign_id,email_normalized,step", ignoreDuplicates: true }).select("id");
    queued += data?.length ?? 0;
  }
  return { queued, waiting };
}

/**
 * One pass of the sending queue. Safe to call repeatedly and from several places at once:
 * recipients are claimed with row locks, every send carries an idempotency key, and eligibility
 * (suppression, contact status, replies, unresolved placeholders, campaign state) is re-checked before each send.
 * Called by the secured cron route (service role) or by an administrator's "Send next batch" button.
 * Respects the daily limit, the batch size and the IST sending window — it never tries to get around them.
 */
export async function processEmailQueue(supabase: SupabaseClient, opts: { now?: Date; campaignId?: string; ignoreWindow?: boolean } = {}): Promise<ProcessSummary> {
  const now = opts.now ?? new Date();
  const sum: ProcessSummary = { ok: true, sent: 0, failed: 0, skippedRecipients: 0, retried: 0, campaigns: 0, followUpsQueued: 0 };
  if (!emailConfigured()) return { ...sum, ok: false, error: "Email is not configured (set RESEND_API_KEY and EMAIL_FROM)." };

  const { data: settings } = await supabase.from("email_settings").select("*").maybeSingle();
  const s = settings as EmailSettings | null;
  if (!s?.sender_email) return { ...sum, ok: false, error: "Set a sender email in Email Settings first." };
  if (!s.postal_address.trim()) return { ...sum, ok: false, error: "Add NAFA's postal address in Email Settings first (required in every email)." };

  const { start } = istDayBounds(now);
  const nowMin = Math.floor((now.getTime() - start.getTime()) / 60000);
  if (!opts.ignoreWindow && (nowMin < minutes(s.window_start) || nowMin >= minutes(s.window_end))) return { ...sum, skipped: "Outside the sending window" };

  let q = supabase.from("email_campaigns").select("*").in("status", ["scheduled", "sending"]).order("scheduled_at", { ascending: true, nullsFirst: true });
  if (opts.campaignId) q = q.eq("id", opts.campaignId);
  const { data: campaigns, error } = await q;
  if (error) return { ...sum, ok: false, error: error.message };

  const todayCount = async (campaignId?: string) => {
    let c = supabase.from("email_recipients").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", start.toISOString());
    if (campaignId) c = c.eq("campaign_id", campaignId);
    return (await c).count ?? 0;
  };
  let globalRemaining = s.daily_limit - (await todayCount());

  for (const camp of campaigns ?? []) {
    if (camp.scheduled_at && new Date(camp.scheduled_at) > now) continue;
    const [{ data: stepRows }, { data: variantRows }] = await Promise.all([
      supabase.from("email_sequence_steps").select("step, delay_days, subject, body_html").eq("campaign_id", camp.id),
      supabase.from("email_campaign_variants").select("label, subject, body_html").eq("campaign_id", camp.id),
    ]);
    const steps = (stepRows ?? []) as Step[];
    const fu = camp.status === "sending" ? await scheduleFollowUps(supabase, camp.id, steps, now) : { queued: 0, waiting: 0 };
    sum.followUpsQueued += fu.queued;

    if (globalRemaining > 0) {
      const campRemaining = camp.daily_limit ? camp.daily_limit - (await todayCount(camp.id)) : Infinity;
      const n = Math.min(s.batch_size, globalRemaining, campRemaining);
      if (n > 0) {
        sum.campaigns++;
        if (camp.status === "scheduled") await supabase.from("email_campaigns").update({ status: "sending" }).eq("id", camp.id).eq("status", "scheduled");
        const used = await sendBatch(supabase, camp, s, steps, new Map((variantRows ?? []).map((v) => [v.label as string, { subject: v.subject, body_html: v.body_html }])), n, now, sum);
        globalRemaining -= used;
      }
    } else sum.skipped = "Daily sending limit reached";

    const { count: open } = await supabase.from("email_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", camp.id).in("status", ["pending", "sending"]);
    const stillWaiting = steps.length ? (await scheduleFollowUpsDryWaiting(supabase, camp.id, steps)) : 0;
    if (!open && !stillWaiting) {
      await supabase.from("email_campaigns").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", camp.id).eq("status", "sending");
      await supabase.from("email_audit_log").insert({ campaign_id: camp.id, action: "completed", details: {} });
      await notify(camp.created_by ? [camp.created_by] : "admins", { type: "campaign_completed", title: "Campaign finished", body: `${camp.name} has finished sending.`, url: `/email-marketing/campaigns/${camp.id}`, tag: `campaign-${camp.id}` });
    }
  }
  return sum;
}

/** Counts recipients who still have a follow-up step coming (not replied, not suppressed). */
async function scheduleFollowUpsDryWaiting(supabase: SupabaseClient, campaignId: string, steps: Step[]): Promise<number> {
  const maxStep = Math.max(...steps.map((x) => x.step));
  const [{ data: rows }, { data: replies }, { data: supp }] = await Promise.all([
    supabase.from("email_recipients").select("email_normalized, step, status").eq("campaign_id", campaignId).limit(50000),
    supabase.from("email_replies").select("from_normalized, category").eq("campaign_id", campaignId).limit(20000),
    supabase.from("email_suppressions").select("email_normalized").limit(50000),
  ]);
  const stop = new Set([...(replies ?? []).filter((r) => STOPPING_REPLY(r.category)).map((r) => r.from_normalized), ...(supp ?? []).map((r) => r.email_normalized)]);
  const latest = new Map<string, { step: number; status: string }>();
  for (const r of rows ?? []) { const cur = latest.get(r.email_normalized); if (!cur || r.step > cur.step) latest.set(r.email_normalized, r); }
  let n = 0;
  for (const [email, r] of latest) if (r.status === "sent" && r.step < maxStep && !stop.has(email)) n++;
  return n;
}

async function sendBatch(
  supabase: SupabaseClient, camp: Record<string, any>, s: EmailSettings, steps: Step[], variants: Map<string, Version>, n: number, now: Date, sum: ProcessSummary, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<number> {
  const { data: claimed, error: claimErr } = await supabase.rpc("claim_email_recipients", { p_campaign: camp.id, p_limit: n });
  if (claimErr) { sum.ok = false; sum.error = claimErr.message; return 0; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (claimed ?? []) as any[];
  if (!rows.length) return 0;

  const emails = rows.map((r) => r.email_normalized);
  const [{ data: supp }, { data: contacts }, { data: replies }] = await Promise.all([
    supabase.from("email_suppressions").select("email_normalized").in("email_normalized", emails),
    supabase.from("contacts").select("id, email_status, designation, state, company:companies(name, industry, city, website)").in("id", rows.map((r) => r.contact_id).filter(Boolean)),
    supabase.from("email_replies").select("from_normalized, category").eq("campaign_id", camp.id).in("from_normalized", emails),
  ]);
  const suppressed = new Set((supp ?? []).map((x: { email_normalized: string }) => x.email_normalized));
  const replied = new Set((replies ?? []).filter((r) => STOPPING_REPLY(r.category)).map((r) => r.from_normalized));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmap = new Map((contacts ?? []).map((c: any) => [c.id, c]));
  const stepMap = new Map(steps.map((x) => [x.step, x]));
  const from = formatFrom(camp.sender_name || s.sender_name, camp.sender_email || s.sender_email);
  const replyTo = camp.reply_to || s.reply_to || undefined;
  let sent = 0;

  for (const r of rows) {
    const skip = async (reason: string, fields: string[] = []) => {
      await supabase.from("email_recipients").update({ status: "skipped", skip_reason: reason, missing_fields: fields }).eq("id", r.id);
      sum.skippedRecipients++;
    };
    // Re-check eligibility immediately before sending.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = r.contact_id ? cmap.get(r.contact_id) : null;
    if (suppressed.has(r.email_normalized) || c?.email_status === "unsubscribed") { await skip("unsubscribed"); continue; }
    if (c?.email_status === "bounced") { await skip("bounced"); continue; }
    if (c?.email_status === "invalid") { await skip("invalid"); continue; }
    if (r.step > 0 && replied.has(r.email_normalized)) { await skip("replied"); continue; }

    let version: Version;
    if (r.step === 0) version = (r.variant && variants.get(r.variant)) || { subject: camp.subject, body_html: camp.body_html };
    else {
      const st = stepMap.get(r.step);
      if (!st) { await skip("stopped"); continue; }
      version = { subject: st.subject.trim() || `Re: ${camp.subject}`, body_html: st.body_html };
    }
    const content: CampaignContent = { subject: version.subject, bodyHtml: version.body_html, fallbacks: camp.fallbacks ?? {}, salespersonName: camp.salesperson_name, senderName: camp.sender_name || s.sender_name };
    const company = Array.isArray(c?.company) ? c.company[0] : c?.company;
    const msg = composeEmail(content, { postalAddress: s.postal_address, signatureHtml: s.signature_html },
      { fullName: r.full_name, companyName: company?.name, designation: c?.designation, industry: company?.industry, city: company?.city, website: company?.website }, r.unsubscribe_token);
    if (msg.missing.length || !msg.subject) { await skip("missing_field", msg.missing); continue; }

    const res = await sendMarketingEmail({ from, to: r.email, replyTo, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: r.idempotency_key, unsubscribeUrl: msg.unsubscribeApiUrl });
    if (res.ok) {
      await supabase.from("email_recipients").update({ status: "sent", sent_at: new Date().toISOString(), provider_id: res.providerId, last_error: null }).eq("id", r.id);
      sum.sent++; sent++;
    } else if (res.temporary && r.attempts < MAX_ATTEMPTS) {
      await supabase.from("email_recipients").update({ status: "pending", last_error: res.error, next_attempt_at: new Date(now.getTime() + 5 * 60000 * 2 ** (r.attempts - 1)).toISOString() }).eq("id", r.id);
      sum.retried++;
    } else {
      await supabase.from("email_recipients").update({ status: "failed", last_error: res.error }).eq("id", r.id);
      sum.failed++;
    }
  }
  return sent;
}
