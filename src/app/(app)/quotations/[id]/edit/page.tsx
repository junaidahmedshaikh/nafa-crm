import { notFound, redirect } from "next/navigation";
import { QuotationForm } from "@/components/documents/quotation-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { quotationValuesFromRows } from "@/lib/documents/defaults";
import { getQuotationFull, listActiveProducts, listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getQuotationFull(supabase, id);
  if (!full) notFound();
  if (full.row.status !== "draft") redirect(`/quotations/${id}`); // issued quotations are locked
  const [leads, catalogue] = await Promise.all([listLeadOptions(supabase), listActiveProducts(supabase)]);
  return (
    <>
      <PageHeader title="Edit draft quotation" breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: "Draft", href: `/quotations/${id}` }, { label: "Edit" }]}
        description={full.row.revision_of ? "This is a revision of an earlier quotation. It receives a new number when issued." : undefined} />
      <QuotationForm id={id} defaults={quotationValuesFromRows(full.row, full.items, full.milestones)} leads={leads} catalogue={catalogue} />
    </>
  );
}
