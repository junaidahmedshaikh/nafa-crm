import { notFound } from "next/navigation";
import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, getTeam, requireMember } from "@/lib/auth";
import { getLead } from "@/lib/data/leads";
import { listCompanyOptions } from "@/lib/data/directory";
import { isoToIstLocal } from "@/lib/datetime";
import type { LeadFormInput } from "@/lib/validation/schemas";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: PageProps<"/leads/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const lead = await getLead(supabase, id);
  if (!lead) notFound();
  const [settings, team, companies] = await Promise.all([getSettings(), getTeam(), listCompanyOptions(supabase)]);

  const defaults: LeadFormInput = {
    title: lead.title, company_name: lead.company_name ?? "", website: lead.company_website ?? "",
    contact_name: lead.contact_name ?? "", designation: lead.contact_designation ?? "",
    email: lead.contact_email ?? "", phone: lead.contact_phone ?? "", whatsapp: lead.contact_whatsapp ?? "",
    source: lead.source, service_category: lead.service_category, event_name: lead.event_name ?? "",
    event_date: lead.event_date ?? "", city: lead.city ?? "", venue: lead.venue ?? "",
    budget_inr: lead.budget_inr?.toString() ?? "", expected_revenue_inr: lead.expected_revenue_inr?.toString() ?? "",
    status: lead.status, priority: lead.priority, assigned_to: lead.assigned_to ?? "",
    last_contact_date: isoToIstLocal(lead.last_contact_at).slice(0, 10), notes: lead.notes ?? "",
    lost_reason: lead.lost_reason ?? "", first_follow_up_at: "",
  };
  return (
    <>
      <PageHeader
        title={`Edit: ${lead.title}`}
        breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: lead.title, href: `/leads/${lead.id}` }, { label: "Edit" }]}
      />
      <div className="max-w-4xl">
        <LeadForm
          mode="edit"
          leadId={lead.id}
          defaults={defaults}
          team={team}
          companyNames={companies.map((c) => c.name)}
          countryCode={settings.default_country_code}
        />
      </div>
    </>
  );
}
