/** Pure formatting helpers for documents (safe to import from client components). */
export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Multi-line text → escaped HTML with <br>. */
export const escMultiline = (v: unknown): string => esc(v).replace(/\r?\n/g, "<br>");

const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian digit grouping, always 2 dp: 125000 → "1,25,000.00". No currency symbol. */
export function money(v: number | string): string {
  const n = Number(v);
  return Number.isFinite(n) ? inr2.format(n) : "0.00";
}

export const RUPEE = "₹";

/** Quantity without trailing zeros: 2 → "2", 2.50 → "2.5", 0.333 → "0.333". */
export function qtyText(v: number | string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(3)));
}

/** "2026-10-28" → "28/10/2026" (calendar date, no timezone conversion). */
export function dmy(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-01" → "01 November 2026". */
export function longDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

