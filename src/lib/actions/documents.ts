"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorized } from "@/lib/auth";
import { fieldErrorsFrom } from "@/lib/validation/common";
import type { ActionResult } from "@/lib/types";
import {
  invoiceFromInput, invoiceFromRows, proposalFromInput, quotationFromInput, quotationFromRows, type DocSettings,
} from "@/lib/documents/build";
import { calculateDocument, computeMilestones, type CalcConfig } from "@/lib/documents/calc";
import { sendEmailWithPdf, emailConfigured } from "@/lib/documents/email";
import { renderHtml, renderPdf, pdfFileName } from "@/lib/documents/render";
import {
  getDocSettings, getInvoiceFull, getProposalFull, getQuotationFull, loadProposalImages, loadProposalRender, todayIST,
} from "@/lib/documents/repo";
import {
  documentSettingsSchema, invoiceInputSchema, paymentInputSchema, productInputSchema, proposalInputSchema, quotationInputSchema,
  sendEmailSchema, type DocumentSettingsValues, type InvoiceFormValues, type InvoiceInput, type ProposalFormValues, type QuotationFormValues,
  type QuotationInput,
} from "@/lib/documents/schemas";
import { fail, friendlyDbError, isUuid, refresh } from "./util";

type DocType = "quotation" | "invoice" | "proposal";
const BASE: Record<DocType, string> = { quotation: "/quotations", invoice: "/invoices", proposal: "/proposals" };

const DB_MESSAGES: Record<string, string> = {
  NOT_EDITABLE: "Only draft documents can be edited. Issued documents are locked — create a revision or a corrected draft instead.",
  DOCUMENT_LOCKED: "This document has been issued and can no longer be edited.",
  ALREADY_ISSUED: "This document has already been issued.",
  STALE: "This draft was changed elsewhere while you were issuing it. Reload the page and try again.",
  PAYMENT_EXCEEDS_BALANCE: "That payment is more than the balance due on this invoice.",
  INVOICE_NOT_PAYABLE: "Payments can only be recorded on issued invoices.",
  HAS_PAYMENTS: "This invoice has recorded payments. Void them first if the invoice really must be cancelled.",
  INVALID_TRANSITION: "That status change is not allowed from the document's current status.",
  QUOTATION_NOT_ACCEPTED: "Only an accepted quotation can be converted into an invoice.",
  NOT_AUTHORISED: "You do not have permission to do that.",
  NOT_FOUND: "This document no longer exists.",
};
function dbMessage(error: { code?: string; message: string }): string {
  const code = /^[A-Z_]+/.exec(error.message)?.[0];
  return (code && DB_MESSAGES[code]) || friendlyDbError(error);
}

// ---------------------------------------------------------------------------
// Payload builders (server-side calculation: the client's totals are never trusted)
// ---------------------------------------------------------------------------
const itemRows = (items: QuotationInput["items"], calc: ReturnType<typeof calculateDocument>) =>
  items.map((i, n) => ({
    catalogue_id: i.catalogue_id, description: i.description, notes: i.notes, hsn_sac: i.hsn_sac, qty: i.qty, rate: i.rate,
    discount_type: i.discount?.type ?? null, discount_value: i.discount?.value ?? null, amount: calc.lines[n].amount,
  }));

const totals = (c: ReturnType<typeof calculateDocument>) => ({
  subtotal: c.subtotal, discount_total: c.discount, agency_fee: c.agency_fee, taxable_value: c.taxable_value, cgst: c.cgst, sgst: c.sgst, igst: c.igst,
  other_charges: c.other_charges, round_off: c.round_off, grand_total: c.grand_total,
});

function quotationPayload(i: QuotationInput, id?: string, revisionOf?: string | null) {
  const calc = calculateDocument(i.items.map((x) => ({ qty: x.qty, rate: x.rate, discount: x.discount })), i.config as CalcConfig);
  const ms = computeMilestones(calc.grand_total, i.milestones.map((m) => ({ kind: m.kind, value: m.value })));
  return {
    id, revision_of: revisionOf ?? null,
    lead_id: i.lead_id, company_id: i.company_id, contact_id: i.contact_id,
    client_name: i.client_name, client_company: i.client_company, client_address: i.client_address, client_email: i.client_email, client_phone: i.client_phone, client_gstin: i.client_gstin,
    event_type: i.event_type, event_name: i.event_name, event_date_text: i.event_date_text, event_location: i.event_location, reference_text: i.reference_text,
    quotation_date: i.quotation_date, valid_until: i.valid_until, config: i.config, ...totals(calc), terms: i.terms.filter((t) => t.trim()), notes: i.notes ?? "",
    items: itemRows(i.items, calc),
    milestones: i.milestones.map((m, n) => ({ label: m.label, kind: m.kind, value: m.value, due_text: m.due_text, due_date: m.due_date, amount: ms.amounts[n], status: m.status })),
  };
}

function invoicePayload(i: InvoiceInput, id?: string) {
  const calc = calculateDocument(i.items.map((x) => ({ qty: x.qty, rate: x.rate, discount: x.discount })), i.config as CalcConfig);
  return {
    id, quotation_id: i.quotation_id, quotation_number: i.quotation_number, lead_id: i.lead_id, company_id: i.company_id, contact_id: i.contact_id,
    client_name: i.client_name, client_company: i.client_company, client_address: i.client_address, client_email: i.client_email, client_phone: i.client_phone, client_gstin: i.client_gstin,
    project_name: i.project_name, project_location: i.project_location, project_date_text: i.project_date_text, place_of_supply: i.place_of_supply,
    invoice_date: i.invoice_date, due_date: i.due_date, config: i.config, ...totals(calc), payment_terms_text: i.payment_terms_text, notes_text: i.notes_text,
    items: itemRows(i.items, calc),
  };
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------
export async function saveQuotation(values: QuotationFormValues, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    const parsed = quotationInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Quotation not found.");
    const ms = computeMilestones(
      calculateDocument(parsed.data.items.map((x) => ({ qty: x.qty, rate: x.rate, discount: x.discount })), parsed.data.config as CalcConfig).grand_total,
      parsed.data.milestones.map((m) => ({ kind: m.kind, value: m.value })),
    );
    if (parsed.data.milestones.length && !ms.reconciled && parsed.data.milestones.every((m) => m.kind === "percent") && ms.percent_total > 100) {
      return fail("Payment milestones add up to more than 100%.", { milestones: "Milestones exceed 100%" });
    }
    const { data, error } = await supabase.rpc("save_quotation", { p: quotationPayload(parsed.data, id) });
    if (error) return fail(dbMessage(error));
    refresh(["/quotations", `/quotations/${data}`]);
    return { ok: true, data: { id: data as string } };
  });
}

async function quotationDraftCopy(supabase: SupabaseClient, sourceId: string, revision: boolean): Promise<ActionResult<{ id: string }>> {
  const full = await getQuotationFull(supabase, sourceId);
  if (!full) return fail("Quotation not found.");
  const s = await getDocSettings();
  const q = full.row as Row;
  const today = todayIST();
  const payload = {
    revision_of: revision ? sourceId : null,
    lead_id: q.lead_id, company_id: q.company_id, contact_id: q.contact_id,
    client_name: q.client_name, client_company: q.client_company, client_address: q.client_address, client_email: q.client_email, client_phone: q.client_phone, client_gstin: q.client_gstin,
    event_type: q.event_type, event_name: q.event_name, event_date_text: q.event_date_text, event_location: q.event_location, reference_text: q.reference_text,
    quotation_date: today, valid_until: addDays(today, s.default_quotation_validity_days), config: q.config,
    subtotal: q.subtotal, discount_total: q.discount_total, agency_fee: q.agency_fee, taxable_value: q.taxable_value, cgst: q.cgst, sgst: q.sgst, igst: q.igst,
    other_charges: q.other_charges, round_off: q.round_off, grand_total: q.grand_total, terms: q.terms, notes: q.notes,
    items: full.items, milestones: full.milestones.map((m) => ({ ...m, status: "pending" })),
  };
  const { data, error } = await supabase.rpc("save_quotation", { p: payload });
  if (error) return fail(dbMessage(error));
  refresh(["/quotations"]);
  return { ok: true, data: { id: data as string } };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function duplicateQuotation(id: string) {
  return authorized<{ id: string }>(async ({ supabase }) => (isUuid(id) ? quotationDraftCopy(supabase, id, false) : fail("Quotation not found.")));
}
export async function reviseQuotation(id: string) {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Quotation not found.");
    const { data } = await supabase.from("quotations").select("status").eq("id", id).maybeSingle();
    if (!data) return fail("Quotation not found.");
    if (data.status === "draft") return fail("This quotation is still a draft — just edit it.");
    return quotationDraftCopy(supabase, id, true);
  });
}

export async function issueQuotation(id: string): Promise<ActionResult<{ number: string }>> {
  return authorized<{ number: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Quotation not found.");
    const full = await getQuotationFull(supabase, id);
    if (!full) return fail("Quotation not found.");
    const settings = await getDocSettings();
    const render = quotationFromRows(full.row, full.items, full.milestones, settings);
    const problems: string[] = [];
    if (full.row.status !== "draft") problems.push("This quotation has already been issued.");
    if (!render.client.company && !render.client.client_name) problems.push("Add the client's name or company.");
    if (!full.items.length) problems.push("Add at least one line item.");
    if (render.calc.grand_total <= 0) problems.push("The grand total must be greater than zero.");
    if (render.milestones.length) {
      const m = computeMilestones(render.calc.grand_total, full.milestones.map((x) => ({ kind: x.kind, value: x.value })));
      if (!m.reconciled) problems.push(`Payment milestones must add up to the grand total (difference ₹${m.difference.toFixed(2)}).`);
    }
    if (problems.length) return fail(problems.join(" "));

    const { data, error } = await supabase.rpc("issue_document", {
      p_type: "quotation", p_id: id, p_snapshot: { ...render, number: null }, p_expected_updated_at: full.row.updated_at,
    });
    if (error) return fail(dbMessage(error));
    // A revision supersedes the quotation it was made from.
    const revisionOf = full.row.revision_of;
    if (revisionOf) await supabase.from("quotations").update({ status: "revised" }).eq("id", revisionOf).in("status", ["sent", "accepted", "expired"]);
    refresh(["/quotations", `/quotations/${id}`]);
    return { ok: true, data: { number: data as string } };
  });
}

export async function setQuotationStatus(id: string, status: "accepted" | "rejected" | "expired"): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Quotation not found.");
    const { data, error } = await supabase.from("quotations").update({ status }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("Quotation not found.");
    refresh(["/quotations", `/quotations/${id}`]);
    return { ok: true };
  });
}

export async function setMilestonePaid(quotationId: string, position: number, paid: boolean): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(quotationId)) return fail("Quotation not found.");
    const { error } = await supabase.from("quotation_milestones").update({ status: paid ? "paid" : "pending" }).eq("quotation_id", quotationId).eq("position", position);
    if (error) return fail(dbMessage(error));
    refresh([`/quotations/${quotationId}`]);
    return { ok: true };
  });
}

export async function deleteDraft(type: DocType, id: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Document not found.");
    const table = { quotation: "quotations", invoice: "invoices", proposal: "proposals" }[type];
    const col = type === "invoice" ? "state" : "status";
    const { data, error } = await supabase.from(table).delete().eq("id", id).eq(col, "draft").select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("Only draft documents can be deleted. Issued documents are kept for the audit trail.");
    refresh([BASE[type]]);
    return { ok: true };
  });
}

export async function convertQuotationToInvoice(id: string, confirmAdditional = false): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Quotation not found.");
    const { data, error } = await supabase.rpc("convert_quotation_to_invoice", { p_quotation_id: id, p_confirm_additional: confirmAdditional });
    if (error) {
      if (error.message.startsWith("ALREADY_CONVERTED")) return fail(error.message.replace(/^ALREADY_CONVERTED:\s*/, ""), undefined, "already_converted");
      return fail(dbMessage(error));
    }
    refresh(["/quotations", `/quotations/${id}`, "/invoices"]);
    return { ok: true, data: { id: data as string } };
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export async function saveInvoice(values: InvoiceFormValues, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    const parsed = invoiceInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Invoice not found.");
    const { data, error } = await supabase.rpc("save_invoice", { p: invoicePayload(parsed.data, id) });
    if (error) return fail(dbMessage(error));
    refresh(["/invoices", `/invoices/${data}`]);
    return { ok: true, data: { id: data as string } };
  });
}

export async function duplicateInvoice(id: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Invoice not found.");
    const full = await getInvoiceFull(supabase, id);
    if (!full) return fail("Invoice not found.");
    const s = await getDocSettings();
    const i = full.row as Row;
    const today = todayIST();
    const { data, error } = await supabase.rpc("save_invoice", {
      p: {
        quotation_id: i.quotation_id, quotation_number: i.quotation_number, lead_id: i.lead_id, company_id: i.company_id, contact_id: i.contact_id,
        client_name: i.client_name, client_company: i.client_company, client_address: i.client_address, client_email: i.client_email, client_phone: i.client_phone, client_gstin: i.client_gstin,
        project_name: i.project_name, project_location: i.project_location, project_date_text: i.project_date_text, place_of_supply: i.place_of_supply,
        invoice_date: today, due_date: addDays(today, s.default_invoice_due_days), config: i.config,
        subtotal: i.subtotal, discount_total: i.discount_total, agency_fee: i.agency_fee, taxable_value: i.taxable_value, cgst: i.cgst, sgst: i.sgst, igst: i.igst,
        other_charges: i.other_charges, round_off: i.round_off, grand_total: i.grand_total, payment_terms_text: i.payment_terms_text, notes_text: i.notes_text,
        items: full.items,
      },
    });
    if (error) return fail(dbMessage(error));
    refresh(["/invoices"]);
    return { ok: true, data: { id: data as string } };
  });
}

export async function issueInvoice(id: string): Promise<ActionResult<{ number: string }>> {
  return authorized<{ number: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Invoice not found.");
    const full = await getInvoiceFull(supabase, id);
    if (!full) return fail("Invoice not found.");
    const settings = await getDocSettings();
    const render = invoiceFromRows(full.row, full.items, 0, todayIST(), settings);
    const problems: string[] = [];
    if (full.row.state !== "draft") problems.push("This invoice has already been issued.");
    if (!render.client.company && !render.client.client_name) problems.push("Add the client's name or company.");
    if (!full.items.length) problems.push("Add at least one line item.");
    if (render.calc.grand_total <= 0) problems.push("The grand total must be greater than zero.");
    if (!render.due_date) problems.push("Set a due date.");
    if (!settings.bank_account_number.trim() && !settings.bank_upi_id.trim()) problems.push("Add your bank / UPI details in Settings → Documents before issuing invoices.");
    if (problems.length) return fail(problems.join(" "));

    const { data, error } = await supabase.rpc("issue_document", {
      p_type: "invoice", p_id: id, p_snapshot: { ...render, number: null, amount_received: 0, balance_due: render.calc.grand_total, payment_status: "issued" },
      p_expected_updated_at: full.row.updated_at,
    });
    if (error) return fail(dbMessage(error));
    refresh(["/invoices", `/invoices/${id}`, "/payments"]);
    return { ok: true, data: { number: data as string } };
  });
}

export async function cancelInvoice(id: string, reason: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Invoice not found.");
    if (reason.trim().length < 3) return fail("Give a reason for cancelling this invoice.", { reason: "A reason is required" });
    const { data, error } = await supabase.from("invoices").update({ state: "cancelled", cancel_reason: reason.trim() }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("Invoice not found.");
    refresh(["/invoices", `/invoices/${id}`, "/payments"]);
    return { ok: true };
  });
}

export async function recordPayment(invoiceId: string, values: { paid_on: string; amount: string; method: string; reference?: string; notes?: string }): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(invoiceId)) return fail("Invoice not found.");
    const parsed = paymentInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const { error } = await supabase.from("invoice_payments").insert({ invoice_id: invoiceId, ...parsed.data });
    if (error) return fail(dbMessage(error));
    refresh(["/invoices", `/invoices/${invoiceId}`, "/payments"]);
    return { ok: true };
  });
}

export async function voidPayment(paymentId: string, reason: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(paymentId)) return fail("Payment not found.");
    if (reason.trim().length < 3) return fail("Give a reason for voiding this payment.", { reason: "A reason is required" });
    const { data, error } = await supabase
      .from("invoice_payments").update({ voided_at: new Date().toISOString(), voided_reason: reason.trim() }).eq("id", paymentId).is("voided_at", null).select("invoice_id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("This payment was not found or is already void.");
    refresh(["/invoices", `/invoices/${data.invoice_id}`, "/payments"]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------
export async function saveProposal(values: ProposalFormValues, id?: string): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    const parsed = proposalInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    if (id && !isUuid(id)) return fail("Proposal not found.");
    const p = parsed.data;
    if (p.commercial_mode === "linked" && !p.quotation_id) return fail("Choose the quotation to link.", { quotation_id: "Choose a quotation" });
    const attachmentSections: { attachment_id: string; section_id: string }[] = [];
    if (id) {
      const { data: atts } = await supabase.from("proposal_attachments").select("id, section_id").eq("proposal_id", id);
      const keep = new Set(p.sections.map((s) => s.id).filter(Boolean));
      for (const a of atts ?? []) if (a.section_id && keep.has(a.section_id)) attachmentSections.push({ attachment_id: a.id, section_id: a.section_id });
    }
    const { data, error } = await supabase.rpc("save_proposal", {
      p: {
        id, lead_id: p.lead_id, company_id: p.company_id, contact_id: p.contact_id, quotation_id: p.commercial_mode === "linked" ? p.quotation_id : null,
        title: p.title, client_name: p.client_name, client_company: p.client_company, client_address: p.client_address, client_email: p.client_email, client_phone: p.client_phone, client_gstin: p.client_gstin,
        proposal_date: p.proposal_date, commercial_mode: p.commercial_mode, commercial_note: p.commercial_note ?? "",
        sections: p.sections.map((s) => ({ id: s.id, type: s.type, title: s.title, body: s.body, included: s.included })),
        attachment_sections: attachmentSections,
      },
    });
    if (error) return fail(dbMessage(error));
    refresh(["/proposals", `/proposals/${data}`]);
    return { ok: true, data: { id: data as string } };
  });
}

export async function duplicateProposal(id: string, revision = false): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Proposal not found.");
    const full = await getProposalFull(supabase, id);
    if (!full) return fail("Proposal not found.");
    if (revision && full.row.status === "draft") return fail("This proposal is still a draft — just edit it.");
    const r = full.row as Row;
    const { data, error } = await supabase.rpc("save_proposal", {
      p: {
        revision_of: revision ? id : null, lead_id: r.lead_id, company_id: r.company_id, contact_id: r.contact_id, quotation_id: r.quotation_id, title: r.title,
        client_name: r.client_name, client_company: r.client_company, client_address: r.client_address, client_email: r.client_email, client_phone: r.client_phone, client_gstin: r.client_gstin,
        proposal_date: todayIST(), commercial_mode: r.commercial_mode, commercial_note: r.commercial_note,
        sections: full.sections.map((s) => ({ type: s.type, title: s.title, body: s.body, included: s.included })),
      },
    });
    if (error) return fail(dbMessage(error));
    // copy images (new sections get new ids, so re-link by position)
    const newId = data as string;
    const { data: newSections } = await supabase.from("proposal_sections").select("id, position").eq("proposal_id", newId);
    const { data: oldAtts } = await supabase.from("proposal_attachments").select("*").eq("proposal_id", id);
    const byPos = new Map((newSections ?? []).map((s) => [s.position, s.id]));
    const oldPos = new Map(full.sections.map((s) => [s.id, s.position]));
    for (const a of oldAtts ?? []) {
      const pos = a.section_id ? oldPos.get(a.section_id) : undefined;
      await supabase.from("proposal_attachments").insert({
        proposal_id: newId, section_id: pos !== undefined ? byPos.get(pos) ?? null : null, position: a.position, filename: a.filename, content_type: a.content_type,
        size_bytes: a.size_bytes, data_uri: a.data_uri, caption: a.caption,
      });
    }
    refresh(["/proposals"]);
    return { ok: true, data: { id: newId } };
  });
}

export async function issueProposal(id: string): Promise<ActionResult<{ number: string }>> {
  return authorized<{ number: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Proposal not found.");
    const full = await getProposalFull(supabase, id);
    if (!full) return fail("Proposal not found.");
    const render = await loadProposalRender(supabase, id);
    if (!render) return fail("Proposal not found.");
    const problems: string[] = [];
    if (full.row.status !== "draft") problems.push("This proposal has already been issued.");
    if (!render.title.trim()) problems.push("Add a proposal title.");
    if (!render.client.company && !render.client.client_name) problems.push("Add the client's name or company.");
    if (!render.sections.some((s) => s.body.trim() || s.images.length || ["commercial", "acceptance", "prepared_for"].includes(s.type))) problems.push("Add content to at least one section.");
    if (full.row.commercial_mode === "linked" && !render.commercial) problems.push("The linked quotation could not be loaded.");
    if (problems.length) return fail(problems.join(" "));
    const { data, error } = await supabase.rpc("issue_document", { p_type: "proposal", p_id: id, p_snapshot: { ...render, number: null }, p_expected_updated_at: full.row.updated_at });
    if (error) return fail(dbMessage(error));
    const revisionOf = full.row.revision_of;
    if (revisionOf) await supabase.from("proposals").update({ status: "revised" }).eq("id", revisionOf).in("status", ["sent", "accepted"]);
    refresh(["/proposals", `/proposals/${id}`]);
    return { ok: true, data: { number: data as string } };
  });
}

export async function setProposalStatus(id: string, status: "accepted" | "rejected"): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Proposal not found.");
    const { data, error } = await supabase.from("proposals").update({ status }).eq("id", id).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("Proposal not found.");
    refresh(["/proposals", `/proposals/${id}`]);
    return { ok: true };
  });
}

const MAGIC: Record<string, number[][]> = {
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

export async function uploadProposalImage(proposalId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return authorized<{ id: string }>(async ({ supabase }) => {
    if (!isUuid(proposalId)) return fail("Proposal not found.");
    const file = formData.get("file");
    const sectionId = String(formData.get("section_id") ?? "");
    const caption = String(formData.get("caption") ?? "").trim().slice(0, 200);
    if (!(file instanceof File) || file.size === 0) return fail("Choose an image to upload.");
    if (file.size > 2 * 1024 * 1024) return fail("Images must be 2 MB or smaller.");
    if (!isUuid(sectionId)) return fail("Save the proposal first, then add images to a saved section.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = file.type;
    const sig = MAGIC[type];
    if (!sig || !sig.some((m) => m.every((b, i) => bytes[i] === b))) return fail("Only genuine PNG, JPEG or WebP images are allowed.");
    const { count } = await supabase.from("proposal_attachments").select("id", { count: "exact", head: true }).eq("proposal_id", proposalId);
    if ((count ?? 0) >= 30) return fail("A proposal can hold at most 30 images.");
    const { data, error } = await supabase.from("proposal_attachments").insert({
      proposal_id: proposalId, section_id: sectionId, position: count ?? 0, filename: file.name.slice(0, 120), content_type: type, size_bytes: file.size,
      data_uri: `data:${type};base64,${bytes.toString("base64")}`, caption,
    }).select("id").single();
    if (error) return fail(dbMessage(error));
    refresh([`/proposals/${proposalId}`, `/proposals/${proposalId}/edit`]);
    return { ok: true, data: { id: data.id } };
  });
}

export async function deleteProposalImage(attachmentId: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    if (!isUuid(attachmentId)) return fail("Image not found.");
    const { data, error } = await supabase.from("proposal_attachments").delete().eq("id", attachmentId).select("proposal_id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("Image not found.");
    refresh([`/proposals/${data[0].proposal_id}/edit`]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Catalogue and settings
// ---------------------------------------------------------------------------
export async function saveProduct(values: Parameters<typeof productInputSchema.parse>[0], id?: string): Promise<ActionResult> {
  return authorized(async ({ supabase }) => {
    const parsed = productInputSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const q = id && isUuid(id) ? supabase.from("products_services").update(parsed.data).eq("id", id) : supabase.from("products_services").insert(parsed.data);
    const { error } = await q;
    if (error) return fail(dbMessage(error));
    refresh(["/products-services"]);
    return { ok: true };
  });
}

export async function saveDocumentSettings(values: DocumentSettingsValues): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change document settings.");
    const parsed = documentSettingsSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));
    const d = parsed.data;
    const { data, error } = await supabase.from("document_settings").update({
      ...d, company_email: d.company_email ?? "", company_phone: d.company_phone ?? "", company_website: d.company_website ?? "", company_location: d.company_location ?? "",
      bank_account_holder: d.bank_account_holder ?? "", bank_name: d.bank_name ?? "", bank_account_number: d.bank_account_number ?? "", bank_ifsc: d.bank_ifsc ?? "", bank_upi_id: d.bank_upi_id ?? "",
      invoice_payment_terms: d.invoice_payment_terms ?? "", invoice_notes: d.invoice_notes ?? "", gst_declaration: d.gst_declaration ?? "",
      quotation_terms: d.quotation_terms.filter((t) => t.trim()),
      quotation_milestones: d.quotation_milestones.map((m) => ({ ...m, due_text: m.due_text ?? "" })),
    }).eq("id", true).select("id").maybeSingle();
    if (error) return fail(dbMessage(error));
    if (!data) return fail("Settings could not be saved (no permission).");
    refresh(["/settings/documents", "/quotations/new", "/invoices/new"]);
    return { ok: true };
  });
}

export async function saveSequence(docType: DocType, input: { prefix: string; padding: string; next_number: string }): Promise<ActionResult> {
  return authorized(async ({ supabase, profile }) => {
    if (profile.role !== "admin") return fail("Only an administrator can change numbering.");
    const prefix = input.prefix.trim();
    const padding = Number(input.padding);
    const next = Number(input.next_number);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,18}[-_]?$/.test(prefix)) return fail("Prefix may contain letters, numbers, - and _ (max 20 characters).", { prefix: "Invalid prefix" });
    if (!Number.isInteger(padding) || padding < 1 || padding > 8) return fail("Digits must be between 1 and 8.", { padding: "1–8" });
    if (!Number.isInteger(next) || next < 1) return fail("Next number must be a positive whole number.", { next_number: "Invalid" });
    const { data, error } = await supabase.from("document_sequences").update({ prefix, padding, next_number: next }).eq("doc_type", docType).select("doc_type").maybeSingle();
    if (error) return fail(error.message.includes("SEQUENCE_CANNOT_DECREASE") ? "The next number can only go up — numbers are never reused." : dbMessage(error), { next_number: "Cannot go down" });
    if (!data) return fail("Numbering could not be saved (no permission).");
    refresh(["/settings/documents"]);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Preview (of unsaved form state) and email
// ---------------------------------------------------------------------------
export async function previewDocument(
  kind: DocType,
  values: QuotationFormValues | InvoiceFormValues | ProposalFormValues,
  context: { number?: string | null; linkedQuotationId?: string | null; proposalId?: string | null } = {},
): Promise<ActionResult<{ html: string }>> {
  return authorized<{ html: string }>(async ({ supabase }) => {
    const settings: DocSettings = await getDocSettings();
    const today = todayIST();
    if (kind === "quotation") {
      const p = quotationInputSchema.safeParse(values);
      if (!p.success) return fail(`Complete the form to preview — ${p.error.issues[0].message}`);
      return { ok: true, data: { html: renderHtml(quotationFromInput(p.data, { number: context.number ?? null, status: "draft" }, settings)) } };
    }
    if (kind === "invoice") {
      const p = invoiceInputSchema.safeParse(values);
      if (!p.success) return fail(`Complete the form to preview — ${p.error.issues[0].message}`);
      return { ok: true, data: { html: renderHtml(invoiceFromInput(p.data, { number: context.number ?? null, state: "draft" }, 0, today, settings)) } };
    }
    const p = proposalInputSchema.safeParse(values);
    if (!p.success) return fail(`Complete the form to preview — ${p.error.issues[0].message}`);
    let linked = null;
    if (p.data.commercial_mode === "linked" && p.data.quotation_id) {
      const { loadQuotationRender } = await import("@/lib/documents/repo");
      linked = await loadQuotationRender(supabase, p.data.quotation_id);
    }
    const images: Record<string, { data_uri: string; caption: string }[]> = {};
    if (context.proposalId && isUuid(context.proposalId)) for (const [k, v] of await loadProposalImages(supabase, context.proposalId)) images[k] = v;
    return { ok: true, data: { html: renderHtml(proposalFromInput(p.data, { number: context.number ?? null, status: "draft" }, linked, images, settings)) } };
  });
}

export async function sendDocumentEmail(type: DocType, id: string, values: { to: string; subject: string; message: string }): Promise<ActionResult<{ providerId: string }>> {
  return authorized<{ providerId: string }>(async ({ supabase }) => {
    if (!isUuid(id)) return fail("Document not found.");
    if (!emailConfigured()) return fail("Email sending is not configured on this server (RESEND_API_KEY / EMAIL_FROM).");
    const parsed = sendEmailSchema.safeParse(values);
    if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrorsFrom(parsed.error));

    let render;
    if (type === "quotation") { const f = await getQuotationFull(supabase, id); render = f && quotationFromRows(f.row, f.items, f.milestones, await getDocSettings()); }
    else if (type === "invoice") { const f = await getInvoiceFull(supabase, id); render = f && invoiceFromRows(f.row, f.items, f.received, todayIST(), await getDocSettings()); }
    else render = await loadProposalRender(supabase, id);
    if (!render) return fail("Document not found.");
    if (!render.number) return fail("Issue the document (give it a number) before emailing it.");

    const { pdf } = await renderPdf(render);
    const result = await sendEmailWithPdf({ to: parsed.data.to, subject: parsed.data.subject, text: parsed.data.message, filename: pdfFileName(render), pdf });
    await supabase.from("document_emails").insert({
      doc_type: type, doc_id: id, to_email: parsed.data.to, subject: parsed.data.subject, body: parsed.data.message,
      status: result.ok ? "sent" : "failed", provider_id: result.ok ? result.providerId : null, error: result.ok ? null : result.error,
    });
    if (!result.ok) return fail(`The email was NOT sent: ${result.error}`);
    await supabase.rpc("log_document_activity", { p_type: type, p_id: id, p_action: "emailed", p_summary: `Emailed to ${parsed.data.to}`, p_meta: { provider_id: result.providerId } });
    refresh([`${BASE[type]}/${id}`]);
    return { ok: true, data: { providerId: result.providerId } };
  });
}
