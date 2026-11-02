import { notFound } from "next/navigation";
import { ContactForm } from "@/components/directory/contact-form";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";
import { getContact, listCompanyOptions } from "@/lib/data/directory";
import { whatsappReady } from "@/lib/whatsapp/repo";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: PageProps<"/contacts/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const data = await getContact(supabase, id);
  if (!data) notFound();
  const [settings, companies, consentEnabled] = await Promise.all([getSettings(), listCompanyOptions(supabase), whatsappReady(supabase)]);
  const c = data.contact;
  return (
    <>
      <PageHeader
        title={`Edit: ${c.full_name}`}
        breadcrumbs={[{ label: "Contacts", href: "/contacts" }, { label: c.full_name, href: `/contacts/${c.id}` }, { label: "Edit" }]}
      />
      <div className="max-w-3xl">
        <ContactForm
          contactId={c.id}
          companies={companies}
          consentEnabled={consentEnabled}
          countryCode={settings.default_country_code}
          defaults={{
            full_name: c.full_name, company_id: c.company_id ?? "", designation: c.designation ?? "", email: c.email ?? "",
            phone: c.phone ?? "", whatsapp: c.whatsapp ?? "", communication_notes: c.communication_notes ?? "", notes: c.notes ?? "",
            whatsapp_consent: c.whatsapp_consent ?? "unknown", whatsapp_consent_source: c.whatsapp_consent_source ?? "",
          }}
        />
      </div>
    </>
  );
}
