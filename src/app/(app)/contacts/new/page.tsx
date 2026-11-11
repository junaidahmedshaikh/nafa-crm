import { ContactForm } from "@/components/directory/contact-form";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";
import { listCompanyOptions } from "@/lib/data/directory";
import { listAssignableGroups } from "@/lib/data/groups";

export const metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: PageProps<"/contacts/new">) {
  const sp = await searchParams;
  const company = Array.isArray(sp.company) ? sp.company[0] : sp.company;
  const { supabase } = await requireMember();
  const [settings, companies, groups] = await Promise.all([getSettings(), listCompanyOptions(supabase), listAssignableGroups(supabase)]);
  return (
    <>
      <PageHeader title="New contact" breadcrumbs={[{ label: "Contacts", href: "/contacts" }, { label: "New contact" }]} />
      <div className="max-w-3xl">
        <ContactForm
          companies={companies}
          groups={groups}
          countryCode={settings.default_country_code}
          defaults={{
            full_name: "", company_id: company && companies.some((c) => c.id === company) ? company : "",
            designation: "", email: "", phone: "", whatsapp: "", communication_notes: "", notes: "", group_ids: [], categories: [], new_company_name: "", new_company_industry: "", new_company_city: "",
          }}
        />
      </div>
    </>
  );
}
