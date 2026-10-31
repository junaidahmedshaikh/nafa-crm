import { NoFinanceAccess } from "@/components/finance/bits";
import { ProjectForm } from "@/components/finance/project-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getFinanceAccess, listLinkableInvoices, listPeople } from "@/lib/finance/repo";
import { listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.manage) return <><PageHeader title="New project" /><NoFinanceAccess /></>;
  const [people, leads, companies, invoices] = await Promise.all([
    listPeople(supabase),
    listLeadOptions(supabase),
    supabase.from("companies").select("id, name").order("name").limit(1000),
    listLinkableInvoices(supabase, null),
  ]);
  return (
    <>
      <PageHeader title="New project" breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: "New" }]} />
      <ProjectForm
        defaults={{ name: "", company_id: "", lead_id: "", quotation_id: "", category: "", location: "", start_date: "", end_date: "", manager_id: "", status: "planning", approved_value: "0", final_billing_amount: "", notes: "", team: [] }}
        companies={(companies.data ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        people={people.map((p) => ({ id: p.id, label: p.full_name || "Unnamed" }))}
        invoices={invoices}
        leads={leads.map((l) => ({ id: l.id, label: `L-${String(l.lead_number).padStart(4, "0")} · ${l.title}` }))}
      />
    </>
  );
}
