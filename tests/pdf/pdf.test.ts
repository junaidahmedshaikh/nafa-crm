import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { calculateDocument } from "@/lib/documents/calc";
import { closePdfEngine, htmlToPdf } from "@/lib/documents/pdf";
import { referenceInvoice, referenceQuotation, SAMPLE_ITEMS, sampleInvoice, sampleQuotation } from "@/lib/documents/samples";
import { renderInvoiceHtml } from "@/lib/documents/templates/invoice";
import { renderProposalHtml } from "@/lib/documents/templates/proposal";
import { renderQuotationHtml } from "@/lib/documents/templates/quotation";
import type { ProposalRender } from "@/lib/documents/types";

/** Real PDF generation through headless Chromium; skipped automatically where no browser is installed. */
const hasChromium = (() => {
  try {
    return fs.existsSync(process.env.PDF_CHROMIUM_PATH || chromium.executablePath());
  } catch {
    return false;
  }
})();

async function pdfText(pdf: Buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  const page1 = await doc.getPage(1);
  const viewport = page1.getViewport({ scale: 1 });
  return { pages, width: viewport.width, height: viewport.height };
}

const many = Array.from({ length: 45 }, (_, i) => ({
  ...SAMPLE_ITEMS[i % SAMPLE_ITEMS.length],
  description: `Line ${i + 1}: ${SAMPLE_ITEMS[i % SAMPLE_ITEMS.length].description} with a deliberately long description to prove natural wrapping inside the column`,
}));

afterAll(async () => {
  await closePdfEngine();
});

describe.skipIf(!hasChromium)("PDF generation (Chromium)", () => {
  it("produces a single A4 page quotation with selectable text and Indian formatting", async () => {
    const q = sampleQuotation();
    const { pdf, pages } = await htmlToPdf(renderQuotationHtml(q));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBe(1);
    const t = await pdfText(pdf);
    expect(Math.round(t.width)).toBe(595);
    expect(Math.round(t.height)).toBe(842);
    const text = t.pages[0];
    expect(text).toContain("QUOTATION");
    expect(text).toContain("NAFA-Q-037");
    expect(text).toContain("28/10/2026");
    expect(text).toContain("Aurora Motors Pvt Ltd");
    expect(text).toContain("Stage design, fabrication");
    expect(text).toContain("Agency fee (15%)");
    expect(text).toContain("₹");
    // Indian digit grouping for the grand total, e.g. 8,06,xxx.xx
    expect(text).toMatch(/\d{1,2},\d{2},\d{3}\.\d{2}/);
    expect(text).toContain(q.calc.grand_total.toLocaleString("en-IN", { minimumFractionDigits: 2 }));
    expect(text).toContain("Advance");
    expect(text).toContain("TERMS & CONDITIONS");
  });

  it("produces a single-page invoice including bank details, signature and the conditional declaration", async () => {
    const iv = sampleInvoice({ config: { ...sampleInvoice().config, tax: { mode: "none", rate: 18 } } });
    const none = { ...iv, calc: calculateDocument(iv.items.map((i) => ({ qty: i.qty, rate: i.rate })), { ...iv.config, tax: { mode: "none", rate: 18 } }), gst_declaration: "GST has not been charged on this invoice." };
    const { pdf, pages } = await htmlToPdf(renderInvoiceHtml(none));
    expect(pages).toBe(1);
    const text = (await pdfText(pdf)).pages[0];
    for (const s of ["INVOICE", "NAFA-INV-014", "BILL TO", "PROJECT DETAILS", "HSN/SAC", "GRAND TOTAL PAYABLE", "Federal Bank", "Authorised Signatory", "Thank you for your business", "GST has not been charged on this invoice."]) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain("CGST");
  });

  it("flows a 45-line quotation over several pages with repeated headers, page numbers and no lost lines", async () => {
    const q = sampleQuotation();
    const big = { ...q, items: many, calc: calculateDocument(many.map((m) => ({ qty: m.qty, rate: m.rate })), q.config) };
    const { pdf, pages } = await htmlToPdf(renderQuotationHtml(big));
    expect(pages).toBeGreaterThan(1);
    const t = await pdfText(pdf);
    expect(t.pages).toHaveLength(pages);
    const all = t.pages.join(" ");
    for (let i = 1; i <= 45; i++) expect(all, `line ${i}`).toContain(`Line ${i}:`);
    // the item-table heading repeats on each page that carries items
    const withItems = t.pages.filter((p) => p.includes("Line "));
    expect(withItems.length).toBeGreaterThan(1);
    for (const p of withItems) expect(p).toContain("DESCRIPTION");
    expect(all).toContain(`Page 1 of ${pages}`);
    expect(all).toContain(`Page ${pages} of ${pages}`);
    expect(t.pages[pages - 1]).toContain("TERMS & CONDITIONS"); // closing blocks land on the final page together
  });

  it("flows a 45-line invoice over several pages without losing rows or the totals", async () => {
    const iv = sampleInvoice();
    const big = { ...iv, items: many, calc: calculateDocument(many.map((m) => ({ qty: m.qty, rate: m.rate })), iv.config) };
    const { pdf, pages } = await htmlToPdf(renderInvoiceHtml(big));
    expect(pages).toBeGreaterThan(1);
    const t = await pdfText(pdf);
    const all = t.pages.join(" ");
    for (let i = 1; i <= 45; i++) expect(all, `line ${i}`).toContain(`Line ${i}:`);
    expect(all).toContain("GRAND TOTAL PAYABLE");
    expect(all).toContain("Authorised Signatory");
    expect(t.pages.filter((p) => p.includes("DESCRIPTION OF SERVICES")).length).toBeGreaterThan(1);
  });

  it("handles very long client and event names without clipping the page", async () => {
    const q = sampleQuotation({
      client: { ...sampleQuotation().client, company: "The Extraordinarily Long Named Multinational Conglomerate of Western India Private Limited", address: "Unit 4, A very long registered office address line that goes on, Near the landmark, Opposite the other landmark, Mumbai 400001" },
      event: { type: "Corporate Event", name: "Annual National Distributors and Dealers Conference and Awards Gala Dinner 2027 — Edition Seven", date_text: "15–17 February 2027", location: "Grand Convention Centre, Bandra Kurla Complex, Mumbai", reference: "Lead L-0099" },
    });
    const { pdf, pages } = await htmlToPdf(renderQuotationHtml(q));
    expect(pages).toBeLessThanOrEqual(2);
    const text = (await pdfText(pdf)).pages.join(" ");
    expect(text).toContain("Conglomerate");
    expect(text).toContain("Edition Seven");
  });

  it("renders a multi-page proposal with sections, a commercial table and acceptance blocks", async () => {
    const q = sampleQuotation();
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the concept narrative describing the experience, flow and audience engagement in some detail.`).join("\n\n");
    const p: ProposalRender = {
      kind: "proposal", number: "NAFA-P-001", status: "sent", date: "2026-11-01", title: "Annual Dealer Meet 2027 — Event Proposal",
      client: q.client, company: q.company,
      sections: [
        { type: "cover", title: "Cover", body: "A proposal for an unforgettable dealer meet.", images: [] },
        { type: "prepared_for", title: "Prepared for", body: "", images: [] },
        { type: "concept", title: "Proposed concept and strategy", body: long, images: [] },
        { type: "commercial", title: "Commercial proposal and cost breakdown", body: "All amounts in INR.", images: [] },
        { type: "acceptance", title: "Approval and acceptance", body: "", images: [] },
      ],
      commercial: { items: q.items.map((it, i) => ({ description: it.description, qty: it.qty, rate: it.rate, amount: q.calc.lines[i].amount })), calc: q.calc, manual_note: "" },
    };
    const { pdf, pages } = await htmlToPdf(renderProposalHtml(p));
    expect(pages).toBeGreaterThan(1);
    const t = await pdfText(pdf);
    const all = t.pages.join(" ");
    expect(all).toContain("PROPOSAL");
    expect(all).toContain("NAFA-P-001");
    expect(all).toContain("Paragraph 40");
    expect(all).toContain("Commercial proposal and cost breakdown");
    expect(all).toContain("Signature & date");
    expect(all).toContain(q.calc.grand_total.toLocaleString("en-IN", { minimumFractionDigits: 2 }));
    expect(all).toContain(`Page 2 of ${pages}`);
  });

  it("keeps an embedded image inside the page without distortion", async () => {
    // 1x1 red PNG scaled by CSS: ensures images render and the page count stays sane
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const q = sampleQuotation();
    const p: ProposalRender = {
      kind: "proposal", number: null, status: "draft", date: "2026-11-01", title: "Moodboard", client: q.client, company: q.company,
      sections: [{ type: "concept", title: "Concept", body: "See the visual direction.", images: [{ data_uri: png, caption: "Reference one" }, { data_uri: png, caption: "Reference two" }] }],
      commercial: null,
    };
    const html = renderProposalHtml(p);
    expect(html).toContain("max-height:230pt");
    const { pdf, pages } = await htmlToPdf(html);
    expect(pages).toBe(1);
    expect((await pdfText(pdf)).pages[0]).toContain("Reference one");
  });

  it("generates the reference-layout documents used for template comparison", async () => {
    expect((await htmlToPdf(renderQuotationHtml(referenceQuotation()))).pages).toBe(1);
    expect((await htmlToPdf(renderInvoiceHtml(referenceInvoice(), { referenceLayout: true }))).pages).toBe(1);
  });
});
