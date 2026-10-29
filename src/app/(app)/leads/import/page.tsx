import { ImportWizard } from "@/components/leads/import-wizard";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";

export const metadata = { title: "Import leads" };

export default async function ImportLeadsPage() {
  await requireMember();
  return (
    <>
      <PageHeader
        title="Import leads from CSV"
        description="Every row is validated first. Rows with errors are never imported and are listed so you can fix them."
        breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: "Import" }]}
      />
      <ImportWizard />
    </>
  );
}
