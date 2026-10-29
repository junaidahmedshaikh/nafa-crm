import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/documents/invoice-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { invoiceValuesFromRows } from "@/lib/documents/defaults";
import { getInvoiceFull, listActiveProducts, listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: PageProps<"/invoices/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getInvoiceFull(supabase, id);
  if (!full) notFound();
  if (full.row.state !== "draft") redirect(`/invoices/${id}`); // issued invoices are locked
  const [leads, catalogue] = await Promise.all([listLeadOptions(supabase), listActiveProducts(supabase)]);
  return (
    <>
      <PageHeader title="Edit draft invoice" breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: "Draft", href: `/invoices/${id}` }, { label: "Edit" }]}
        description={full.row.quotation_number ? `Created from quotation ${full.row.quotation_number}. Adjust anything before issuing.` : undefined} />
      <InvoiceForm id={id} defaults={invoiceValuesFromRows(full.row, full.items)} leads={leads} catalogue={catalogue} />
    </>
  );
}
