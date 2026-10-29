import { CompanyForm } from "@/components/directory/company-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  await requireMember();
  return (
    <>
      <PageHeader title="New company" breadcrumbs={[{ label: "Companies", href: "/companies" }, { label: "New company" }]} />
      <div className="max-w-3xl">
        <CompanyForm defaults={{ name: "", website: "", industry: "", city: "", address: "", notes: "" }} />
      </div>
    </>
  );
}
