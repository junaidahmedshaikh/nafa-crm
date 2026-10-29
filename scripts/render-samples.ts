/**
 * Renders sample PDFs with the real templates + PDF engine.
 *   npx tsx scripts/render-samples.ts [outDir]
 * "reference-*" use the placeholder values printed in the supplied templates (for pixel/position comparison);
 * "sample-*" use realistic data. Compare with scripts/compare_pdfs.py.
 */
import fs from "node:fs";
import path from "node:path";
import { closePdfEngine, htmlToPdf } from "../src/lib/documents/pdf";
import { renderInvoiceHtml } from "../src/lib/documents/templates/invoice";
import { renderQuotationHtml } from "../src/lib/documents/templates/quotation";
import { referenceInvoice, referenceQuotation, SAMPLE_ITEMS, sampleInvoice, sampleQuotation } from "../src/lib/documents/samples";
import { calculateDocument } from "../src/lib/documents/calc";
import { renderProposalHtml } from "../src/lib/documents/templates/proposal";
import type { ProposalRender } from "../src/lib/documents/types";

async function main() {
  const out = path.resolve(process.argv[2] ?? "generated");
  fs.mkdirSync(out, { recursive: true });
  const jobs: [string, string][] = [
    ["reference-quotation", renderQuotationHtml(referenceQuotation())],
    ["reference-invoice", renderInvoiceHtml(referenceInvoice(), { referenceLayout: true })],
    ["sample-quotation", renderQuotationHtml(sampleQuotation())],
    ["sample-invoice", renderInvoiceHtml(sampleInvoice())],
  ];
  // Stress: 40 line items with long descriptions
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...SAMPLE_ITEMS[i % SAMPLE_ITEMS.length],
    description: `Item ${i + 1}: ${SAMPLE_ITEMS[i % SAMPLE_ITEMS.length].description} — extended description to test wrapping across the column width of the table`,
  }));
  const q = sampleQuotation();
  const manyQ = { ...q, items: many, calc: calculateDocument(many.map((m) => ({ qty: m.qty, rate: m.rate })), q.config) };
  jobs.push(["stress-quotation", renderQuotationHtml(manyQ)]);
  const inv = sampleInvoice();
  jobs.push(["stress-invoice", renderInvoiceHtml({ ...inv, items: many, calc: calculateDocument(many.map((m) => ({ qty: m.qty, rate: m.rate })), inv.config) })]);

  const sq = sampleQuotation();
  const proposal: ProposalRender = {
    kind: "proposal", number: "NAFA-P-001", status: "sent", date: "2026-11-01", title: "Annual Dealer Meet 2027 — Event Proposal", client: sq.client, company: sq.company,
    sections: [
      { type: "cover", title: "Cover", body: "A proposal for the Aurora Motors annual dealer meet, covering concept, production and delivery.", images: [] },
      { type: "prepared_for", title: "Prepared for", body: "", images: [] },
      { type: "overview", title: "Project overview", body: ["The dealer meet brings 250 dealers together in Mumbai.", "- Two-day programme\n- Product reveal and awards evening", "## Audience\nDealers, regional managers and leadership."].join("\n\n"), images: [] },
      { type: "scope", title: "Scope of work", body: Array.from({ length: 14 }, (_, i) => `Scope item ${i + 1}: description of the work included in this line of the proposal.`).join("\n\n"), images: [] },
      { type: "commercial", title: "Commercial proposal and cost breakdown", body: "All amounts are in Indian Rupees.", images: [] },
      { type: "acceptance", title: "Approval and acceptance", body: "", images: [] },
    ],
    commercial: { items: sq.items.map((it, i) => ({ description: it.description, qty: it.qty, rate: it.rate, amount: sq.calc.lines[i].amount })), calc: sq.calc, manual_note: "" },
  };
  jobs.push(["sample-proposal", renderProposalHtml(proposal)]);

  for (const [name, html] of jobs) {
    const { pdf, pages } = await htmlToPdf(html);
    fs.writeFileSync(path.join(out, `${name}.pdf`), pdf);
    fs.writeFileSync(path.join(out, `${name}.html`), html);
    console.log(`${name}.pdf  ${pages} page(s)  ${(pdf.length / 1024).toFixed(0)} KB`);
  }
  await closePdfEngine();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
