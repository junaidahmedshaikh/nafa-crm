/** Daily Business Briefing: pure rules (no I/O) — the schedule decision, the report shape and the email rendering. */
import { z } from "zod";
import { TIMEZONES } from "@/lib/scheduled/core";

export type BriefingItem = { title: string; detail?: string; href?: string; priority?: "high" | "normal" };
export type BriefingSection = { key: string; title: string; items: BriefingItem[]; more?: { label: string; href: string }; note?: string };
export type BriefingAction = { title: string; action: string; reason: string; href?: string };
export type BusinessBriefing = {
  date: string; generatedAt: string;
  headline: { label: string; value: string; tone?: "bad" | "good" }[];
  sections: BriefingSection[];
  actionPlan: BriefingAction[];
};

export type BriefingSettings = {
  enabled: boolean; delivery_time: string; timezone: string; method: "email" | "in_app" | "both"; recipient_email: string;
  days: "all" | "weekdays" | "custom"; custom_days: number[];
};
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const briefingSettingsSchema = z.object({
  enabled: z.boolean(),
  delivery_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time"),
  timezone: z.enum(TIMEZONES),
  method: z.enum(["email", "in_app", "both"]),
  recipient_email: z.string().trim().toLowerCase().max(200).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address"),
  days: z.enum(["all", "weekdays", "custom"]),
  custom_days: z.array(z.number().int().min(0).max(6)).max(7),
}).refine((v) => v.method === "in_app" || v.recipient_email !== "" || !v.enabled, { message: "Enter the email address the briefing should go to", path: ["recipient_email"] })
  .refine((v) => v.days !== "custom" || v.custom_days.length > 0, { message: "Choose at least one day", path: ["custom_days"] });

/** The wall clock in a time zone: date, minutes since midnight and weekday (0 = Sunday). */
export function zonedNow(now: Date, timeZone: string): { date: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
}

/** Whether today's scheduled briefing is due. Returns the reason when it is not, so the job log explains every skip. */
export function briefingDue(s: BriefingSettings, now: Date): { due: true; date: string } | { due: false; reason: string } {
  if (!s.enabled) return { due: false, reason: "Daily briefing is switched off" };
  const z = zonedNow(now, s.timezone);
  const days = s.days === "all" ? [0, 1, 2, 3, 4, 5, 6] : s.days === "weekdays" ? [1, 2, 3, 4, 5] : s.custom_days;
  if (!days.includes(z.weekday)) return { due: false, reason: `Not a delivery day (${DAY_NAMES[z.weekday]})` };
  const at = Number(s.delivery_time.slice(0, 2)) * 60 + Number(s.delivery_time.slice(3, 5));
  if (z.minutes < at) return { due: false, reason: "Before the delivery time" };
  return { due: true, date: z.date };
}

// ---------------------------------------------------------------------------
// Email (HTML with inline styles for mail clients, plus a plain-text alternative)
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const briefingSubject = (date: string) => `NAFA Daily Business Briefing | ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;

/** `appUrl` turns record paths into links; without it the text is still complete, just not clickable. */
export function renderBriefingEmail(b: BusinessBriefing, summary: string, appUrl?: string, briefingPath?: string): { html: string; text: string } {
  const base = (appUrl ?? "").replace(/\/$/, "");
  const url = (href?: string) => (href && base && href.startsWith("/") ? `${base}${href}` : null);
  const a = (label: string, href?: string) => { const u = url(href); return u ? `<a href="${esc(u)}" style="color:#9a6b1f;text-decoration:none;font-weight:600">${esc(label)}</a>` : `<strong>${esc(label)}</strong>`; };
  const item = (i: BriefingItem) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #f0ece4;font-size:14px;line-height:1.45;color:#222">${i.priority === "high" ? '<span style="color:#b42318;font-weight:700">● </span>' : ""}${a(i.title, i.href)}${i.detail ? `<br><span style="color:#666;font-size:13px">${esc(i.detail)}</span>` : ""}</td></tr>`;
  const section = (title: string, inner: string) =>
    `<tr><td style="padding:22px 24px 0"><h2 style="margin:0 0 8px;font-size:15px;color:#111;border-left:3px solid #c8963e;padding-left:8px">${esc(title)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table></td></tr>`;
  const none = '<tr><td style="padding:6px 0;font-size:14px;color:#888">No updates</td></tr>';

  const sections = b.sections.map((s) => section(s.title,
    (s.items.length ? s.items.map(item).join("") : none)
    + (s.note ? `<tr><td style="padding:6px 0;font-size:12px;color:#888">${esc(s.note)}</td></tr>` : "")
    + (s.more && url(s.more.href) ? `<tr><td style="padding:8px 0 0;font-size:13px">${a(`${s.more.label} →`, s.more.href)}</td></tr>` : ""))).join("");
  const plan = section("Today's Recommended Action Plan", b.actionPlan.length
    ? b.actionPlan.map((p, n) => `<tr><td style="padding:7px 0;border-bottom:1px solid #f0ece4;font-size:14px;line-height:1.45;color:#222"><strong>${n + 1}.</strong> ${a(p.title, p.href)} — ${esc(p.action)}<br><span style="color:#666;font-size:13px">Why: ${esc(p.reason)}</span></td></tr>`).join("")
    : none);
  const stats = b.headline.map((h) => `<td style="padding:8px 10px;border:1px solid #eee6d8;border-radius:6px;font-size:12px;color:#666;vertical-align:top">${esc(h.label)}<br><span style="font-size:16px;font-weight:700;color:${h.tone === "bad" ? "#b42318" : h.tone === "good" ? "#067647" : "#111"}">${esc(h.value)}</span></td>`).join('<td style="width:6px"></td>');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#16181d;padding:20px 24px;color:#ffffff"><div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#c8963e">NAFA Events &amp; Activations</div><div style="font-size:20px;font-weight:700;margin-top:4px">Daily Business Briefing</div><div style="font-size:13px;color:#c9c9c9;margin-top:2px">${esc(longDate(b.date))}</div></td></tr>
<tr><td style="padding:22px 24px 0"><h2 style="margin:0 0 8px;font-size:15px;color:#111;border-left:3px solid #c8963e;padding-left:8px">Good Morning – Executive Summary</h2><p style="margin:0;font-size:14px;line-height:1.55;color:#222;white-space:pre-line">${esc(summary)}</p></td></tr>
${stats ? `<tr><td style="padding:16px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${stats}</tr></table></td></tr>` : ""}
${sections}${plan}
<tr><td style="padding:24px;font-size:12px;color:#888;line-height:1.5">${url(briefingPath) ? `${a("View the full briefing in the CRM →", briefingPath)}<br><br>` : ""}Every figure comes from records in NAFA CRM at ${esc(new Date(b.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }))} IST. Sections with nothing recorded say “No updates”. Nothing was sent to any client.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `NAFA Daily Business Briefing — ${longDate(b.date)}`, "", summary, "",
    ...b.headline.map((h) => `${h.label}: ${h.value}`), "",
    ...b.sections.flatMap((s) => [s.title.toUpperCase(), ...(s.items.length ? s.items.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ""}${url(i.href) ? ` ${url(i.href)}` : ""}`) : ["No updates"]), ...(s.note ? [s.note] : []), ""]),
    "TODAY'S RECOMMENDED ACTION PLAN",
    ...(b.actionPlan.length ? b.actionPlan.map((p, n) => `${n + 1}. ${p.title} — ${p.action} (Why: ${p.reason})${url(p.href) ? ` ${url(p.href)}` : ""}`) : ["No updates"]),
  ].join("\n");
  return { html, text };
}
