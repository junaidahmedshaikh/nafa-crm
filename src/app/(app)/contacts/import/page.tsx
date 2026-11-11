import { ContactImport } from "@/components/directory/contact-import";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { listAssignableGroups } from "@/lib/data/groups";

export const metadata = { title: "Import contacts" };

export default async function ImportContactsPage() {
  const { supabase } = await requireMember();
  const groups = await listAssignableGroups(supabase);
  return (
    <>
      <PageHeader title="Import contacts" description="Add many contacts at once from a CSV file." breadcrumbs={[{ label: "Contacts", href: "/contacts" }, { label: "Import" }]} />
      <div className="max-w-4xl"><Card><ContactImport groups={groups} /></Card></div>
    </>
  );
}
