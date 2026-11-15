/** Vendor Rates & Services: pure rules (no I/O), shared by the server actions, the screens, the importer and the tests. */
import Decimal from "decimal.js";
import { z } from "zod";

export const VENDOR_STATUSES = ["active", "inactive", "blacklisted"] as const;
export const VENDOR_STATUS_LABEL: Record<string, string> = { active: "Active", inactive: "Inactive", blacklisted: "Blacklisted" };

export const RATE_TYPES = ["purchase", "rental", "per_day", "per_hour", "per_event", "per_person", "per_sqft", "per_unit", "package", "custom"] as const;
export type RateType = (typeof RATE_TYPES)[number];
export const RATE_TYPE_LABEL: Record<RateType, string> = {
  purchase: "Purchase rate", rental: "Rental rate", per_day: "Per day rate", per_hour: "Per hour rate", per_event: "Per event rate",
  per_person: "Per person rate", per_sqft: "Per sq. ft. rate", per_unit: "Per unit rate", package: "Package rate", custom: "Custom rate",
};
/** Suggestions only: any unit can be typed. */
export const UNITS = ["Per Piece", "Per Unit", "Per Sq. Ft.", "Per Running Ft.", "Per Day", "Per Hour", "Per Person", "Per Event", "Per Outlet", "Per Vehicle", "Per Kg", "Per Litre", "Per Set", "Lump Sum"];

const d = (v: unknown) => { try { const x = new Decimal((v as string | number) ?? 0); return x.isFinite() ? x : new Decimal(0); } catch { return new Decimal(0); } };
const r2 = (x: Decimal) => x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/** One unit plus the fixed charges, with GST on top. Same formula as the vendor_rate_list view. A reference estimate only. */
export function estimatedCost(r: { rate: unknown; setup_charges?: unknown; transport_charges?: unknown; other_charges?: unknown; gst_percent?: unknown }): number {
  const base = d(r.rate).plus(d(r.setup_charges)).plus(d(r.transport_charges)).plus(d(r.other_charges));
  return r2(base.times(d(r.gst_percent).div(100).plus(1)));
}

/**
 * Selling price from an internal cost.
 *   markup: price = cost × (1 + pct/100)        margin: price = cost ÷ (1 − pct/100)   (pct of the selling price is profit)
 * Returns null for a margin of 100% or more, which has no finite price.
 */
export function sellingPrice(cost: unknown, pct: unknown, mode: "markup" | "margin" = "markup"): number | null {
  const c = d(cost);
  const p = d(pct);
  if (p.lt(0)) return null;
  if (mode === "markup") return r2(c.times(p.div(100).plus(1)));
  if (p.gte(100)) return null;
  return r2(c.div(new Decimal(1).minus(p.div(100))));
}

/** Average of the ratings that were actually entered (never invented): null when none are. */
export function overallRating(v: { rating_quality?: number | null; rating_pricing?: number | null; rating_reliability?: number | null; rating_timeliness?: number | null }): number | null {
  const given = [v.rating_quality, v.rating_pricing, v.rating_reliability, v.rating_timeliness].filter((x): x is number => typeof x === "number");
  return given.length ? Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 10) / 10 : null;
}

export type Comparable = { rate: number | string; estimated_cost: number | string; vendor_rating: number | string | null };
export type CompareSort = "lowest" | "highest" | "rating";
/** Orders a comparison. It only sorts: nothing is ever picked on the user's behalf. */
export function sortComparison<T extends Comparable>(rows: T[], sort: CompareSort): T[] {
  const cost = (r: T) => Number(r.estimated_cost);
  return [...rows].sort((a, b) =>
    sort === "highest" ? cost(b) - cost(a)
      : sort === "rating" ? (Number(b.vendor_rating ?? -1) - Number(a.vendor_rating ?? -1)) || cost(a) - cost(b)
        : cost(a) - cost(b));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const text = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`).optional().transform((v) => v ?? "");
const money = (label: string) => z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  const s = String(v ?? "").replace(/[₹,\s]/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999) { ctx.addIssue({ code: "custom", message: `Enter a valid ${label}` }); return z.NEVER; }
  return Math.round(n * 100) / 100;
});
const optMoney = (label: string) => z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  const s = String(v ?? "").replace(/[₹,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999) { ctx.addIssue({ code: "custom", message: `Enter a valid ${label}` }); return z.NEVER; }
  return Math.round(n * 100) / 100;
});
const rating = z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  if (v === undefined || v === "" || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) { ctx.addIssue({ code: "custom", message: "Rate from 1 to 5" }); return z.NEVER; }
  return n;
});
const optDate = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) { ctx.addIssue({ code: "custom", message: "Enter a valid date" }); return z.NEVER; }
  return v;
});

export const vendorProfileSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(200),
  contact_person: text(120), phone: text(40), whatsapp: text(40),
  email: z.string().trim().toLowerCase().max(200).optional().transform((v) => v ?? "").refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address"),
  website: text(200), city: text(80), state: text(80), service_locations: text(300), address: text(500),
  category: text(80), services_provided: text(1000),
  gst_registered: z.boolean().default(false),
  gstin: z.string().trim().toUpperCase().max(20).optional().transform((v) => v ?? "").refine((v) => v === "" || /^[0-9A-Z]{15}$/.test(v), "GSTIN must be 15 letters and digits"),
  pan: z.string().trim().toUpperCase().max(10).optional().transform((v) => v ?? "").refine((v) => v === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "PAN looks like ABCDE1234F"),
  payment_terms: text(300),
  credit_period_days: z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 365) { ctx.addIssue({ code: "custom", message: "0 to 365 days" }); return z.NEVER; }
    return n;
  }),
  advance_requirement: text(200),
  status: z.enum(VENDOR_STATUSES).default("active"),
  is_preferred: z.boolean().default(false),
  rating_quality: rating, rating_pricing: rating, rating_reliability: rating, rating_timeliness: rating,
  feedback: text(2000), past_projects: text(1000), notes: text(2000),
});
export type VendorProfileValues = z.input<typeof vendorProfileSchema>;

export const vendorRateSchema = z.object({
  vendor_id: z.uuid("Choose a vendor"),
  /** An existing catalogue item, or a new name to add to the catalogue. */
  product_id: z.uuid().nullable().optional(),
  product_name: text(200), product_category: text(100), description: text(1000),
  rate_type: z.enum(RATE_TYPES).default("purchase"),
  unit: z.string().trim().min(1, "Unit is required").max(40),
  rate: money("rate"),
  min_order_qty: optMoney("quantity"), rental_duration: text(80), weekly_rate: optMoney("weekly rate"), monthly_rate: optMoney("monthly rate"),
  security_deposit: optMoney("deposit"), damage_charges: text(300),
  setup_charges: money("setup charge"), transport_charges: money("transport charge"), other_charges: money("charge"),
  gst_percent: z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
    const n = Number(String(v ?? "").replace("%", "") || 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) { ctx.addIssue({ code: "custom", message: "GST must be between 0 and 100" }); return z.NEVER; }
    return n;
  }),
  valid_until: optDate, availability: text(200), service_location: text(200), specifications: text(2000), notes: text(1000),
  effective_from: optDate, change_note: text(300),
}).refine((v) => !!v.product_id || v.product_name.length > 0, { message: "Choose a service or enter a new one", path: ["product_name"] });
export type VendorRateValues = z.input<typeof vendorRateSchema>;

// ---------------------------------------------------------------------------
// Excel / CSV import (the template opens and saves in Excel)
// ---------------------------------------------------------------------------
export const IMPORT_COLUMNS = [
  "vendor_name", "vendor_category", "contact_person", "phone", "email", "city", "state", "gstin",
  "service_name", "service_category", "description", "rate_type", "unit", "rate", "setup_charges", "transport_charges", "other_charges",
  "gst_percent", "min_order_qty", "valid_until", "service_location", "notes",
] as const;
export const IMPORT_SAMPLE = [
  "Bright AV Rentals", "LED Screens", "Rakesh Mehta", "+91 98200 00000", "sales@example.com", "Mumbai", "Maharashtra", "",
  "LED Screen 24 x 12 ft (P3)", "LED Screens", "Indoor P3 wall with processor and operator", "per_day", "Per Day", "45000", "3000", "2500", "0",
  "18", "1", "2027-03-31", "Mumbai / Thane / Navi Mumbai", "Rate as per quotation dated 01 Nov 2026",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const TYPE_ALIASES: Record<string, RateType> = {
  purchase: "purchase", purchase_rate: "purchase", buy: "purchase", rental: "rental", rent: "rental", rental_rate: "rental", per_day: "per_day", day: "per_day", daily: "per_day",
  per_hour: "per_hour", hour: "per_hour", hourly: "per_hour", per_event: "per_event", event: "per_event", per_person: "per_person", person: "per_person", pax: "per_person",
  per_sqft: "per_sqft", per_sq_ft: "per_sqft", sqft: "per_sqft", per_unit: "per_unit", package: "package", custom: "custom",
};
const toIsoDate = (v: string): string | null | undefined => {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? undefined : s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);   // DD/MM/YYYY, the usual format in Indian spreadsheets
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).getUTCDate() !== Number(m[1]) ? undefined : iso;
};

export type ImportRow = {
  line: number; errors: string[];
  vendor: { name: string; category: string; contact_person: string; phone: string; email: string; city: string; state: string; gstin: string };
  service: { name: string; category: string; description: string };
  rate: { rate_type: RateType; unit: string; rate: number; setup_charges: number; transport_charges: number; other_charges: number; gst_percent: number; min_order_qty: number | null; valid_until: string | null; service_location: string; notes: string };
};

/** Validates spreadsheet rows. Nothing is saved here: the result is shown for review, with a reason on every row that cannot be imported. */
export function parseImportRows(rows: Record<string, unknown>[]): { rows: ImportRow[]; unknownColumns: string[]; missingColumns: string[] } {
  const headers = new Set(rows.flatMap((r) => Object.keys(r).map(norm)));
  const known = new Set<string>(IMPORT_COLUMNS);
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[norm(k)] = String(v ?? "").trim();
    if (Object.values(r).every((v) => !v)) return;   // blank spreadsheet row
    const errors: string[] = [];
    const num = (key: string, label: string, required = false): number => {
      const s = (r[key] ?? "").replace(/[₹,\s]/g, "");
      if (!s) { if (required) errors.push(`${label} is required`); return 0; }
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { errors.push(`${label} "${r[key]}" is not a valid amount`); return 0; }
      return Math.round(n * 100) / 100;
    };
    if (!r.vendor_name) errors.push("Vendor name is required");
    if (!r.service_name) errors.push("Service name is required");
    if (!r.unit) errors.push("Unit is required");
    const type = TYPE_ALIASES[norm(r.rate_type ?? "")] ?? (r.rate_type ? undefined : "purchase");
    if (!type) errors.push(`Rate type "${r.rate_type}" is not recognised`);
    const rate = num("rate", "Rate", true);
    const gst = num("gst_percent", "GST %");
    if (gst > 100) errors.push("GST % cannot be more than 100");
    if (r.email && !z.email().safeParse(r.email).success) errors.push(`Email "${r.email}" is not valid`);
    const valid = toIsoDate(r.valid_until ?? "");
    if (valid === undefined) errors.push(`Valid until "${r.valid_until}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`);
    const key = `${norm(r.vendor_name ?? "")}|${norm(r.service_name ?? "")}|${type}`;
    if (r.vendor_name && r.service_name && seen.has(key)) errors.push("Duplicate of an earlier row (same vendor, service and rate type)");
    seen.add(key);
    out.push({
      line: i + 2, errors,
      vendor: { name: (r.vendor_name ?? "").slice(0, 200), category: (r.vendor_category ?? "").slice(0, 80), contact_person: (r.contact_person ?? "").slice(0, 120), phone: (r.phone ?? "").slice(0, 40), email: (r.email ?? "").toLowerCase().slice(0, 200), city: (r.city ?? "").slice(0, 80), state: (r.state ?? "").slice(0, 80), gstin: (r.gstin ?? "").toUpperCase().slice(0, 20) },
      service: { name: (r.service_name ?? "").slice(0, 200), category: (r.service_category ?? "").slice(0, 100), description: (r.description ?? "").slice(0, 1000) },
      rate: {
        rate_type: type ?? "purchase", unit: (r.unit ?? "").slice(0, 40), rate, setup_charges: num("setup_charges", "Setup charges"), transport_charges: num("transport_charges", "Transport charges"),
        other_charges: num("other_charges", "Other charges"), gst_percent: gst, min_order_qty: r.min_order_qty ? num("min_order_qty", "Minimum quantity") : null,
        valid_until: valid ?? null, service_location: (r.service_location ?? "").slice(0, 200), notes: (r.notes ?? "").slice(0, 1000),
      },
    });
  });
  return {
    rows: out,
    unknownColumns: [...headers].filter((h) => h && !known.has(h)),
    missingColumns: ["vendor_name", "service_name", "unit", "rate"].filter((c) => !headers.has(c)),
  };
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const importTemplateCsv = () => [IMPORT_COLUMNS.join(","), IMPORT_SAMPLE.map(csvCell).join(",")].join("\r\n") + "\r\n";
