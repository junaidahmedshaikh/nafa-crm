import {
  LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STATUSES, PAGE_SIZE, SERVICE_CATEGORIES,
  type LeadPriority, type LeadSource, type LeadStatus, type ServiceCategory,
} from "@/lib/constants";
import { istDateStart } from "@/lib/datetime";

export const LEAD_SORTS = ["created", "followup", "priority", "revenue"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export type LeadFilters = {
  q: string;
  status: LeadStatus[];
  source: LeadSource | null;
  service: ServiceCategory | null;
  priority: LeadPriority | null;
  owner: string | null;
  from: string | null;       // created on/after (IST date, YYYY-MM-DD)
  to: string | null;         // created on/before
  closedFrom: string | null; // closed on/after
  sort: LeadSort;
  dir: "asc" | "desc";
  page: number;
  archived: boolean;
};

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => (list.includes(v as T) ? (v as T) : null);
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && istDateStart(v) ? v : null);

export function parseLeadFilters(params: Params): LeadFilters {
  const sort = oneOf(LEAD_SORTS, first(params.sort)) ?? "created";
  const dirParam = first(params.dir);
  const page = Math.max(1, Math.floor(Number(first(params.page))) || 1);
  return {
    q: first(params.q).trim().slice(0, 100),
    status: first(params.status)
      .split(",")
      .map((s) => oneOf(LEAD_STATUSES, s.trim()))
      .filter((s): s is LeadStatus => s !== null),
    source: oneOf(LEAD_SOURCES, first(params.source)),
    service: oneOf(SERVICE_CATEGORIES, first(params.service)),
    priority: oneOf(LEAD_PRIORITIES, first(params.priority)),
    owner: /^[0-9a-f-]{36}$/i.test(first(params.owner)) ? first(params.owner) : null,
    from: date(first(params.from)),
    to: date(first(params.to)),
    closedFrom: date(first(params.closed_from)),
    sort,
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : sort === "created" || sort === "revenue" ? "desc" : "asc",
    page,
    archived: first(params.archived) === "1",
  };
}

/** Serialises filters back to a query string (used for pagination, sorting and export links). */
export function leadFiltersToSearch(f: Partial<LeadFilters>, overrides: Record<string, string | null> = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status?.length) p.set("status", f.status.join(","));
  if (f.source) p.set("source", f.source);
  if (f.service) p.set("service", f.service);
  if (f.priority) p.set("priority", f.priority);
  if (f.owner) p.set("owner", f.owner);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.closedFrom) p.set("closed_from", f.closedFrom);
  if (f.sort && f.sort !== "created") p.set("sort", f.sort);
  if (f.dir) p.set("dir", f.dir);
  if (f.archived) p.set("archived", "1");
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  return p.toString();
}

/** Removes characters that would break out of a PostgREST `or(...)` filter expression. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()*%\\"'`;]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildSearchOr(q: string): string | null {
  const s = sanitizeSearch(q);
  if (!s) return null;
  const parts = [
    `title.ilike.%${s}%`, `company_name.ilike.%${s}%`, `contact_name.ilike.%${s}%`,
    `contact_email.ilike.%${s}%`, `contact_phone.ilike.%${s}%`, `event_name.ilike.%${s}%`,
  ];
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 3) parts.push(`contact_phone_digits.ilike.%${digits}%`);
  return parts.join(",");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

const SORT_COLUMN: Record<LeadSort, string> = {
  created: "created_at", followup: "next_follow_up_at", priority: "priority", revenue: "expected_revenue_inr",
};

/** Applies filters + sorting (not pagination) to a query on the lead_list view. */
export function applyLeadFilters(query: Query, f: LeadFilters): Query {
  query = f.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const or = buildSearchOr(f.q);
  if (or) query = query.or(or);
  if (f.status.length) query = query.in("status", f.status);
  if (f.source) query = query.eq("source", f.source);
  if (f.service) query = query.eq("service_category", f.service);
  if (f.priority) query = query.eq("priority", f.priority);
  if (f.owner) query = query.eq("assigned_to", f.owner);
  if (f.from) query = query.gte("created_at", istDateStart(f.from)!.toISOString());
  if (f.to) {
    const end = new Date(istDateStart(f.to)!.getTime() + 24 * 3600 * 1000);
    query = query.lt("created_at", end.toISOString());
  }
  if (f.closedFrom) query = query.gte("closed_at", istDateStart(f.closedFrom)!.toISOString());
  query = query.order(SORT_COLUMN[f.sort], { ascending: f.dir === "asc", nullsFirst: false });
  if (f.sort !== "created") query = query.order("created_at", { ascending: false });
  return query.order("lead_number", { ascending: false });
}

export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  return [(page - 1) * size, page * size - 1];
}
