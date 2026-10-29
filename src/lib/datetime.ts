import { BUSINESS_TIME_ZONE } from "@/lib/constants";

/**
 * All business dates are Indian Standard Time (UTC+05:30, no DST). Timestamps are stored as
 * timestamptz; this module converts between "wall clock in IST" strings (what the forms use)
 * and UTC instants (what the database stores).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2026-11-03T15:30" (IST wall clock) -> ISO instant. Returns null for invalid input. */
export function istLocalToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec((local ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
  const date = new Date(utc);
  // Reject roll-overs such as 2026-02-31
  const back = new Date(utc + IST_OFFSET_MS);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return date.toISOString();
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in IST, for <input type="datetime-local">. */
export function isoToIstLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Start of the IST calendar day containing `now`, and the start of the next one (UTC instants). */
export function istDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS;
  return { start: new Date(startUtc), end: new Date(startUtc + 24 * 3600 * 1000) };
}

export function istMonthStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - IST_OFFSET_MS);
}

/** "YYYY-MM-DD" (an IST calendar date) -> instant at 00:00 IST. */
export function istDateStart(date: string): Date | null {
  const iso = istLocalToIso(`${date}T00:00`);
  return iso ? new Date(iso) : null;
}

/** Default value for a follow-up input: today + N days at HH:mm IST. */
export function defaultFollowUpLocal(days: number, time: string, now: Date = new Date()): string {
  const { start } = istDayBounds(now);
  const target = new Date(start.getTime() + days * 24 * 3600 * 1000 + IST_OFFSET_MS);
  return `${target.toISOString().slice(0, 10)}T${time.slice(0, 5)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: BUSINESS_TIME_ZONE,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** Compact "in 3 days" / "2 days overdue" label relative to now. */
export function relativeDue(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const unit = mins < 60 ? `${mins} min` : mins < 60 * 24 ? `${Math.round(mins / 60)} hr` : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) === 1 ? "" : "s"}`;
  if (mins < 1) return "now";
  return diffMs < 0 ? `${unit} overdue` : `in ${unit}`;
}
