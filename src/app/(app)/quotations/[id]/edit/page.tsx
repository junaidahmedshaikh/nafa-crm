import { notFound, redirect } from "next/navigation";
import { QuotationForm } from "@/components/documents/quotation-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { quotationValuesFromRows } from "@/lib/documents/defaults";
import { getProspectiveQuotationNumber, getQuotationFull, listActiveProducts, listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getQuotationFull(supabase, id);
  if (!full) notFound();
  if (full.row.status !== "draft") redirect(`/quotations/${id}`); // issued quotations are locked
  const [leads, catalogue, nextNumber] = await Promise.all([
    listLeadOptions(supabase),
    listActiveProducts(supabase),
    getProspectiveQuotationNumber(supabase, full.row.revision_of),
  ]);
  const displayNum = full.row.number || nextNumber;
  return (
    <>
      <PageHeader
        title={`Edit quotation · ${displayNum}`}
        breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: displayNum, href: `/quotations/${id}` }, { label: "Edit" }]}
        description={full.row.number ? `Quotation ${full.row.number}` : full.row.revision_of ? `Revision draft · Prospective number: ${nextNumber}` : `Draft quotation · Next number: ${nextNumber}`}
      />
      <QuotationForm
        id={id}
        number={full.row.number}
        nextNumber={nextNumber}
        defaults={quotationValuesFromRows(full.row, full.items, full.milestones)}
        leads={leads}
        catalogue={catalogue}
      />
    </>
  );
}
