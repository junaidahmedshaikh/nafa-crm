import {
  LEAD_PRIORITIES, LEAD_PRIORITY_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS,
  SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS,
} from "@/lib/constants";
import { normalizeCompanyName, normalizeEmail, phoneDigits } from "@/lib/normalize";
import { fieldErrorsFrom } from "@/lib/validation/common";
import { leadSchema, type LeadFormData } from "@/lib/validation/schemas";

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/**
 * Neutralises spreadsheet formula injection (cells starting with = + - @ or control characters
 * are interpreted as formulas by Excel/Sheets) while leaving plain phone numbers and amounts alone.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/^[=@\t\r]/.test(s)) return `'${s}`;
  if (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) return `'${s}`;
  return s;
}

function escapeCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

/** Builds a CSV string (RFC 4180, CRLF) with a UTF-8 BOM so Excel opens ₹/accents correctly. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(sanitizeCsvCell(c.value(row)))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const IMPORT_MAX_ROWS = 300;

/** Canonical import columns (also the template header). */
export const IMPORT_TEMPLATE_HEADERS = [
  "title", "company", "website", "contact_name", "designation", "email", "phone", "whatsapp",
  "source", "service_category", "event_name", "event_date", "city", "venue",
  "budget_inr", "expected_revenue_inr", "status", "priority", "last_contact_date", "next_follow_up", "notes", "lost_reason",
] as const;
type Canonical = (typeof IMPORT_TEMPLATE_HEADERS)[number];

const ALIASES: Record<string, Canonical> = {
  title: "title", lead_title: "title", lead: "title", lead_name: "title", opportunity: "title", opportunity_name: "title",
  company: "company", company_name: "company",
  website: "website",
  contact_name: "contact_name", contact: "contact_name", contact_person: "contact_name", name: "contact_name",
  designation: "designation",
  email: "email", email_address: "email",
  phone: "phone", phone_number: "phone", mobile: "phone",
  whatsapp: "whatsapp", whatsapp_number: "whatsapp",
  source: "source", lead_source: "source",
  service_category: "service_category", service: "service_category", category: "service_category",
  event_name: "event_name", event: "event_name", campaign: "event_name", campaign_name: "event_name", event_campaign: "event_name",
  event_date: "event_date", city: "city", venue: "venue",
  budget_inr: "budget_inr", budget: "budget_inr", estimated_budget: "budget_inr",
  expected_revenue_inr: "expected_revenue_inr", expected_revenue: "expected_revenue_inr", revenue: "expected_revenue_inr",
  status: "status", lead_status: "status", priority: "priority",
  last_contact_date: "last_contact_date", last_contact: "last_contact_date",
  next_follow_up: "next_follow_up", next_follow_up_date: "next_follow_up",
  notes: "notes", requirements: "notes", lost_reason: "lost_reason",
};

export function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Maps arbitrary CSV headers to canonical import columns. Returns unknown headers for reporting. */
export function mapHeaders(headers: string[]): { mapping: Record<string, Canonical>; unknown: string[]; missingRequired: boolean } {
  const mapping: Record<string, Canonical> = {};
  const unknown: string[] = [];
  for (const h of headers) {
    const canonical = ALIASES[normalizeHeader(h)];
    if (canonical && !Object.values(mapping).includes(canonical)) mapping[h] = canonical;
    else if (normalizeHeader(h) && !["lead_id", "id", "created_at", "updated_at", "assigned_to"].includes(normalizeHeader(h))) unknown.push(h);
  }
  return { mapping, unknown, missingRequired: !Object.values(mapping).includes("title") };
}

function matchEnum<T extends string>(raw: string, values: readonly T[], labels: Record<T, string>): T | undefined {
  const v = raw.trim().toLowerCase().replace(/[\s/_-]+/g, "");
  if (!v) return undefined;
  return values.find((x) => x.replace(/_/g, "") === v || labels[x].toLowerCase().replace(/[\s/_-]+/g, "") === v);
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY. Returns "" when blank, the input unchanged when unparseable. */
export function normalizeDateInput(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return v;
}

function normalizeDateTimeInput(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const m = /^(.+?)[T\s]+(\d{1,2}:\d{2})$/.exec(v);
  if (m) return `${normalizeDateInput(m[1])}T${m[2].padStart(5, "0")}`;
  const d = normalizeDateInput(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T10:00` : d; // date only => 10:00 IST
}

export type RawRow = Record<string, string>;

export type RowResult =
  | { row: number; status: "valid"; data: LeadFormData; key: string }
  | { row: number; status: "duplicate"; data: LeadFormData; key: string; reason: string }
  | { row: number; status: "invalid"; errors: string[] };

/** Duplicate identity for a lead row: same title for the same person/company. */
export function leadDuplicateKey(title: string, email: string | null, phone: string | null, company: string | null): string {
  const who = normalizeEmail(email) ?? phoneDigits(phone) ?? (company ? normalizeCompanyName(company) : "");
  return `${title.trim().toLowerCase().replace(/\s+/g, " ")}|${who}`;
}

export function rowToFormInput(raw: RawRow, mapping: Record<string, Canonical>) {
  const get = (c: Canonical) => {
    const header = Object.keys(mapping).find((h) => mapping[h] === c);
    return header ? (raw[header] ?? "").toString().trim() : "";
  };
  const errors: string[] = [];
  const enumField = <T extends string>(c: Canonical, values: readonly T[], labels: Record<T, string>, fallback: T): T => {
    const v = get(c);
    if (!v) return fallback;
    const m = matchEnum(v, values, labels);
    if (!m) errors.push(`${c}: "${v}" is not one of ${values.map((x) => labels[x]).join(", ")}`);
    return m ?? fallback;
  };
  const input = {
    title: get("title"),
    company_name: get("company"),
    website: get("website"),
    contact_name: get("contact_name"),
    designation: get("designation"),
    email: get("email"),
    phone: get("phone"),
    whatsapp: get("whatsapp"),
    source: enumField("source", LEAD_SOURCES, LEAD_SOURCE_LABELS, "other"),
    service_category: enumField("service_category", SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, "other"),
    event_name: get("event_name"),
    event_date: normalizeDateInput(get("event_date")),
    city: get("city"),
    venue: get("venue"),
    budget_inr: get("budget_inr"),
    expected_revenue_inr: get("expected_revenue_inr"),
    status: enumField("status", LEAD_STATUSES, LEAD_STATUS_LABELS, "new"),
    priority: enumField("priority", LEAD_PRIORITIES, LEAD_PRIORITY_LABELS, "medium"),
    assigned_to: "",
    last_contact_date: normalizeDateInput(get("last_contact_date")),
    notes: get("notes"),
    lost_reason: get("lost_reason"),
    first_follow_up_at: normalizeDateTimeInput(get("next_follow_up")),
  };
  return { input, errors };
}

/**
 * Validates every row. Nothing is dropped silently: each row is reported as valid, a duplicate
 * (of an existing lead or an earlier row in the same file) or invalid with human-readable reasons.
 * `existingKeys` are duplicate keys of leads already in the CRM.
 */
export function analyzeImport(rows: RawRow[], headers: string[], defaultCountryCode: string, existingKeys: Set<string>) {
  const { mapping, unknown, missingRequired } = mapHeaders(headers);
  const schema = leadSchema(defaultCountryCode);
  const results: RowResult[] = [];
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNumber = i + 2; // +1 for header, +1 for 1-based numbering (matches spreadsheet row numbers)
    const { input, errors } = rowToFormInput(raw, mapping);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const fe = fieldErrorsFrom(parsed.error);
      errors.push(...Object.entries(fe).map(([k, msg]) => `${k === "first_follow_up_at" ? "next_follow_up" : k}: ${msg}`));
    }
    if (!parsed.success || errors.length) {
      results.push({ row: rowNumber, status: "invalid", errors });
      return;
    }
    const d = parsed.data;
    if (d.status === "lost" && !d.lost_reason) {
      results.push({ row: rowNumber, status: "invalid", errors: ["lost_reason: required when status is Lost"] });
      return;
    }
    const key = leadDuplicateKey(d.title, d.email, d.phone, d.company_name);
    if (existingKeys.has(key)) {
      results.push({ row: rowNumber, status: "duplicate", data: d, key, reason: "A lead with this title and contact already exists in the CRM" });
    } else if (seen.has(key)) {
      results.push({ row: rowNumber, status: "duplicate", data: d, key, reason: "Repeats an earlier row in this file" });
    } else {
      seen.add(key);
      results.push({ row: rowNumber, status: "valid", data: d, key });
    }
  });

  return { results, unknownHeaders: unknown, missingRequiredHeader: missingRequired };
}

export function importTemplateCsv(): string {
  const example = [
    "Annual Dealer Meet 2027", "Example Motors Pvt Ltd", "https://example.com", "Asha Mehta", "Marketing Manager",
    "asha@example.com", "+91 98765 43210", "", "Referral", "Corporate Event", "Dealer Meet 2027", "2027-02-15",
    "Mumbai", "JW Marriott", "1500000", "300000", "New", "High", "2026-10-20", "2026-11-05 11:00", "Needs stage + AV for 250 pax", "",
  ];
  return [IMPORT_TEMPLATE_HEADERS.join(","), example.map(escapeCell).join(",")].join("\r\n") + "\r\n";
}
