import { describe, expect, it } from "vitest";
import { assembleInvoice, invoiceFromRows, type DocSettings, type InvoiceRow } from "@/lib/documents/build";
import { DEFAULT_CALC_CONFIG } from "@/lib/documents/calc";
import {
  DEFAULT_COMMON_TERMS, DEFAULT_TERMS_BY_TYPE, TERMS_TYPES, editableTerms, linesToTerms, resolveInvoiceTerms, termsToLines,
} from "@/lib/documents/invoice-terms";
import { newInvoiceValues } from "@/lib/documents/defaults";
import { invoiceInputSchema } from "@/lib/documents/schemas";
import { renderInvoiceHtml } from "@/lib/documents/templates/invoice";

const settings: DocSettings = {
  company_name: "NAFA Events & Activations", company_email: "contact@nafaevents.in", company_phone: "+91 816 951 2822", company_website: "https://www.nafaevents.in/",
  company_location: "Mumbai", company_gstin: null, signatory_label: "For NAFA Events & Activations",
  bank_account_holder: "A B", bank_name: "Bank", bank_account_number: "123", bank_ifsc: "IFSC0001", bank_upi_id: "a@b",
  default_agency_fee_enabled: true, default_agency_fee_rate: 15, default_quotation_tax_mode: "cgst_sgst", default_invoice_tax_mode: "none", default_tax_rate: 18,
  default_quotation_validity_days: 7, default_invoice_due_days: 7, quotation_terms: ["t"], quotation_milestones: [],
  invoice_payment_terms: "Due within 7 days of invoice date.", invoice_notes: "Payment is due within 7 days.", gst_declaration_enabled: true, gst_declaration: "GST has not been charged on this invoice.",
};

const invoice = (s: DocSettings, terms_type?: string) =>
  assembleInvoice(
    { client_company: "Acme", invoice_date: "2026-11-01", due_date: "2026-11-08", config: DEFAULT_CALC_CONFIG, items: [{ description: "Stage", qty: 1, rate: 1000 }], payment_terms_text: "t", notes_text: "n", terms_type },
    { number: "NAFA-INV-001", state: "issued" }, 0, "2026-11-02", s,
  );

describe("invoice terms: which clauses an invoice carries", () => {
  it("prints the 8 common terms on every invoice, and nothing else when no event type is chosen", () => {
    const t = resolveInvoiceTerms({}, "");
    expect(t.common).toEqual(DEFAULT_COMMON_TERMS);
    expect(t.common).toHaveLength(8);
    expect(t.specific).toEqual([]);
    expect(resolveInvoiceTerms({}, "nonsense").specific).toEqual([]);
  });

  it("adds the block for the chosen event type, in addition to the common terms", () => {
    const counts = { wedding: 6, btl: 6 + 2, exhibition: 6, manpower: 6 };
    for (const [type, n] of Object.entries(counts)) {
      const t = resolveInvoiceTerms({ udyam_number: "UDYAM-MH-01-0000001" }, type);
      expect(t.common).toHaveLength(8);
      expect(t.specific).toHaveLength(n);
      expect(t.type_title).not.toBe("");
    }
    expect(resolveInvoiceTerms({}, "wedding").specific[0]).toMatch(/^Payment schedule: 50% at booking, 40% seven days before the event, 10% on the event day/);
    expect(resolveInvoiceTerms({}, "manpower").specific[2]).toMatch(/^Minimum booking: Minimum billing of one full day per person/);
  });

  it("fills the Udyam number into the MSME clause, and leaves the clause out when NAFA has none", () => {
    const none = resolveInvoiceTerms({ udyam_number: "" }, "corporate");
    expect(none.specific.some((c) => c.includes("MSME"))).toBe(false);
    expect(none.specific.some((c) => c.includes("{udyam}"))).toBe(false);
    expect(none.specific.some((c) => c.startsWith("TDS:"))).toBe(true);
    const some = resolveInvoiceTerms({ udyam_number: "UDYAM-MH-01-0000001" }, "corporate");
    expect(some.specific.find((c) => c.startsWith("MSME status"))).toContain("Udyam No. UDYAM-MH-01-0000001");
    expect(resolveInvoiceTerms({ udyam_number: " UDYAM-X " }, "btl").specific.join(" ")).toContain("Udyam No. UDYAM-X)");
    // never a raw placeholder or a blank bracket on an invoice
    for (const t of TERMS_TYPES) expect(resolveInvoiceTerms({ udyam_number: "" }, t).specific.join(" ")).not.toMatch(/\{udyam\}|\[_+\]/);
  });

  it("uses the wording an admin saved instead of the defaults, including saving an empty block", () => {
    const s = { invoice_terms_common: ["Pay promptly."], invoice_terms_by_type: { wedding: ["Custom wedding clause."], btl: [] as string[] } };
    expect(resolveInvoiceTerms(s, "wedding")).toMatchObject({ common: ["Pay promptly."], specific: ["Custom wedding clause."] });
    expect(resolveInvoiceTerms(s, "btl").specific).toEqual([]);
    expect(resolveInvoiceTerms(s, "manpower").specific).toEqual(DEFAULT_TERMS_BY_TYPE.manpower); // unset type falls back to default
  });

  it("round-trips through the one-clause-per-line editor, keeping the {udyam} token", () => {
    const ed = editableTerms({});
    expect(ed.byType.corporate.join("\n")).toContain("{udyam}");
    expect(linesToTerms(termsToLines(ed.common))).toEqual(DEFAULT_COMMON_TERMS);
    expect(linesToTerms("  a \n\n b\r\n")).toEqual(["a", "b"]);
  });
});

describe("invoice terms on the invoice", () => {
  it("are part of the assembled invoice and print on the PDF template with the type heading and bold lead-ins", () => {
    const html = renderInvoiceHtml(invoice({ ...settings, udyam_number: "UDYAM-1" }, "corporate"));
    expect(html).toContain("Terms &amp; Conditions");
    expect(html).toContain("Subject to Mumbai jurisdiction.");
    expect(html).toContain("Corporate events");
    expect(html).toContain("<b>Purchase order:</b> Please quote the PO number");
    expect(html).toContain("Udyam No. UDYAM-1");
    // common terms come before the event-type terms
    expect(html.indexOf("Subject to Mumbai jurisdiction.")).toBeLessThan(html.indexOf("Purchase order:"));
  });

  it("print only the common terms when no event type is chosen, and escape anything an admin typed", () => {
    const plain = renderInvoiceHtml(invoice(settings, ""));
    expect(plain).toContain("Payment is due as per the due date");
    expect(plain).not.toContain("Corporate events");
    const evil = renderInvoiceHtml(invoice({ ...settings, invoice_terms_common: ["<script>alert(1)</script> Pay."] }, ""));
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("are frozen when the invoice is issued: later wording changes do not alter an issued invoice", () => {
    const issued = invoice({ ...settings, invoice_terms_common: ["Original common term."] }, "");
    const row = { id: "i", number: "NAFA-INV-001", state: "issued", snapshot: issued, due_date: "2026-11-08", grand_total: 1000, config: {}, terms_type: "" } as unknown as InvoiceRow;
    const later = invoiceFromRows(row, [], 0, "2026-11-02", { ...settings, invoice_terms_common: ["Edited later."] });
    expect(later.terms?.common).toEqual(["Original common term."]);
  });

  it("leave invoices issued before terms existed unchanged (no terms section)", () => {
    const old = { ...invoice(settings, ""), terms: undefined };
    expect(renderInvoiceHtml(old)).not.toContain("Terms &amp; Conditions");
  });

  it("accept only the known event types on the invoice form", () => {
    const base = { client_name: "A", client_company: "B", invoice_date: "2026-11-01", config: newInvoiceValues(settings, "2026-11-01").config, items: [] };
    expect(invoiceInputSchema.safeParse({ ...base, terms_type: "btl" }).success).toBe(true);
    expect(invoiceInputSchema.safeParse({ ...base, terms_type: "" }).success).toBe(true);
    expect(invoiceInputSchema.safeParse(base).data?.terms_type).toBe("");
    expect(invoiceInputSchema.safeParse({ ...base, terms_type: "bogus" }).success).toBe(false);
  });
});
