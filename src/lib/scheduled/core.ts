/** Scheduled emails and payment reminders: pure rules (no I/O), shared by the server actions, the scheduler and the tests. */
import { z } from "zod";
import { parseAddressList, SIGNATURE } from "@/lib/documents/email-template";

export const RELATED_TYPES = ["contact", "lead", "quotation", "invoice", "project"] as const;
export type RelatedType = (typeof RELATED_TYPES)[number];
export const RELATED_LABEL: Record<RelatedType, string> = { contact: "Contact", lead: "Lead", quotation: "Quotation", invoice: "Invoice", project: "Project" };
export const RELATED_PATH: Record<RelatedType, string> = { contact: "/contacts", lead: "/leads", quotation: "/quotations", invoice: "/invoices", project: "/projects" };

export const SCHEDULE_STATUSES = ["draft", "scheduled", "sending", "sent", "failed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export const STATUS_LABEL: Record<ScheduleStatus, string> = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled" };

export const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"] as const;
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export const MAX_ATTEMPTS = 4;
/** Minutes to wait before attempt n+1 after a temporary failure. */
export const retryDelayMinutes = (attempts: number) => [5, 30, 120][Math.min(Math.max(attempts, 1), 3) - 1];

/** Minutes a zone is ahead of UTC at a given instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - at.getTime()) / 60000);
}

/** "2026-11-20" + "10:30" in a time zone -> the UTC instant (ISO), or null when the input is not a real date/time. */
export function zonedToIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !(TIMEZONES as readonly string[]).includes(timeZone)) return null;
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naive)) return null;
  // Two passes so a time next to a daylight-saving change still resolves to the right offset.
  let utc = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  utc = naive - offsetMinutes(new Date(utc), timeZone) * 60000;
  return new Date(utc).toISOString();
}

/** The reverse: an instant -> the date and time shown on a clock in that zone. */
export function isoToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso);
  const local = new Date(at.getTime() + offsetMinutes(at, timeZone) * 60000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export const scheduledEmailSchema = z.object({
  kind: z.enum(["follow_up", "payment_reminder"]).default("follow_up"),
  related_type: z.enum(RELATED_TYPES).nullable().default(null),
  related_id: z.uuid().nullable().default(null),
  to: z.string().trim().toLowerCase().pipe(z.email("Enter a valid recipient email address")),
  cc: z.string().max(1000).optional().transform((v, ctx) => {
    const list = parseAddressList(v);
    const bad = list.find((a) => !z.email().safeParse(a).success);
    if (bad) ctx.addIssue({ code: "custom", message: `"${bad}" is not a valid email address` });
    else if (list.length > 10) ctx.addIssue({ code: "custom", message: "CC can have at most 10 addresses" });
    return list;
  }),
  subject: z.string().trim().min(1, "Subject is required").max(200, "Must be 200 characters or fewer"),
  body: z.string().trim().min(1, "Message is required").max(5000, "Must be 5000 characters or fewer"),
  attach_document: z.boolean().default(false),
  date: z.string().optional().default(""),
  time: z.string().optional().default(""),
  timezone: z.enum(TIMEZONES).default(DEFAULT_TIMEZONE),
  assigned_to: z.uuid().nullable().optional(),
});
export type ScheduledEmailValues = z.input<typeof scheduledEmailSchema>;

// ---------------------------------------------------------------------------
// Payment reminders
// ---------------------------------------------------------------------------
export const REMINDER_OFFSETS = [-7, -3, -1, 0, 3, 7, 15] as const;
export function offsetLabel(o: number): string {
  if (o === 0) return "On the due date";
  const d = Math.abs(o);
  return `${d} day${d === 1 ? "" : "s"} ${o < 0 ? "before" : "after"} the due date`;
}

const inr = (v: number) => `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
const longDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }) : "—");

export type ReminderInvoice = { number: string; client_name: string | null; client_company: string | null; project_name: string | null; balance_due: number; due_date: string | null };

/** Fills {{placeholders}} in the reminder wording. Unknown placeholders are left as typed so a typo is visible. */
export function fillReminderTemplate(template: string, inv: ReminderInvoice): string {
  const values: Record<string, string> = {
    client_name: inv.client_name?.trim() || inv.client_company?.trim() || "Sir/Madam",
    client_company: inv.client_company?.trim() ?? "",
    invoice_number: inv.number,
    project_name: inv.project_name?.trim() ?? "",
    project_clause: inv.project_name?.trim() ? ` for ${inv.project_name.trim()}` : "",
    pending_amount: inr(inv.balance_due),
    due_date: longDate(inv.due_date),
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

/** YYYY-MM-DD plus n days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The automatic reminder rule (if any) that falls on `today` for an invoice due on `dueDate`. */
export function dueOffset(dueDate: string | null, today: string, offsets: readonly number[]): number | null {
  if (!dueDate) return null;
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  return offsets.includes(diff) ? diff : null;
}

/** An invoice still needs chasing only while it is issued and money is outstanding. */
export const invoiceOpen = (state: string, balance: number) => state === "issued" && balance > 0.004;

export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  offsets: z.array(z.number().int()).max(13).refine((a) => a.every((o) => [-30, -15, -7, -3, -1, 0, 1, 3, 7, 15, 30, 45, 60].includes(o)), "Unsupported reminder day"),
  send_hour: z.number().int().min(0).max(23),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Message is required").max(5000),
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

// ---------------------------------------------------------------------------
// Notification types (the bell, the notification centre and each person's preferences)
// ---------------------------------------------------------------------------
export const NOTIFICATION_TYPES = {
  payment_received: "Payment received",
  payment_partial: "Partial payment received",
  invoice_due_soon: "Invoice due soon",
  invoice_overdue: "Invoice overdue",
  scheduled_email_sent: "Scheduled email sent",
  scheduled_email_failed: "Scheduled email failed",
  follow_up_due: "Follow-up due today",
  expense_recorded: "Project expense recorded",
  budget_exceeded: "Project budget exceeded",
  profit_warning: "Project profitability warning",
  email_reply: "Email reply received",
  campaign_completed: "Campaign finished",
  bdm_briefing: "Morning briefing",
  app_install: "App installed",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const notificationLabel = (t: string) => (NOTIFICATION_TYPES as Record<string, string>)[t] ?? t.replace(/_/g, " ");

// ---------------------------------------------------------------------------
// Default follow-up wording (always editable before it is scheduled)
// ---------------------------------------------------------------------------
const FOLLOW_UP_BODY: Record<RelatedType | "general", (label: string) => string[]> = {
  quotation: (l) => [`I hope you are doing well. I am following up on our quotation ${l}, shared with you earlier.`, "Please let us know if you need any clarification or would like us to adjust the scope or commercials. We would be glad to take this forward at your convenience."],
  invoice: (l) => [`I hope you are doing well. This is a follow-up regarding invoice ${l}.`, "Kindly let us know the expected payment date, or share the transaction details if the payment has already been made."],
  project: (l) => [`I hope you are doing well. I am writing to follow up on ${l}.`, "Please let us know if anything is pending from our side, and a convenient time to connect on the next steps."],
  lead: (l) => [`I hope you are doing well. I am following up on our conversation regarding ${l}.`, "Please let us know if you need any further information from us. We would be happy to schedule a quick call at a time that suits you."],
  contact: () => ["I hope you are doing well. I am writing to follow up on our recent conversation.", "Please let us know if you need any further information from us. We would be happy to schedule a quick call at a time that suits you."],
  general: () => ["I hope you are doing well. I am writing to follow up on our recent conversation.", "Please let us know if you need any further information from us."],
};

export function followUpDraft(type: RelatedType | null, ctx: { name?: string | null; label?: string | null }) {
  const label = ctx.label?.trim() || "";
  const subject = type === "quotation" ? `Following up: Quotation ${label}` : type === "invoice" ? `Following up: Invoice ${label}` : label ? `Following up: ${label}` : "Following up";
  return {
    subject: `${subject} – NAFA Events & Activations`.slice(0, 200),
    body: [`Dear ${ctx.name?.trim() || "Sir/Madam"},`, ...FOLLOW_UP_BODY[type ?? "general"](label || "our discussion"), SIGNATURE].join("\n\n"),
  };
}
