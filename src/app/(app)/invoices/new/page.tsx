import { InvoiceForm } from "@/components/documents/invoice-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { settingsToBank } from "@/lib/documents/build";
import { newInvoiceValues } from "@/lib/documents/defaults";
import { getDocSettings, getNextDocumentNumber, listActiveProducts, listLeadOptions, todayIST } from "@/lib/documents/repo";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const sp = await searchParams;
  const leadParam = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const { supabase } = await requireMember();
  const [settings, leads, catalogue, nextNumber] = await Promise.all([
    getDocSettings(),
    listLeadOptions(supabase),
    listActiveProducts(supabase),
    getNextDocumentNumber(supabase, "invoice"),
  ]);
  return (
    <>
      <PageHeader
        title={`New invoice · ${nextNumber}`}
        breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: "New" }]}
        description={`Next allocated invoice number: ${nextNumber}. To invoice an accepted quotation, open it and use “Convert to invoice”.`}
      />
      <InvoiceForm
        defaults={newInvoiceValues(settings, todayIST(), leads.find((l) => l.id === leadParam))}
        leads={leads}
        catalogue={catalogue}
        nextNumber={nextNumber}
        bank={settingsToBank(settings)}
      />
    </>
  );
}
