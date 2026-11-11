import { notFound, redirect } from "next/navigation";
import { CampaignWizard } from "@/components/email/campaign-wizard";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { isUuid } from "@/lib/actions/util";
import { loadEmailSettings } from "@/lib/email/data";
import { loadGroupSummaries } from "@/lib/email/group-stats";

export const metadata = { title: "Edit campaign" };
export const dynamic = "force-dynamic";

export default async function EditCampaignPage({ params }: PageProps<"/email-marketing/campaigns/[id]/edit">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireMember();
  const [{ data: c }, settings, { data: templates }, summaries] = await Promise.all([
    supabase.from("email_campaigns").select("*").eq("id", id).maybeSingle(),
    loadEmailSettings(supabase),
    supabase.from("email_templates").select("id, name, category, subject, body_html").order("is_system", { ascending: false }).order("name"),
    loadGroupSummaries(supabase),
  ]);
  if (!c) notFound();
  if (c.status !== "draft") redirect(`/email-marketing/campaigns/${id}`);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _stats, ...filters } = (c.audience ?? {}) as Record<string, unknown>;
  return (
    <>
      <PageHeader title={`Edit: ${c.name}`} breadcrumbs={[{ label: "Campaigns", href: "/email-marketing/campaigns" }, { label: c.name, href: `/email-marketing/campaigns/${id}` }, { label: "Edit" }]} />
      <CampaignWizard
        templates={templates ?? []}
        groups={summaries.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name, type: g.group_type, contacts: g.contacts, eligible: g.eligible }))}
        defaults={{ senderName: settings.sender_name, senderEmail: settings.sender_email, replyTo: settings.reply_to, signatureHtml: settings.signature_html }}
        initial={{ id, name: c.name, objective: c.objective, subject: c.subject, bodyHtml: c.body_html, style: c.style, senderName: c.sender_name, senderEmail: c.sender_email, replyTo: c.reply_to, salespersonName: c.salesperson_name, audience: filters, fallbacks: c.fallbacks ?? {}, dailyLimit: c.daily_limit, templateId: c.template_id }}
      />
    </>
  );
}
