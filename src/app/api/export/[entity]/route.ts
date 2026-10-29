import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { toCsv, type CsvColumn } from "@/lib/csv";
import {
  FOLLOW_UP_TYPE_LABELS, LEAD_PRIORITY_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, SERVICE_CATEGORY_LABELS,
} from "@/lib/constants";
import { isoToIstLocal } from "@/lib/datetime";
import { listAllLeads } from "@/lib/data/leads";
import { parseLeadFilters } from "@/lib/lead-filters";
import { formatLeadNumber } from "@/lib/format";
import type { Company, Contact, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const ist = (iso: string | null) => (iso ? isoToIstLocal(iso).replace("T", " ") : "");

// Column headers match the import template where possible so an export can be re-imported.
const leadColumns: CsvColumn<Lead>[] = [
  { header: "lead_id", value: (l) => formatLeadNumber(l.lead_number) },
  { header: "title", value: (l) => l.title },
  { header: "company", value: (l) => l.company_name },
  { header: "website", value: (l) => l.company_website },
  { header: "contact_name", value: (l) => l.contact_name },
  { header: "designation", value: (l) => l.contact_designation },
  { header: "email", value: (l) => l.contact_email },
  { header: "phone", value: (l) => l.contact_phone },
  { header: "whatsapp", value: (l) => l.contact_whatsapp },
  { header: "source", value: (l) => LEAD_SOURCE_LABELS[l.source] },
  { header: "service_category", value: (l) => SERVICE_CATEGORY_LABELS[l.service_category] },
  { header: "event_name", value: (l) => l.event_name },
  { header: "event_date", value: (l) => l.event_date },
  { header: "city", value: (l) => l.city },
  { header: "venue", value: (l) => l.venue },
  { header: "budget_inr", value: (l) => l.budget_inr },
  { header: "expected_revenue_inr", value: (l) => l.expected_revenue_inr },
  { header: "status", value: (l) => LEAD_STATUS_LABELS[l.status] },
  { header: "priority", value: (l) => LEAD_PRIORITY_LABELS[l.priority] },
  { header: "last_contact_date", value: (l) => ist(l.last_contact_at).slice(0, 10) },
  { header: "next_follow_up", value: (l) => ist(l.next_follow_up_at) },
  { header: "assigned_to", value: (l) => l.assigned_name },
  { header: "lost_reason", value: (l) => l.lost_reason },
  { header: "notes", value: (l) => l.notes },
  { header: "archived", value: (l) => (l.archived_at ? "yes" : "no") },
  { header: "created_at", value: (l) => ist(l.created_at) },
  { header: "updated_at", value: (l) => ist(l.updated_at) },
];

const companyColumns: CsvColumn<Company & { contact_count: number; lead_count: number }>[] = [
  { header: "name", value: (c) => c.name },
  { header: "website", value: (c) => c.website },
  { header: "industry", value: (c) => c.industry },
  { header: "city", value: (c) => c.city },
  { header: "address", value: (c) => c.address },
  { header: "notes", value: (c) => c.notes },
  { header: "contacts", value: (c) => c.contact_count },
  { header: "leads", value: (c) => c.lead_count },
  { header: "created_at", value: (c) => ist(c.created_at) },
];

const contactColumns: CsvColumn<Contact & { company_name: string | null }>[] = [
  { header: "full_name", value: (c) => c.full_name },
  { header: "company", value: (c) => c.company_name },
  { header: "designation", value: (c) => c.designation },
  { header: "email", value: (c) => c.email },
  { header: "phone", value: (c) => c.phone },
  { header: "whatsapp", value: (c) => c.whatsapp },
  { header: "communication_notes", value: (c) => c.communication_notes },
  { header: "notes", value: (c) => c.notes },
  { header: "created_at", value: (c) => ist(c.created_at) },
];

const followUpColumns: CsvColumn<Record<string, string | null>>[] = [
  { header: "lead", value: (f) => f.lead_title },
  { header: "company", value: (f) => f.company_name },
  { header: "task", value: (f) => f.title },
  { header: "type", value: (f) => FOLLOW_UP_TYPE_LABELS[f.type as keyof typeof FOLLOW_UP_TYPE_LABELS] },
  { header: "due", value: (f) => ist(f.due_at) },
  { header: "status", value: (f) => f.status },
  { header: "completed_at", value: (f) => ist(f.completed_at) },
  { header: "notes", value: (f) => f.notes },
];

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET(request: Request, { params }: RouteContext<"/api/export/[entity]">) {
  const member = await getMember();
  if ("reason" in member) {
    return NextResponse.json({ error: member.reason === "anonymous" ? "Not signed in" : "Not authorised" }, { status: member.reason === "anonymous" ? 401 : 403 });
  }
  const { supabase } = member.ctx;
  const { entity } = await params;
  const url = new URL(request.url);
  const stamp = new Date().toISOString().slice(0, 10);

  let csv: string;
  try {
    switch (entity) {
      case "leads": {
        const filters = parseLeadFilters(Object.fromEntries(url.searchParams));
        csv = toCsv(await listAllLeads(supabase, filters), leadColumns);
        break;
      }
      case "companies":
        csv = toCsv(await fetchAll((f, t) => supabase.from("company_list").select("*").is("archived_at", null).order("name").range(f, t)), companyColumns);
        break;
      case "contacts":
        csv = toCsv(await fetchAll((f, t) => supabase.from("contact_list").select("*").is("archived_at", null).order("full_name").range(f, t)), contactColumns);
        break;
      case "followups":
        csv = toCsv(await fetchAll((f, t) => supabase.from("follow_up_list").select("*").order("due_at").range(f, t)), followUpColumns);
        break;
      default:
        return NextResponse.json({ error: "Unknown export" }, { status: 404 });
    }
  } catch (e) {
    console.error("[export error]", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nafa-${entity}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
