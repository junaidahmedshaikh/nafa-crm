import { DocumentSettingsForm, NumberingForm, type SequenceRow } from "@/components/documents/document-settings-form";
import { emailConfigured } from "@/lib/documents/email";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getDocSettings } from "@/lib/documents/repo";
import type { DocumentSettingsValues } from "@/lib/documents/schemas";

export const metadata = { title: "Document settings" };

export default async function DocumentSettingsPage() {
  const { supabase, profile } = await requireMember();
  const s = await getDocSettings();
  const { data: seq } = await supabase.from("document_sequences").select("doc_type, prefix, padding, next_number").order("doc_type");
  const order = ["quotation", "proposal", "invoice"];
  const rows = ((seq ?? []) as SequenceRow[]).sort((a, b) => order.indexOf(a.doc_type) - order.indexOf(b.doc_type));

  const defaults: DocumentSettingsValues = {
    company_name: s.company_name, company_email: s.company_email, company_phone: s.company_phone, company_website: s.company_website,
    company_location: s.company_location, company_gstin: s.company_gstin ?? "", signatory_label: s.signatory_label,
    bank_account_holder: s.bank_account_holder, bank_name: s.bank_name, bank_account_number: s.bank_account_number, bank_ifsc: s.bank_ifsc, bank_upi_id: s.bank_upi_id,
    default_agency_fee_enabled: s.default_agency_fee_enabled, default_agency_fee_rate: String(s.default_agency_fee_rate),
    default_quotation_tax_mode: s.default_quotation_tax_mode, default_invoice_tax_mode: s.default_invoice_tax_mode, default_tax_rate: String(s.default_tax_rate),
    default_quotation_validity_days: String(s.default_quotation_validity_days), default_invoice_due_days: String(s.default_invoice_due_days),
    quotation_terms: s.quotation_terms, quotation_milestones: s.quotation_milestones.map((m) => ({ label: m.label, kind: m.kind, value: String(Number(m.value)), due_text: m.due_text ?? "" })),
    invoice_payment_terms: s.invoice_payment_terms, invoice_notes: s.invoice_notes, gst_declaration_enabled: s.gst_declaration_enabled, gst_declaration: s.gst_declaration,
  };
  const admin = profile.role === "admin";
  return (
    <>
      <PageHeader
        title="Document settings"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Documents" }]}
        description={`Company details, bank details, defaults, wording and numbering for quotations, proposals and invoices. Email delivery is ${emailConfigured() ? "configured" : "not configured (see README → Email)"}.`}
      />
      <div className="max-w-4xl space-y-8">
        <DocumentSettingsForm defaults={defaults} canEdit={admin} />
        <NumberingForm rows={rows} canEdit={admin} />
      </div>
    </>
  );
}
