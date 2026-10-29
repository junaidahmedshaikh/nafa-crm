import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/ui/layout";
import { getSettings, getTeam, requireMember } from "@/lib/auth";
import { listCompanyOptions } from "@/lib/data/directory";
import type { LeadFormInput } from "@/lib/validation/schemas";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const { supabase, user } = await requireMember();
  const [settings, team, companies] = await Promise.all([getSettings(), getTeam(), listCompanyOptions(supabase)]);
  const defaults: LeadFormInput = {
    title: "", company_name: "", website: "", contact_name: "", designation: "", email: "", phone: "", whatsapp: "",
    source: "other", service_category: "other", event_name: "", event_date: "", city: "", venue: "",
    budget_inr: "", expected_revenue_inr: "", status: "new", priority: "medium", assigned_to: user.id,
    last_contact_date: "", notes: "", lost_reason: "", first_follow_up_at: "",
  };
  return (
    <>
      <PageHeader title="New lead" breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: "New lead" }]} />
      <div className="max-w-4xl">
        <LeadForm
          mode="create"
          defaults={defaults}
          team={team}
          companyNames={companies.map((c) => c.name)}
          countryCode={settings.default_country_code}
        />
      </div>
    </>
  );
}
