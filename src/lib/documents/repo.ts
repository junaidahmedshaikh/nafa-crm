import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import { createClient } from "@/lib/supabase/server";
import {
  assembleProposal, invoiceFromRows, quotationFromRows, settingsToCompany, type DocSettings, type InvoiceRow, type MilestoneDbRow, type ProposalRow, type QuotationRow,
} from "./build";
import type { InvoiceRender, ProposalRender, ProposalSectionRender, QuotationRender } from "./types";

/** Today's calendar date in IST (YYYY-MM-DD). */
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export const getDocSettings = cache(async (): Promise<DocSettings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_settings").select("*").maybeSingle();
  if (error || !data) throw new Error("Document settings could not be loaded. Have the Phase 2 migrations been applied?");
  return data as DocSettings;
});

export async function getNextDocumentNumber(supabase: SupabaseClient, docType: "quotation" | "invoice" | "proposal"): Promise<string> {
  const { data } = await supabase
    .from("document_sequences")
    .select("prefix, padding, next_number")
    .eq("doc_type", docType)
    .maybeSingle();
  const yy = new Date().getFullYear().toString().slice(-2);
  if (!data) return docType === "quotation" ? `NAFA-QUO-${yy}-001` : docType === "invoice" ? `NAFA-INV-${yy}-001` : `NAFA-PROP-${yy}-001`;
  const prefix = data.prefix.replace("{YY}", yy);
  return `${prefix}${String(data.next_number).padStart(data.padding, "0")}`;
}

export async function getProspectiveQuotationNumber(supabase: SupabaseClient, revisionOfId?: string | null): Promise<string> {
  if (revisionOfId) {
    const { data } = await supabase.from("quotations").select("number").eq("id", revisionOfId).maybeSingle();
    if (data?.number) {
      const base = data.number.replace(/-V\d+$/, "");
      const { data: revs } = await supabase.from("quotations").select("number").like("number", `${base}%`);
      let maxV = 1;
      for (const r of (revs ?? []) as { number: string | null }[]) {
        const match = r.number?.match(/-V(\d+)$/);
        if (match) maxV = Math.max(maxV, parseInt(match[1], 10));
      }
      return `${base}-V${String(maxV + 1).padStart(2, "0")}`;
    }
  }
  return getNextDocumentNumber(supabase, "quotation");
}

const oneOf = <T extends string>(list: readonly T[], v: string): T | "" => (list.includes(v as T) ? (v as T) : "");

export type ListParams = { q: string; status: string; page: number };
export function parseListParams(sp: Record<string, string | string[] | undefined>, statuses: readonly string[]): ListParams {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return {
    q: first(sp.q).trim().slice(0, 100),
    status: oneOf(statuses, first(sp.status)),
    page: Math.max(1, Math.floor(Number(first(sp.page))) || 1),
  };
}

function searchOr(q: string, cols: string[]): string | null {
  const s = sanitizeSearch(q);
  return s ? cols.map((c) => `${c}.ilike.%${s}%`).join(",") : null;
}

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "revised"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"] as const;
export const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "rejected", "revised"] as const;

async function list<T>(supabase: SupabaseClient, view: string, p: ListParams, cols: string[], statusCol: string, order = "created_at") {
  const [from, to] = pageRange(p.page);
  let query = supabase.from(view).select("*", { count: "exact" });
  const or = searchOr(p.q, cols);
  if (or) query = query.or(or);
  if (p.status) query = query.eq(statusCol, p.status);
  const { data, count, error } = await query.order(order, { ascending: false }).range(from, to);
  if (error) throw new Error(`Could not load ${view}: ${error.message}`);
  return { rows: (data ?? []) as T[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export type QuotationListRow = {
  id: string; number: string | null; status: string; effective_status: string; client_company: string; client_name: string; event_name: string;
  quotation_date: string; valid_until: string | null; grand_total: number; invoice_count: number; lead_id: string | null;
};
export const listQuotations = (s: SupabaseClient, p: ListParams) =>
  list<QuotationListRow>(s, "quotation_list", p, ["number", "client_company", "client_name", "event_name"], "effective_status");

export type InvoiceListRow = {
  id: string; number: string | null; state: string; payment_status: string; client_company: string; client_name: string; project_name: string;
  invoice_date: string; due_date: string | null; grand_total: number; amount_received: number; balance_due: number; quotation_number: string;
};
export const listInvoices = (s: SupabaseClient, p: ListParams) =>
  list<InvoiceListRow>(s, "invoice_list", p, ["number", "client_company", "client_name", "project_name", "quotation_number"], "payment_status");

export type ProposalListRow = { id: string; number: string | null; status: string; title: string; client_company: string; client_name: string; proposal_date: string };
export const listProposals = (s: SupabaseClient, p: ListParams) =>
  list<ProposalListRow>(s, "proposal_list", p, ["number", "title", "client_company", "client_name"], "status");

export type PaymentListRow = {
  id: string; invoice_id: string; paid_on: string; amount: number; method: string; reference: string | null; notes: string | null; voided_at: string | null;
  voided_reason: string | null; invoice_number: string; client_company: string; client_name: string; project_name: string;
};
export async function listPayments(supabase: SupabaseClient, p: { q: string; method: string; page: number; includeVoided: boolean }) {
  const [from, to] = pageRange(p.page);
  let query = supabase.from("payment_list").select("*", { count: "exact" });
  const or = searchOr(p.q, ["invoice_number", "client_company", "client_name", "reference"]);
  if (or) query = query.or(or);
  if (p.method) query = query.eq("method", p.method);
  if (!p.includeVoided) query = query.is("voided_at", null);
  const { data, count, error } = await query.order("paid_on", { ascending: false }).order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(`Could not load payments: ${error.message}`);
  const { data: totals } = await supabase.from("payment_list").select("amount").is("voided_at", null).limit(5000);
  const sum = (totals ?? []).reduce((a, r) => a + Number(r.amount), 0);
  return { rows: (data ?? []) as PaymentListRow[], total: count ?? 0, pageSize: PAGE_SIZE, receivedTotal: Math.round(sum * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Single documents
// ---------------------------------------------------------------------------
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Item = Parameters<typeof quotationFromRows>[1][number];

export async function getQuotationFull(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: row } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const [{ data: items }, { data: milestones }] = await Promise.all([
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position"),
    supabase.from("quotation_milestones").select("*").eq("quotation_id", id).order("position"),
  ]);
  return { row: row as QuotationRow & Record<string, unknown>, items: (items ?? []) as Item[], milestones: (milestones ?? []) as MilestoneDbRow[] };
}

export async function getInvoiceFull(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: row } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
    supabase.from("invoice_payments").select("*").eq("invoice_id", id).order("paid_on", { ascending: true }).order("created_at", { ascending: true }),
  ]);
  const pays = (payments ?? []) as { id: string; paid_on: string; amount: number; method: string; reference: string | null; notes: string | null; voided_at: string | null; voided_reason: string | null }[];
  const received = Math.round(pays.filter((p) => !p.voided_at).reduce((a, p) => a + Number(p.amount) * 100, 0)) / 100;
  return { row: row as InvoiceRow & Record<string, unknown>, items: (items ?? []) as Item[], payments: pays, received };
}

export async function getProposalFull(supabase: SupabaseClient, id: string) {
  if (!isUuid(id)) return null;
  const { data: row } = await supabase.from("proposals").select("*").eq("id", id).maybeSingle();
  if (!row) return null;
  const [{ data: sections }, { data: attachments }] = await Promise.all([
    supabase.from("proposal_sections").select("*").eq("proposal_id", id).order("position"),
    supabase.from("proposal_attachments").select("id, section_id, filename, content_type, size_bytes, caption, position, data_uri").eq("proposal_id", id).order("position"),
  ]);
  return {
    row: row as ProposalRow & Record<string, unknown>,
    sections: (sections ?? []) as { id: string; type: string; title: string; body: string; included: boolean; position: number }[],
    attachments: (attachments ?? []) as { id: string; section_id: string | null; filename: string; content_type: string; size_bytes: number; caption: string; position: number; data_uri?: string }[],
  };
}

// ---------------------------------------------------------------------------
// Render loaders (what the preview, PDF and email all use)
// ---------------------------------------------------------------------------
export async function loadQuotationRender(supabase: SupabaseClient, id: string): Promise<QuotationRender | null> {
  const full = await getQuotationFull(supabase, id);
  if (!full) return null;
  return quotationFromRows(full.row, full.items, full.milestones, await getDocSettings());
}

export async function loadInvoiceRender(supabase: SupabaseClient, id: string): Promise<InvoiceRender | null> {
  const full = await getInvoiceFull(supabase, id);
  if (!full) return null;
  return invoiceFromRows(full.row, full.items, full.received, todayIST(), await getDocSettings());
}

export async function loadProposalRender(supabase: SupabaseClient, id: string): Promise<ProposalRender | null> {
  const full = await getProposalFull(supabase, id);
  if (!full) return null;
  const { row } = full;
  if (row.snapshot && row.status !== "draft") return { ...row.snapshot, number: row.number, status: row.status };
  const settings = await getDocSettings();
  const images = await loadProposalImages(supabase, id);
  const sections: ProposalSectionRender[] = full.sections
    .filter((s) => s.included)
    .map((s) => ({ type: s.type, title: s.title, body: s.body, images: images.get(s.id) ?? [] }));
  const linked = row.commercial_mode === "linked" && row.quotation_id ? await loadQuotationRender(supabase, row.quotation_id) : null;
  return assembleProposal(
    { title: row.title, proposal_date: row.proposal_date, client: row, commercial_mode: row.commercial_mode, commercial_note: row.commercial_note },
    { number: row.number, status: row.status }, sections, linked, settings,
  );
}

export async function loadProposalImages(supabase: SupabaseClient, proposalId: string) {
  const { data } = await supabase.from("proposal_attachments").select("section_id, data_uri, caption, position").eq("proposal_id", proposalId).order("position");
  const map = new Map<string, { data_uri: string; caption: string }[]>();
  for (const a of data ?? []) {
    if (!a.section_id) continue;
    map.set(a.section_id, [...(map.get(a.section_id) ?? []), { data_uri: a.data_uri, caption: a.caption }]);
  }
  return map;
}

export async function getActivity(supabase: SupabaseClient, type: "quotation" | "invoice" | "proposal", id: string) {
  const { data } = await supabase
    .from("document_activity").select("id, action, summary, created_at, author:profiles(full_name)").eq("doc_type", type).eq("doc_id", id)
    .order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as unknown as { id: string; action: string; summary: string; created_at: string; author: { full_name: string } | null }[];
}

export async function getEmails(supabase: SupabaseClient, type: "quotation" | "invoice" | "proposal", id: string) {
  const { data } = await supabase
    .from("document_emails").select("id, to_email, subject, status, error, sent_at").eq("doc_type", type).eq("doc_id", id).order("sent_at", { ascending: false }).limit(20);
  return (data ?? []) as { id: string; to_email: string; subject: string; status: string; error: string | null; sent_at: string }[];
}

export async function listProducts(supabase: SupabaseClient, p: { q: string; page: number; activeOnly: boolean }) {
  const [from, to] = pageRange(p.page);
  let query = supabase.from("products_services").select("*", { count: "exact" });
  if (p.activeOnly) query = query.eq("is_active", true);
  const or = searchOr(p.q, ["name", "category", "description", "hsn_sac"]);
  if (or) query = query.or(or);
  const { data, count, error } = await query.order("name").range(from, to);
  if (error) throw new Error(`Could not load products: ${error.message}`);
  return { rows: (data ?? []) as Product[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export type Product = {
  id: string; name: string; category: string | null; description: string | null; unit: string; default_rate: number; hsn_sac: string | null;
  gst_rate: number | null; is_active: boolean;
};

export async function listActiveProducts(supabase: SupabaseClient): Promise<Product[]> {
  const { data } = await supabase.from("products_services").select("*").eq("is_active", true).order("name").limit(500);
  return (data ?? []) as Product[];
}

/** CRM records the document builders can link to. */
export async function listLeadOptions(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("lead_list").select("id, lead_number, title, company_id, contact_id, company_name, contact_name, contact_email, contact_phone, company_website, event_name, event_date, city, venue, status")
    .is("archived_at", null).order("created_at", { ascending: false }).limit(300);
  return (data ?? []) as LeadOption[];
}
export type LeadOption = {
  id: string; lead_number: number; title: string; company_id: string | null; contact_id: string | null; company_name: string | null; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null; company_website: string | null; event_name: string | null; event_date: string | null; city: string | null; venue: string | null; status: string;
};

export { settingsToCompany };
