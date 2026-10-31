/** Pulls event dates out of the free text typed on invoices/quotations ("15/02/2027", "15–17 Feb 2027", "15 Feb 2027 to 17 Feb 2027"). */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function parseDateText(text: string | null | undefined): { start: string | null; end: string | null } {
  const t = (text ?? "").trim();
  if (!t) return { start: null, end: null };
  const found: { at: number; date: string }[] = [];

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (Indian day-first order)
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (valid(y, mo, d)) found.push({ at: m.index ?? 0, date: iso(y, mo, d) });
  }
  // 15 Feb 2027 / 15th February 2027
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (mo && valid(Number(m[3]), mo, Number(m[1]))) found.push({ at: m.index ?? 0, date: iso(Number(m[3]), mo, Number(m[1])) });
  }
  // "15–17 Feb 2027": a day range sharing one month and year
  const range = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(t);
  if (range) {
    const mo = MONTHS.indexOf(range[3].slice(0, 3).toLowerCase()) + 1;
    const y = Number(range[4]);
    if (mo && valid(y, mo, Number(range[1])) && valid(y, mo, Number(range[2]))) {
      const a = iso(y, mo, Number(range[1])), b = iso(y, mo, Number(range[2]));
      return a <= b ? { start: a, end: b } : { start: b, end: a };
    }
  }
  const dates = [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.date))];
  if (!dates.length) return { start: null, end: null };
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted.length > 1 ? sorted[sorted.length - 1] : null };
}

export type ProjectPrefill = {
  name: string; company_id: string; lead_id: string; quotation_id: string; category: string; location: string;
  start_date: string; end_date: string; approved_value: string; source: string;
};

const title = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bBtl\b/, "BTL");

/** Combines what the invoice, its quotation and its lead know about the event. The invoice wins, then the quotation, then the lead. */
export function buildPrefill(input: {
  invoice: { number: string | null; project_name?: string | null; project_location?: string | null; project_date_text?: string | null; company_id?: string | null; lead_id?: string | null; quotation_id?: string | null; ex_gst: number };
  quotation?: { event_type?: string | null; event_name?: string | null; event_location?: string | null; event_date_text?: string | null } | null;
  lead?: { title?: string | null; event_name?: string | null; event_date?: string | null; city?: string | null; venue?: string | null; service_category?: string | null; company_id?: string | null } | null;
}): ProjectPrefill {
  const { invoice: i, quotation: q, lead: l } = input;
  const text = (i.project_date_text || q?.event_date_text || "").trim();
  const parsed = parseDateText(text);
  const place = [l?.venue, l?.city].filter(Boolean).join(", ");
  const sources = [i.number ? `invoice ${i.number}` : "invoice", q ? "its quotation" : "", l ? "its lead" : ""].filter(Boolean);
  return {
    name: (i.project_name || q?.event_name || l?.event_name || l?.title || "").trim(),
    company_id: i.company_id || l?.company_id || "",
    lead_id: i.lead_id || "",
    quotation_id: i.quotation_id || "",
    category: (q?.event_type || (l?.service_category ? title(l.service_category) : "")).trim(),
    location: (i.project_location || q?.event_location || place || "").trim(),
    start_date: parsed.start ?? l?.event_date ?? "",
    end_date: parsed.end ?? "",
    approved_value: i.ex_gst > 0 ? String(i.ex_gst) : "",
    source: sources.join(", "),
  };
}
