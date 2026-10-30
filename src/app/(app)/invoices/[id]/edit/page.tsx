import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/documents/invoice-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { settingsToBank } from "@/lib/documents/build";
import { invoiceValuesFromRows } from "@/lib/documents/defaults";
import { getDocSettings, getInvoiceFull, getNextDocumentNumber, listActiveProducts, listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: PageProps<"/invoices/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getInvoiceFull(supabase, id);
  if (!full) notFound();
  if (full.row.state !== "draft") redirect(`/invoices/${id}`); // issued invoices are locked
  const [settings, leads, catalogue, nextNumber] = await Promise.all([
    getDocSettings(),
    listLeadOptions(supabase),
    listActiveProducts(supabase),
    getNextDocumentNumber(supabase, "invoice"),
  ]);
  const displayNum = full.row.number || nextNumber;
  return (
    <>
      <PageHeader
        title={`Edit draft invoice · ${displayNum}`}
        breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: displayNum, href: `/invoices/${id}` }, { label: "Edit" }]}
        description={full.row.number ? `Invoice ${full.row.number}` : full.row.quotation_number ? `From quotation ${full.row.quotation_number} · Next invoice number: ${nextNumber}` : `Draft invoice · Next number: ${nextNumber}`}
      />
      <InvoiceForm
        id={id}
        number={full.row.number}
        nextNumber={nextNumber}
        defaults={invoiceValuesFromRows(full.row, full.items)}
        leads={leads}
        catalogue={catalogue}
        bank={settingsToBank(settings)}
      />
    </>
  );
}
