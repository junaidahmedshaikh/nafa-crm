import type { SupabaseClient } from "@supabase/supabase-js";
import { istDayBounds } from "@/lib/datetime";
import { invoiceFromRows, quotationFromRows, type DocSettings } from "@/lib/documents/build";
import { emailConfigured, sendEmailWithPdf } from "@/lib/documents/email";
import { pdfFileName, renderPdf } from "@/lib/documents/render";
import { getInvoiceFull, getQuotationFull, todayIST } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";
import { notify } from "@/lib/push";
import { addDays, dueOffset, fillReminderTemplate, invoiceOpen, MAX_ATTEMPTS, retryDelayMinutes, zonedToIso, type ReminderSettings } from "./core";

export type ScheduledRow = {
  id: string; kind: "follow_up" | "payment_reminder"; status: string; related_type: string | null; related_id: string | null; related_label: string; client_name: string;
  to_email: string; cc_emails: string[]; subject: string; body: string; attach_document: boolean; scheduled_at: string | null; timezone: string; auto: boolean;
  revision: number; attempts: number; next_attempt_at: string | null; last_error: string | null; provider_id: string | null; attachment_name: string | null;
  sent_at: string | null; cancel_reason: string | null; assigned_to: string | null; created_by: string | null; created_at: string; updated_at: string;
};

export type SendOutcome = { status: "sent" | "failed" | "retry" | "cancelled" | "skipped"; message: string };

/** Builds the PDF of the related quotation / invoice with whichever client is in use (a user's, or the scheduler's service client). */
async function attachmentFor(supabase: SupabaseClient, type: string, id: string): Promise<{ filename: string; pdf: Buffer } | null> {
  const { data: settings } = await supabase.from("document_settings").select("*").maybeSingle();
  if (!settings) throw new Error("Document settings could not be loaded.");
  let render;
  if (type === "quotation") {
    const f = await getQuotationFull(supabase, id);
    render = f && quotationFromRows(f.row, f.items, f.milestones, settings as DocSettings);
  } else if (type === "invoice") {
    const f = await getInvoiceFull(supabase, id);
    render = f && invoiceFromRows(f.row, f.items, f.received, todayIST(), settings as DocSettings);
  }
  if (!render || !render.number) return null;
  const { pdf } = await renderPdf(render);
  return { filename: pdfFileName(render), pdf };
}

/**
 * Sends one scheduled email. Safe to call from several places at once: the row is claimed with a conditional update, so only
 * one caller ever sends it, and the provider idempotency key (row id + revision) stops a retry from delivering it twice.
 * `manual` = a person pressed "Send now" (no "it was sent" notification back to themselves, no reply check).
 */
export async function sendScheduledEmail(supabase: SupabaseClient, id: string, opts: { manual?: boolean } = {}): Promise<SendOutcome> {
  const { data: claimed } = await supabase.from("scheduled_emails").update({ status: "sending" }).eq("id", id).eq("status", "scheduled").select("*").maybeSingle();
  if (!claimed) return { status: "skipped", message: "This email is not waiting to be sent." };
  const row = claimed as ScheduledRow;
  const attempts = row.attempts + 1;
  const finish = async (patch: Record<string, unknown>) => { await supabase.from("scheduled_emails").update(patch).eq("id", id).eq("status", "sending"); };
  const cancel = async (reason: string): Promise<SendOutcome> => {
    await finish({ status: "cancelled", cancel_reason: reason });
    return { status: "cancelled", message: reason };
  };
  const url = "/scheduled-emails";
  const who = row.created_by ?? row.assigned_to;
  const failed = async (error: string, temporary: boolean): Promise<SendOutcome> => {
    if (temporary && attempts < MAX_ATTEMPTS && !opts.manual) {
      await finish({ status: "scheduled", attempts, last_error: error, next_attempt_at: new Date(Date.now() + retryDelayMinutes(attempts) * 60000).toISOString() });
      return { status: "retry", message: error };
    }
    await finish({ status: "failed", attempts, last_error: error, next_attempt_at: null });
    if (!opts.manual) {
      await notify(who ? [who] : "admins", {
        type: "scheduled_email_failed", title: "Scheduled email failed", body: `${row.subject} → ${row.to_email}: ${error}`.slice(0, 300), url, tag: `sched-${id}`, dedupeKey: `sched-failed:${id}:${row.revision}`,
      });
    }
    return { status: "failed", message: error };
  };

  try {
    if (!emailConfigured()) return await failed("Email is not configured on this server (RESEND_API_KEY / EMAIL_FROM).", false);

    // A payment reminder is pointless (and embarrassing) once the invoice is paid or cancelled.
    if (row.kind === "payment_reminder" && row.related_type === "invoice" && row.related_id) {
      const inv = await getInvoiceFull(supabase, row.related_id);
      if (!inv) return await cancel("The invoice no longer exists.");
      if (!invoiceOpen(inv.row.state, Number(inv.row.grand_total) - inv.received)) {
        return await cancel(inv.row.state === "cancelled" ? "The invoice was cancelled." : "The invoice has been paid in full.");
      }
    }
    // A follow-up is dropped when the client has already written back since it was scheduled.
    if (row.kind === "follow_up" && !opts.manual) {
      const { data: reply } = await supabase.from("email_replies").select("id, category").eq("from_normalized", row.to_email.toLowerCase())
        .gt("received_at", row.created_at).limit(5);
      if ((reply ?? []).some((r) => r.category !== "out_of_office")) return await cancel("The client replied after this follow-up was scheduled.");
    }

    let attachment: { filename: string; pdf: Buffer } | null = null;
    if (row.attach_document && row.related_id && (row.related_type === "quotation" || row.related_type === "invoice")) {
      try {
        attachment = await attachmentFor(supabase, row.related_type, row.related_id);
      } catch (e) {
        console.error("[scheduled email pdf]", e);
        return await failed("The PDF attachment could not be generated.", true);
      }
      if (!attachment) return await failed("The document to attach is not issued or no longer exists.", false);
    }

    const result = await sendEmailWithPdf({
      to: row.to_email, cc: row.cc_emails, subject: row.subject, text: row.body, ...(attachment ?? {}), idempotencyKey: `sched-${id}-r${row.revision}`,
    });
    if (!result.ok) return await failed(result.error, !!result.temporary);

    await finish({
      status: "sent", attempts, provider_id: result.providerId, sent_at: new Date().toISOString(), last_error: null, next_attempt_at: null,
      attachment_name: attachment?.filename ?? null,
    });
    // Keep the document's own email history complete.
    if (row.related_id && (row.related_type === "quotation" || row.related_type === "invoice")) {
      const core = { doc_type: row.related_type, doc_id: row.related_id, to_email: row.to_email, subject: row.subject, body: row.body, status: "sent", provider_id: result.providerId, sent_by: who };
      const res = await supabase.from("document_emails").insert({ ...core, cc_emails: row.cc_emails, attachment_name: attachment?.filename ?? null });
      if (res.error) await supabase.from("document_emails").insert(core);
      await supabase.rpc("log_document_activity", {
        p_type: row.related_type, p_id: row.related_id, p_action: "emailed",
        p_summary: `${row.kind === "payment_reminder" ? "Payment reminder" : "Follow-up"} emailed to ${row.to_email}`, p_meta: { provider_id: result.providerId, scheduled_email_id: id },
      });
    }
    if (!opts.manual) {
      await notify(who ? [who] : "finance", {
        type: "scheduled_email_sent", title: row.kind === "payment_reminder" ? "Payment reminder sent" : "Scheduled email sent",
        body: `${row.subject} → ${row.to_email}`.slice(0, 300), url, tag: `sched-${id}`, dedupeKey: `sched-sent:${id}`,
      });
    }
    return { status: "sent", message: `Sent to ${row.to_email}` };
  } catch (e) {
    console.error("[scheduled email]", e);
    return await failed("Unexpected error while sending.", true);
  }
}

// ---------------------------------------------------------------------------
// The scheduler (service-role client; runs with the browser closed)
// ---------------------------------------------------------------------------
type OpenInvoice = {
  id: string; number: string; client_name: string | null; client_company: string | null; project_name: string | null; due_date: string | null;
  balance_due: number | string; payment_status: string; contact_id: string | null;
};
const OPEN = ["issued", "partially_paid", "overdue"];

async function openInvoices(supabase: SupabaseClient): Promise<OpenInvoice[]> {
  const { data } = await supabase.from("invoice_list")
    .select("id, number, client_name, client_company, project_name, due_date, balance_due, payment_status, contact_id")
    .in("payment_status", OPEN).not("due_date", "is", null).not("number", "is", null).limit(3000);
  return ((data ?? []) as OpenInvoice[]).filter((i) => Number(i.balance_due) > 0.004);
}

/** Creates today's automatic reminders (one per invoice per rule, ever). Does nothing unless a manager has switched them on. */
export async function generateAutoReminders(supabase: SupabaseClient, invoices: OpenInvoice[], today: string): Promise<number> {
  const { data: s } = await supabase.from("payment_reminder_settings").select("enabled, offsets, send_hour, subject, body").maybeSingle();
  const settings = s as ReminderSettings | null;
  if (!settings?.enabled || !settings.offsets.length) return 0;
  const due = invoices.map((i) => ({ i, offset: dueOffset(i.due_date, today, settings.offsets) })).filter((x) => x.offset !== null);
  if (!due.length) return 0;

  const ids = due.map((x) => x.i.id);
  const [{ data: emails }, { data: prefs }, { data: contacts }] = await Promise.all([
    supabase.from("invoices").select("id, client_email").in("id", ids),
    supabase.from("invoice_reminder_prefs").select("invoice_id").in("invoice_id", ids).eq("auto_enabled", false),
    supabase.from("contacts").select("id, email").in("id", due.map((x) => x.i.contact_id).filter((c): c is string => !!c)),
  ]);
  const emailOf = new Map((emails ?? []).map((e) => [e.id as string, ((e.client_email as string | null) ?? "").trim()]));
  const contactEmail = new Map((contacts ?? []).map((c) => [c.id as string, ((c.email as string | null) ?? "").trim()]));
  const optedOut = new Set((prefs ?? []).map((p) => p.invoice_id as string));
  const when = zonedToIso(today, `${String(settings.send_hour).padStart(2, "0")}:00`, "Asia/Kolkata")!;

  const rows = [];
  for (const { i, offset } of due) {
    if (optedOut.has(i.id)) continue;
    const to = (emailOf.get(i.id) || (i.contact_id ? contactEmail.get(i.contact_id) : "") || "").toLowerCase();
    if (!to) {
      await notify("finance", {
        type: "invoice_overdue", title: `No email address for ${i.number}`, body: "An automatic payment reminder could not be created because the client has no email address.",
        url: `/invoices/${i.id}`, dedupeKey: `reminder-noemail:${i.id}`,
      });
      continue;
    }
    const inv = { number: i.number, client_name: i.client_name, client_company: i.client_company, project_name: i.project_name, balance_due: Number(i.balance_due), due_date: i.due_date };
    rows.push({
      kind: "payment_reminder", status: "scheduled", related_type: "invoice", related_id: i.id, related_label: i.number, client_name: i.client_company || i.client_name || "",
      to_email: to, subject: fillReminderTemplate(settings.subject, inv).slice(0, 200), body: fillReminderTemplate(settings.body, inv).slice(0, 5000),
      attach_document: true, scheduled_at: when, auto: true, dedupe_key: `inv:${i.id}:${offset}`, created_by: null, assigned_to: null,
    });
  }
  if (!rows.length) return 0;
  const { data } = await supabase.from("scheduled_emails").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

/** Due-soon / overdue invoices and follow-ups due today. Each alert is raised once per person (dedupe key). */
export async function raiseDailyAlerts(supabase: SupabaseClient, invoices: OpenInvoice[], today: string, now: Date): Promise<number> {
  let raised = 0;
  const soon = addDays(today, 3);
  const line = (i: OpenInvoice) =>
    `${i.client_company || i.client_name || "Client"} · ${i.number}${i.project_name ? ` · ${i.project_name}` : ""} · ${formatINR(i.balance_due, { exact: true })} pending · due ${i.due_date}`;
  for (const i of invoices) {
    if (raised >= 40) break;   // a first run on an old ledger must not flood the bell
    const kind = i.due_date === soon ? "soon" : i.due_date === today ? "today" : i.due_date! < today ? "overdue" : null;
    if (!kind) continue;
    await notify("finance", {
      type: kind === "overdue" ? "invoice_overdue" : "invoice_due_soon",
      title: kind === "overdue" ? `Invoice ${i.number} is overdue` : kind === "today" ? `Invoice ${i.number} is due today` : `Invoice ${i.number} is due in 3 days`,
      body: line(i), url: `/invoices/${i.id}`, tag: `invoice-${i.id}`, dedupeKey: `invoice-${kind}:${i.id}:${i.due_date}`,
      data: { invoice_id: i.id, invoice_number: i.number, pending: Number(i.balance_due), due_date: i.due_date },
    });
    raised++;
  }
  const { start, end } = istDayBounds(now);
  const { data: fus } = await supabase.from("follow_up_list").select("id, lead_id, title, lead_title, company_name, created_by")
    .eq("status", "pending").gte("due_at", start.toISOString()).lt("due_at", end.toISOString()).limit(200);
  for (const f of (fus ?? []) as { id: string; lead_id: string; title: string; lead_title: string; company_name: string | null; created_by: string | null }[]) {
    await notify(f.created_by ? [f.created_by] : "team", {
      type: "follow_up_due", title: "Follow-up due today", body: `${f.title} · ${f.company_name || f.lead_title}`, url: `/leads/${f.lead_id}`, tag: `followup-${f.id}`, dedupeKey: `followup-due:${f.id}:${today}`,
    });
    raised++;
  }
  return raised;
}

export type ScheduledJobSummary = { ok: true; remindersCreated: number; due: number; sent: number; failed: number; retried: number; cancelled: number; alerts: number; recovered: number };

/** One scheduler tick. Idempotent: calling it twice in a row sends nothing twice and raises no alert twice. */
export async function runScheduledJobs(supabase: SupabaseClient, now = new Date()): Promise<ScheduledJobSummary> {
  const out: ScheduledJobSummary = { ok: true, remindersCreated: 0, due: 0, sent: 0, failed: 0, retried: 0, cancelled: 0, alerts: 0, recovered: 0 };
  const today = todayIST(now);

  // A run that died mid-send leaves rows in "sending": put them back (the idempotency key makes the retry safe).
  const { data: stuck } = await supabase.from("scheduled_emails").update({ status: "scheduled" }).eq("status", "sending")
    .lt("updated_at", new Date(now.getTime() - 15 * 60000).toISOString()).select("id");
  out.recovered = stuck?.length ?? 0;

  const invoices = await openInvoices(supabase);
  out.remindersCreated = await generateAutoReminders(supabase, invoices, today);

  // Automatic reminders get an hour of slack so a once-a-day scheduler firing a little early still sends them the same day.
  const horizon = new Date(now.getTime() + 60 * 60000).toISOString();
  const { data: dueRows } = await supabase.from("scheduled_emails").select("id, auto, scheduled_at, next_attempt_at").eq("status", "scheduled")
    .lte("scheduled_at", horizon).order("scheduled_at").limit(60);
  const due = ((dueRows ?? []) as { id: string; auto: boolean; scheduled_at: string; next_attempt_at: string | null }[])
    .filter((r) => (r.auto || Date.parse(r.scheduled_at) <= now.getTime()) && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= now.getTime()))
    .slice(0, 25);
  out.due = due.length;
  for (const r of due) {
    const res = await sendScheduledEmail(supabase, r.id);
    if (res.status === "sent") out.sent++;
    else if (res.status === "failed") out.failed++;
    else if (res.status === "retry") out.retried++;
    else if (res.status === "cancelled") out.cancelled++;
  }

  out.alerts = await raiseDailyAlerts(supabase, invoices, today, now);
  return out;
}
