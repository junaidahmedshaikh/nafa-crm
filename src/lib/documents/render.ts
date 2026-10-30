import { htmlToPdf } from "./pdf";
import { renderInvoiceHtml } from "./templates/invoice";
import { renderProposalHtml } from "./templates/proposal";
import { renderQuotationHtml } from "./templates/quotation";
import type { InvoiceRender, ProposalRender, QuotationRender, RenderOptions } from "./types";

export type AnyRender = QuotationRender | InvoiceRender | ProposalRender;

export function renderHtml(doc: AnyRender, opts: RenderOptions = {}): string {
  switch (doc.kind) {
    case "quotation": return renderQuotationHtml(doc, opts);
    case "invoice": return renderInvoiceHtml(doc, opts);
    case "proposal": return renderProposalHtml(doc, opts);
  }
}

export async function renderPdf(doc: AnyRender) {
  return htmlToPdf(renderHtml(doc));
}

export const DOC_LABEL = { quotation: "Quotation", invoice: "Invoice", proposal: "Proposal" } as const;

/**
 * Sanitizes a client company or contact identifier to create a clean,
 * professional file slug adhering to NAFA document standards:
 * e.g. "CROSS" -> "CROSS"
 *      "Tata Motors" -> "TataMotors"
 *      "Tata Motors Pvt. Ltd." -> "TataMotorsPvtLtd"
 */
export function sanitizeClientCompany(raw?: string | null): string {
  if (!raw) return "";
  const words = raw
    .trim()
    .split(/[\s_\-.,&/\\()]+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  return words.join("").slice(0, 40);
}

/**
 * Generates official NAFA file names matching the reference convention:
 * - Quotations: NAFA-QUO-YY-001-ClientCompany.pdf (revisions: NAFA-QUO-YY-001-V02-ClientCompany.pdf)
 * - Invoices:   NAFA-INV-YY-001-ClientCompany.pdf
 * - Proposals:  NAFA-PROP-YY-001-ClientCompany.pdf
 * - Drafts:     Draft-Quotation-ClientCompany.pdf or Draft-Quotation.pdf
 */
export function pdfFileName(doc: AnyRender): string {
  const client = sanitizeClientCompany(doc.client?.company || doc.client?.client_name);
  if (doc.number) {
    const cleanNumber = doc.number.replace(/[^A-Za-z0-9._-]+/g, "_");
    return client ? `${cleanNumber}-${client}.pdf` : `${cleanNumber}.pdf`;
  }
  const kindLabel = doc.kind.charAt(0).toUpperCase() + doc.kind.slice(1);
  const prefix = `Draft-${kindLabel}`;
  return client ? `${prefix}-${client}.pdf` : `${prefix}.pdf`;
}
