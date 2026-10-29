import { notFound } from "next/navigation";
import { CompanyForm } from "@/components/directory/company-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getCompany } from "@/lib/data/directory";

export const metadata = { title: "Edit company" };

export default async function EditCompanyPage({ params }: PageProps<"/companies/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const data = await getCompany(supabase, id);
  if (!data) notFound();
  const c = data.company;
  return (
    <>
      <PageHeader
        title={`Edit: ${c.name}`}
        breadcrumbs={[{ label: "Companies", href: "/companies" }, { label: c.name, href: `/companies/${c.id}` }, { label: "Edit" }]}
      />
      <div className="max-w-3xl">
        <CompanyForm
          companyId={c.id}
          defaults={{ name: c.name, website: c.website ?? "", industry: c.industry ?? "", city: c.city ?? "", address: c.address ?? "", notes: c.notes ?? "" }}
        />
      </div>
    </>
  );
}
