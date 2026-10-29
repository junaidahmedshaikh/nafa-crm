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

/** Safe file name: NAFA-Q-037.pdf, or "Draft-quotation.pdf". */
export function pdfFileName(doc: AnyRender): string {
  const base = doc.number ? doc.number : `Draft-${doc.kind}`;
  return `${base.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;
}
