import { describe, expect, it } from "vitest";
import { assembleInvoice, assembleQuotation, type DocSettings, missingSections } from "@/lib/documents/build";
import { DEFAULT_CALC_CONFIG, type CalcConfig } from "@/lib/documents/calc";
import { dmy, longDate, money, qtyText } from "@/lib/documents/format";
import { invoiceInputSchema, itemSchema, paymentInputSchema, quotationInputSchema } from "@/lib/documents/schemas";
import { SAMPLE_ITEMS, sampleInvoice, sampleQuotation, referenceInvoice } from "@/lib/documents/samples";
import { renderInvoiceHtml } from "@/lib/documents/templates/invoice";
import { renderProposalHtml } from "@/lib/documents/templates/proposal";
import { renderQuotationHtml } from "@/lib/documents/templates/quotation";
import { pdfFileName, sanitizeClientCompany } from "@/lib/documents/render";
import type { ProposalRender } from "@/lib/documents/types";

const settings: DocSettings = {
  company_name: "NAFA Events & Activations", company_email: "contact@nafaevents.in", company_phone: "+91 816 951 2822", company_website: "https://www.nafaevents.in/",
  company_location: "Mumbai", company_gstin: null, signatory_label: "For NAFA Events & Activations",
  bank_account_holder: "A B", bank_name: "Bank", bank_account_number: "123", bank_ifsc: "IFSC0001", bank_upi_id: "a@b",
  default_agency_fee_enabled: true, default_agency_fee_rate: 15, default_quotation_tax_mode: "cgst_sgst", default_invoice_tax_mode: "none", default_tax_rate: 18,
  default_quotation_validity_days: 7, default_invoice_due_days: 7, quotation_terms: ["t"], quotation_milestones: [],
  invoice_payment_terms: "Due within 7 days of invoice date.", invoice_notes: "Payment is due within 7 days.", gst_declaration_enabled: true, gst_declaration: "GST has not been charged on this invoice.",
};

const cfg = (patch: Partial<CalcConfig> = {}): CalcConfig => ({ ...DEFAULT_CALC_CONFIG, ...patch });
const inv = (config: CalcConfig, s = settings) =>
  assembleInvoice(
    { client_company: "Acme", invoice_date: "2026-11-01", due_date: "2026-11-08", config, items: [{ description: "Stage", qty: 1, rate: 1000 }], payment_terms_text: "t", notes_text: "Payment is due within 7 days." },
    { number: "NAFA-INV-001", state: "issued" }, 0, "2026-11-02", s,
  );

describe("formatting helpers", () => {
  it("formats Indian currency, quantities and dates", () => {
    expect(money(125000)).toBe("1,25,000.00");
    expect(money("99999999.5")).toBe("9,99,99,999.50");
    expect(money("x")).toBe("0.00");
    expect(qtyText("2.500")).toBe("2.5");
    expect(qtyText(12)).toBe("12");
    expect(dmy("2026-10-28")).toBe("28/10/2026");
    expect(longDate("2026-11-01")).toBe("01 November 2026");
  });
});

describe("GST declaration (conditional, never contradicting the tax calculation)", () => {
  it("is printed only when no GST is charged and the company has enabled it", () => {
    const none = inv(cfg());
    expect(none.gst_declaration).toBe("GST has not been charged on this invoice.");
    expect(renderInvoiceHtml(none)).toContain("GST has not been charged on this invoice.");
  });
  it("is never printed on an invoice that charges GST", () => {
    for (const mode of ["cgst_sgst", "igst"] as const) {
      const taxed = inv(cfg({ tax: { mode, rate: 18 } }));
      expect(taxed.gst_declaration).toBeNull();
      expect(renderInvoiceHtml(taxed)).not.toContain("GST has not been charged");
    }
  });
  it("can be switched off in settings", () => {
    expect(inv(cfg(), { ...settings, gst_declaration_enabled: false }).gst_declaration).toBeNull();
  });
});

describe("invoice template", () => {
  // Embedded fonts and the logo are base64 data URIs, which can contain any letter sequence by chance; assert on the visible markup only.
  const visible = (html: string) => html.replace(/url\(data:[^)]*\)/g, "").replace(/src="data:[^"]*"/g, "");
  it("shows CGST/SGST or IGST rows only for the selected tax treatment, no zero-value tax rows otherwise", () => {
    const split = visible(renderInvoiceHtml(inv(cfg({ tax: { mode: "cgst_sgst", rate: 18 } }))));
    expect(split).toContain("CGST 9%");
    expect(split).toContain("SGST 9%");
    expect(split).not.toContain("IGST");
    const igst = visible(renderInvoiceHtml(inv(cfg({ tax: { mode: "igst", rate: 18 } }))));
    expect(igst).toContain("IGST 18%");
    expect(igst).not.toContain("CGST");
    const none = visible(renderInvoiceHtml(inv(cfg())));
    expect(none).not.toMatch(/CGST|SGST|IGST/);
  });
  it("prints amount in words, received/balance and the payment status", () => {
    const html = renderInvoiceHtml(sampleInvoice());
    expect(html).toContain("Rupees ");
    expect(html).toContain("PARTIALLY PAID");
    expect(html).toContain("Amount received:");
    expect(html).toContain("Balance due:");
    expect(html).toContain("Please use the invoice number as the payment reference.");
  });
  it("prints DRAFT instead of a number for unissued documents", () => {
    expect(renderInvoiceHtml({ ...referenceInvoice(), number: null })).toContain(">DRAFT<");
    expect(renderQuotationHtml({ ...sampleQuotation(), number: null })).toContain(">DRAFT<");
  });
  it("escapes user content (no HTML/script injection into the PDF engine)", () => {
    const evil = `<img src=x onerror=alert(1)> & "quoted"`;
    const q = sampleQuotation({ client: { ...sampleQuotation().client, company: evil }, items: [{ ...SAMPLE_ITEMS[0], description: `<script>alert(1)</script>` }] });
    const html = renderQuotationHtml(q);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const iv = renderInvoiceHtml(sampleInvoice({ client: { ...sampleInvoice().client, company: evil } }));
    expect(iv).not.toContain("<img src=x onerror");
  });
});

describe("quotation template", () => {
  it("hides the agency fee when disabled and shows the configured rate when enabled", () => {
    const base = { client_company: "A", quotation_date: "2026-11-01", valid_until: null, terms: [], config: cfg(), items: [{ description: "x", qty: 1, rate: 1000 }], milestones: [] };
    const off = renderQuotationHtml(assembleQuotation(base, { number: "Q", status: "draft" }, settings));
    expect(off).not.toContain("Agency fee");
    const on = renderQuotationHtml(assembleQuotation({ ...base, config: cfg({ agency_fee: { enabled: true, rate: 12.5, base: "after_discount" } }) }, { number: "Q", status: "draft" }, settings));
    expect(on).toContain("Agency fee (12.5%)");
    expect(on).toContain("125.00");
  });
  it("omits the payment terms table when there are no milestones and reconciles milestone amounts", () => {
    const q = sampleQuotation();
    expect(renderQuotationHtml({ ...q, milestones: [] })).not.toContain("Payment terms");
    const sum = q.milestones.reduce((a, m) => a + Math.round(m.amount * 100), 0);
    expect(sum).toBe(Math.round(q.calc.grand_total * 100));
  });
  it("keeps the supplied template wording for the default terms", () => {
    const html = renderQuotationHtml(sampleQuotation());
    expect(html).toContain("This quotation is valid until the date stated above.");
    expect(html).toContain("Taxes are charged as applicable at the prevailing rate.");
  });
});

describe("proposal template", () => {
  const base: ProposalRender = {
    kind: "proposal", number: null, status: "draft", date: "2026-11-01", title: "Launch", client: { client_name: "Asha", company: "Aurora", address: "", email: "", phone: "", gstin: "" },
    sections: [
      { type: "overview", title: "Project overview", body: "First paragraph.\n\n- point one\n- point two\n\n## Sub heading\nText", images: [] },
      { type: "acceptance", title: "Approval and acceptance", body: "", images: [] },
    ],
    commercial: null, company: { name: "NAFA Events & Activations", email: "e", phone: "p", website: "w", location: "l", gstin: null, signatory_label: "For NAFA" },
  };
  it("renders only the content that was entered, with formatting and acceptance blocks", () => {
    const html = renderProposalHtml(base);
    expect(html).toContain("<li>point one</li>");
    expect(html).toContain("<h3>Sub heading</h3>");
    expect(html).toContain("Signature &amp; date");
    expect(html).not.toContain("Scope of work");
  });
  it("lists the sections that are switched on but empty", () => {
    expect(missingSections([{ type: "scope", title: "Scope of work", body: "", included: true }, { type: "timeline", title: "Timeline", body: "x", included: true }, { type: "terms", title: "Terms", body: "", included: false }]))
      .toEqual(["Scope of work"]);
  });
  it("escapes section content", () => {
    const html = renderProposalHtml({ ...base, sections: [{ type: "overview", title: "<b>x</b>", body: "<script>1</script>", images: [] }] });
    expect(html).not.toContain("<script>1</script>");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("input validation", () => {
  const item = { catalogue_id: "", description: "Stage", notes: "", hsn_sac: "", qty: "1", rate: "100", discount: { type: "", value: "" } };
  const config = { discount: { type: "", value: "" }, agency_fee: { enabled: true, rate: "15", base: "after_discount" as const }, tax: { mode: "cgst_sgst" as const, rate: "18" }, other_charges: [], round_to_rupee: false };
  const base = {
    lead_id: "", company_id: "", contact_id: "", client_name: "", client_company: "Acme", client_address: "", client_email: "", client_phone: "", client_gstin: "",
    event_type: "", event_name: "", event_date_text: "", event_location: "", reference_text: "", quotation_date: "2026-11-01", valid_until: "", config, items: [item], milestones: [], terms: [], notes: "",
  };
  it("accepts a valid quotation and normalises numbers", () => {
    const r = quotationInputSchema.safeParse({ ...base, items: [{ ...item, qty: "2.5", rate: "1,500.50" }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[0].qty).toBe("2.5");
      expect(r.data.items[0].rate).toBe("1500.50");
      expect(r.data.valid_until).toBeNull();
    }
  });
  it("rejects bad quantities, rates, discounts, tax and dates", () => {
    for (const patch of [
      { items: [{ ...item, qty: "0" }] }, { items: [{ ...item, qty: "-1" }] }, { items: [{ ...item, rate: "abc" }] }, { items: [{ ...item, rate: "1.234" }] },
      { items: [{ ...item, description: " " }] }, { items: [{ ...item, discount: { type: "percent", value: "150" } }] },
      { config: { ...config, tax: { mode: "igst", rate: "180" } } }, { config: { ...config, agency_fee: { ...config.agency_fee, rate: "x" } } },
      { quotation_date: "" }, { quotation_date: "2026-13-40" }, { valid_until: "soon" }, { client_email: "nope" },
    ]) {
      expect(quotationInputSchema.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
  it("validates items, invoices and payments", () => {
    expect(itemSchema.safeParse(item).success).toBe(true);
    const inv = { ...base, client_name: "A. Person", client_company: "Acme Ltd", client_email: "", client_phone: "", client_gstin: "" };
    // Only company and contact person are mandatory on an invoice.
    expect(invoiceInputSchema.safeParse({ ...inv, client_name: "", quotation_id: "", invoice_date: "2026-11-01" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...inv, client_company: "", quotation_id: "", invoice_date: "2026-11-01" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...inv, quotation_id: "", quotation_number: "", project_name: "", project_location: "", project_date_text: "", place_of_supply: "", invoice_date: "2026-11-01", due_date: "2026-11-08", payment_terms_text: "", notes_text: "" }).success).toBe(true);
    expect(paymentInputSchema.safeParse({ paid_on: "2026-11-01", amount: "500", method: "upi" }).success).toBe(true);
    expect(paymentInputSchema.safeParse({ paid_on: "2026-11-01", amount: "0", method: "upi" }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ paid_on: "2026-11-01", amount: "5", method: "crypto" }).success).toBe(false);
  });
});

describe("professional document file-naming convention", () => {
  it("sanitizes client company identifiers into clean PascalCase slugs", () => {
    expect(sanitizeClientCompany("CROSS")).toBe("CROSS");
    expect(sanitizeClientCompany("Tata Motors")).toBe("TataMotors");
    expect(sanitizeClientCompany("Tata Motors Pvt. Ltd.")).toBe("TataMotorsPvtLtd");
    expect(sanitizeClientCompany("Acme Corp & Co.")).toBe("AcmeCorpCo");
    expect(sanitizeClientCompany("   ")).toBe("");
    expect(sanitizeClientCompany(null)).toBe("");
  });

  it("generates quotation filenames matching NAFA-QUO-YY-001-ClientCompany.pdf", () => {
    const q1 = sampleQuotation({
      number: "NAFA-QUO-26-001",
      client: { ...sampleQuotation().client, company: "CROSS" },
    });
    expect(pdfFileName(q1)).toBe("NAFA-QUO-26-001-CROSS.pdf");

    const q2 = sampleQuotation({
      number: "NAFA-QUO-26-002",
      client: { ...sampleQuotation().client, company: "Tata Motors" },
    });
    expect(pdfFileName(q2)).toBe("NAFA-QUO-26-002-TataMotors.pdf");
  });

  it("generates invoice filenames matching NAFA-INV-YY-001-ClientCompany.pdf", () => {
    const inv1 = sampleInvoice({
      number: "NAFA-INV-26-001",
      client: { ...sampleInvoice().client, company: "CROSS" },
    });
    expect(pdfFileName(inv1)).toBe("NAFA-INV-26-001-CROSS.pdf");

    const inv2 = sampleInvoice({
      number: "NAFA-INV-26-002",
      client: { ...sampleInvoice().client, company: "Tata Motors" },
    });
    expect(pdfFileName(inv2)).toBe("NAFA-INV-26-002-TataMotors.pdf");
  });

  it("handles revision filenames retaining original number with -V02 suffix", () => {
    const rev1 = sampleQuotation({
      number: "NAFA-QUO-26-001-V02",
      client: { ...sampleQuotation().client, company: "CROSS" },
    });
    expect(pdfFileName(rev1)).toBe("NAFA-QUO-26-001-V02-CROSS.pdf");

    const rev2 = sampleQuotation({
      number: "NAFA-QUO-26-002-V03",
      client: { ...sampleQuotation().client, company: "Tata Motors" },
    });
    expect(pdfFileName(rev2)).toBe("NAFA-QUO-26-002-V03-TataMotors.pdf");
  });

  it("generates clean draft filenames when unissued", () => {
    const draftQ = sampleQuotation({
      number: null,
      client: { ...sampleQuotation().client, company: "CROSS" },
    });
    expect(pdfFileName(draftQ)).toBe("Draft-Quotation-CROSS.pdf");

    const draftInv = sampleInvoice({
      number: null,
      client: { ...sampleInvoice().client, company: "Tata Motors" },
    });
    expect(pdfFileName(draftInv)).toBe("Draft-Invoice-TataMotors.pdf");
  });
});
