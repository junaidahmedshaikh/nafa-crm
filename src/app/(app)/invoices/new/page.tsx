import { InvoiceForm } from "@/components/documents/invoice-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { newInvoiceValues } from "@/lib/documents/defaults";
import { getDocSettings, listActiveProducts, listLeadOptions, todayIST } from "@/lib/documents/repo";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  const sp = await searchParams;
  const leadParam = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const { supabase } = await requireMember();
  const [settings, leads, catalogue] = await Promise.all([getDocSettings(), listLeadOptions(supabase), listActiveProducts(supabase)]);
  return (
    <>
      <PageHeader title="New invoice" breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: "New" }]} description="To invoice an accepted quotation, open it and use “Convert to invoice”. Saved as a draft without a number until issued." />
      <InvoiceForm defaults={newInvoiceValues(settings, todayIST(), leads.find((l) => l.id === leadParam))} leads={leads} catalogue={catalogue} />
    </>
  );
}
