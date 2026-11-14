"use server";

import { authorized } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { fail, isUuid, refresh } from "@/lib/actions/util";
import { fieldErrorsFrom } from "@/lib/validation/common";
import {
  NOTIFICATION_TYPES, RELATED_PATH, RELATED_TYPES, reminderSettingsSchema, scheduledEmailSchema, zonedToIso, type RelatedType, type ScheduledEmailValues,
} from "@/lib/scheduled/core";
import { sendScheduledEmail } from "@/lib/scheduled/processor";
import { getEmailContext, type EmailContext } from "@/lib/scheduled/repo";

const NOT_SET_UP = "Scheduled emails are not set up yet. Run supabase/migrations/20261118000001_scheduled_emails_reminders.sql in the Supabase SQL editor.";
const dbFail = (e: { code?: string; message: string }) =>
  fail(e.code === "42P01" || e.code === "PGRST205" ? NOT_SET_UP : e.message.startsWith("EMAIL_ALREADY_SENT") ? "This email has already been sent and can no longer be changed." : "The email could not be saved. Please try again.");

const EDITABLE = ["draft", "scheduled", "failed"];
const paths = (type?: string | null, id?: string | null) =>
  ["/scheduled-emails", "/payment-reminders", ...(type && id && type in RELATED_PATH ? [`${RELATED_PATH[type as RelatedType]}/${id}`] : [])];

/** Pre-fills the composer from the real record. Reads only. */
export async function getScheduleContext(type: string | null, id: string | null, kind: "follow_up" | "payment_reminder" = "follow_up"): Promise<ActionResult<EmailContext>> {
  return authorized<EmailContext>(async ({ supabase }) => {
    if (type && !(RELATED_TYPES as readonly string[]).includes(type)) return fail("Record not found.");
    const ctx = await getEmailContext(supabase, (type as RelatedType | null) || null, id, kind === "payment_reminder" ? "payment_reminder" : "follow_up");
    if (!ctx) return fail("Record not found.");
    if (ctx.blocked) return fail(ctx.blocked);
    return { ok: true, data: ctx };
  });
}

export type SaveMode = "draft" | "schedule" | "now";

/**
 * Saves a follow-up / reminder email as a draft, schedules it, or sends it straight away.
 * Nothing is ever sent unless the caller explicitly chose "schedule" or "now".
 */
export async function saveScheduledEmail(values: ScheduledEmailValues, mode: SaveMode, id?: string): Promise<ActionResult<{ id: string; status: string; message: string }>> {
  return authorized<{ id: string; status: string; message: string }>(async ({ supabase, user }) => {
    if (!["draft", "schedule", "now"].includes(mode)) return fail("Unknown action.");
    if (id && !isUuid(id)) return fail("Email not found.");
    const parsed = scheduledEmailSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const v = parsed.data;

    // The related record is re-read on the server: its label, client and "can a PDF be attached" are never taken from the browser.
    const ctx = await getEmailContext(supabase, v.related_type, v.related_id, v.kind);
    if (!ctx) return fail("The related record was not found.");
    if (ctx.blocked) return fail(ctx.blocked);
    if (v.kind === "payment_reminder" && v.related_type !== "invoice") return fail("A payment reminder must belong to an invoice.");

    let scheduledAt: string | null = null;
    if (mode === "schedule") {
      scheduledAt = zonedToIso(v.date, v.time, v.timezone);
      if (!scheduledAt) return fail("Choose the date and time to send this email.", { date: "Choose a date", time: "Choose a time" });
      if (Date.parse(scheduledAt) < Date.now() - 60_000) return fail("That date and time has already passed.", { date: "Must be in the future" });
      if (Date.parse(scheduledAt) > Date.now() + 366 * 86400000) return fail("Schedule within the next 12 months.", { date: "Too far ahead" });
    } else if (mode === "now") {
      scheduledAt = new Date().toISOString();
    } else if (v.date && v.time) {
      scheduledAt = zonedToIso(v.date, v.time, v.timezone);   // a draft may remember the intended time
    }

    const row = {
      kind: v.kind, related_type: ctx.relatedType, related_id: ctx.relatedId, related_label: ctx.label, client_name: ctx.clientName,
      to_email: v.to, cc_emails: v.cc, subject: v.subject, body: v.body, attach_document: v.attach_document && ctx.canAttach,
      scheduled_at: scheduledAt, timezone: v.timezone, status: mode === "draft" ? "draft" : "scheduled",
      attempts: 0, next_attempt_at: null, last_error: null, cancel_reason: null, assigned_to: v.assigned_to ?? user.id,
    };

    let rowId = id;
    if (id) {
      const { data: cur } = await supabase.from("scheduled_emails").select("revision, status").eq("id", id).maybeSingle();
      if (!cur) return fail("Email not found.");
      if (!EDITABLE.includes(cur.status)) return fail(cur.status === "sent" ? "This email has already been sent." : "This email can no longer be edited.");
      // The status condition makes the edit lose cleanly if the scheduler picked the email up in the meantime.
      const { data, error } = await supabase.from("scheduled_emails").update({ ...row, revision: cur.revision + 1 }).eq("id", id).in("status", EDITABLE).select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("This email is being sent right now and can no longer be edited.");
    } else {
      const { data, error } = await supabase.from("scheduled_emails").insert(row).select("id").single();
      if (error) return dbFail(error);
      rowId = data.id as string;
    }
    refresh(paths(ctx.relatedType, ctx.relatedId));

    if (mode === "now") {
      const res = await sendScheduledEmail(supabase, rowId!, { manual: true });
      refresh(paths(ctx.relatedType, ctx.relatedId));
      if (res.status !== "sent") return fail(`The email was NOT sent: ${res.message}`);
      return { ok: true, data: { id: rowId!, status: "sent", message: `Email accepted by the provider and sent to ${v.to}` } };
    }
    return { ok: true, data: { id: rowId!, status: row.status, message: mode === "draft" ? "Draft saved" : "Email scheduled" } };
  });
}

export async function cancelScheduledEmail(id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Email not found.");
    const { data, error } = await supabase.from("scheduled_emails").update({ status: "cancelled", cancel_reason: "Cancelled by a team member", next_attempt_at: null })
      .eq("id", id).in("status", EDITABLE).select("related_type, related_id");
    if (error) return dbFail(error);
    if (!data?.length) return fail("This email has already been sent or cancelled.");
    refresh(paths(data[0].related_type, data[0].related_id));
    return { ok: true };
  });
}

/** Sends a draft / scheduled / failed email immediately. The person clicking is the approval. */
export async function sendScheduledNow(id: string): Promise<ActionResult<{ message: string }>> {
  return authorized<{ message: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Email not found.");
    const { data: cur } = await supabase.from("scheduled_emails").select("revision, to_email, subject, body, related_type, related_id").eq("id", id).maybeSingle();
    if (!cur) return fail("Email not found.");
    if (!cur.to_email || !cur.subject || !cur.body) return fail("Complete the recipient, subject and message before sending.");
    const { data, error } = await supabase.from("scheduled_emails")
      .update({ status: "scheduled", scheduled_at: new Date().toISOString(), attempts: 0, next_attempt_at: null, last_error: null, cancel_reason: null, revision: cur.revision + 1 })
      .eq("id", id).in("status", EDITABLE).select("id");
    if (error) return dbFail(error);
    if (!data?.length) return fail("This email has already been sent or cancelled.");
    const res = await sendScheduledEmail(supabase, id, { manual: true });
    refresh(paths(cur.related_type, cur.related_id));
    if (res.status === "cancelled") return fail(`Not sent: ${res.message}`);
    if (res.status !== "sent") return fail(`The email was NOT sent: ${res.message}`);
    return { ok: true, data: { message: `Email accepted by the provider and sent to ${cur.to_email}` } };
  });
}

// ---------------------------------------------------------------------------
// Payment reminder settings
// ---------------------------------------------------------------------------
export async function saveReminderSettings(values: { enabled: boolean; offsets: number[]; send_hour: number; subject: string; body: string }): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    const parsed = reminderSettingsSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const d = parsed.data;
    const { data, error } = await supabase.from("payment_reminder_settings")
      .update({ ...d, offsets: [...new Set(d.offsets)].sort((a, b) => a - b), updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", true).select("id");
    if (error) return dbFail(error);
    // RLS: only admin / accounts / management can change these, so an empty result means "not allowed".
    if (!data?.length) return fail("Only an administrator or the accounts / management team can change payment reminder settings.");
    refresh(["/payment-reminders"]);
    return { ok: true };
  });
}

/** Switches automatic reminders on or off for one invoice. Switching off also cancels its automatic reminders that are still waiting. */
export async function setInvoiceAutoReminder(invoiceId: string, enabled: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(invoiceId)) return fail("Invoice not found.");
    const { data: inv } = await supabase.from("invoices").select("id").eq("id", invoiceId).maybeSingle();
    if (!inv) return fail("Invoice not found.");
    const { error } = await supabase.from("invoice_reminder_prefs").upsert({ invoice_id: invoiceId, auto_enabled: !!enabled, updated_at: new Date().toISOString() }, { onConflict: "invoice_id" });
    if (error) return dbFail(error);
    if (!enabled) {
      await supabase.from("scheduled_emails").update({ status: "cancelled", cancel_reason: "Automatic reminders were switched off for this invoice" })
        .eq("kind", "payment_reminder").eq("related_id", invoiceId).eq("auto", true).eq("status", "scheduled");
    }
    refresh(["/payment-reminders", `/invoices/${invoiceId}`]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Notification preferences (each person's own)
// ---------------------------------------------------------------------------
export async function saveNotificationPreferences(mutedTypes: string[]): Promise<ActionResult> {
  return authorized(async ({ supabase, user }) => {
    const muted = [...new Set(mutedTypes)].filter((t) => t in NOTIFICATION_TYPES);
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: user.id, muted_types: muted, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return dbFail(error);
    refresh(["/notifications"]);
    return { ok: true };
  });
}
