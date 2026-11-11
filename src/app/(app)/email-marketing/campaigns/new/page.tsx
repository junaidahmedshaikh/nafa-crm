import { CampaignWizard } from "@/components/email/campaign-wizard";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { loadEmailSettings } from "@/lib/email/data";
import { loadGroupSummaries } from "@/lib/email/group-stats";

export const metadata = { title: "Create campaign" };
export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: PageProps<"/email-marketing/campaigns/new">) {
  const sp = await searchParams;
  const groupParam = Array.isArray(sp.group) ? sp.group[0] : sp.group;
  const { supabase, profile } = await requireMember();
  const [settings, { data: templates }, summaries] = await Promise.all([
    loadEmailSettings(supabase),
    supabase.from("email_templates").select("id, name, category, subject, body_html").order("is_system", { ascending: false }).order("name"),
    loadGroupSummaries(supabase),
  ]);
  const groups = summaries.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name, type: g.group_type, contacts: g.contacts, eligible: g.eligible }));
  return (
    <>
      <PageHeader title="Create campaign" description="Select recipients, write with AI, edit every word, preview, then save as a draft. Nothing is sent from here." />
      <CampaignWizard
        templates={templates ?? []}
        groups={groups}
        defaults={{ senderName: settings.sender_name, senderEmail: settings.sender_email, replyTo: settings.reply_to, signatureHtml: settings.signature_html }}
        initial={{ name: "", objective: "", subject: "", bodyHtml: "", style: "professional", senderName: "", senderEmail: "", replyTo: "", salespersonName: profile.full_name, audience: groupParam && groups.some((g) => g.id === groupParam) ? { groupIds: [groupParam] } : {}, fallbacks: {}, dailyLimit: null }}
      />
    </>
  );
}
