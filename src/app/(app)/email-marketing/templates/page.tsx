import { TemplateManager } from "@/components/email/email-admin";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { loadEmailSettings } from "@/lib/email/data";

export const metadata = { title: "Email templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { supabase } = await requireMember();
  const [{ data }, settings] = await Promise.all([
    supabase.from("email_templates").select("id, name, category, subject, body_html, is_system").order("is_system", { ascending: false }).order("name"),
    loadEmailSettings(supabase),
  ]);
  return (
    <>
      <PageHeader title="Email templates" description="Create reusable email templates, or save any campaign email as a template from the editor." />
      <TemplateManager templates={data ?? []} signatureHtml={settings.signature_html} />
    </>
  );
}
