import { notFound } from "next/navigation";
import { NoFinanceAccess } from "@/components/finance/bits";
import { ProjectForm } from "@/components/finance/project-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getFinanceAccess, getProject, listPeople } from "@/lib/finance/repo";
import { listLeadOptions } from "@/lib/documents/repo";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.manage) return <><PageHeader title="Edit project" /><NoFinanceAccess /></>;
  const found = await getProject(supabase, id);
  if (!found || found.project.deleted_at) notFound();
  const { project: p, team } = found;
  const [people, leads, companies] = await Promise.all([
    listPeople(supabase),
    listLeadOptions(supabase),
    supabase.from("companies").select("id, name").order("name").limit(1000),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: p.name, href: `/projects/${id}` }, { label: "Edit" }]} />
      <ProjectForm
        id={id}
        defaults={{
          name: p.name, company_id: p.company_id ?? "", lead_id: p.lead_id ?? "", quotation_id: p.quotation_id ?? "", category: p.category, location: p.location,
          start_date: p.start_date ?? "", end_date: p.end_date ?? "", manager_id: p.manager_id ?? "", status: p.status, approved_value: String(p.approved_value),
          final_billing_amount: p.final_billing_amount == null ? "" : String(p.final_billing_amount), notes: p.notes, team,
        }}
        companies={(companies.data ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        people={people.map((x) => ({ id: x.id, label: x.full_name || "Unnamed" }))}
        leads={leads.map((l) => ({ id: l.id, label: `L-${String(l.lead_number).padStart(4, "0")} · ${l.title}` }))}
      />
    </>
  );
}
