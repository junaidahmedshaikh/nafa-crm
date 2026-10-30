import { QuotationForm } from "@/components/documents/quotation-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { newQuotationValues } from "@/lib/documents/defaults";
import { getDocSettings, getNextDocumentNumber, listActiveProducts, listLeadOptions, todayIST } from "@/lib/documents/repo";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  const sp = await searchParams;
  const leadParam = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const { supabase } = await requireMember();
  const [settings, leads, catalogue, nextNumber] = await Promise.all([
    getDocSettings(),
    listLeadOptions(supabase),
    listActiveProducts(supabase),
    getNextDocumentNumber(supabase, "quotation"),
  ]);
  const lead = leads.find((l) => l.id === leadParam);
  return (
    <>
      <PageHeader
        title={`New quotation · ${nextNumber}`}
        breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: "New" }]}
        description={`Next allocated quotation number: ${nextNumber}. Sequence increments by 1 on issue.`}
      />
      <QuotationForm
        defaults={newQuotationValues(settings, todayIST(), lead)}
        leads={leads}
        catalogue={catalogue}
        nextNumber={nextNumber}
      />
    </>
  );
}
