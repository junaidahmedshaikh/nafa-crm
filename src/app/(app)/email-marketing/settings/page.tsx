import { EmailSettingsForm } from "@/components/email/email-admin";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { loadEmailSettings } from "@/lib/email/data";

export const metadata = { title: "Email settings" };
export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const { supabase, profile } = await requireMember();
  const settings = await loadEmailSettings(supabase);
  return (
    <>
      <PageHeader title="Email settings" description="Sender identity, compliance footer and sending limits. Provider keys live in server environment variables, never in the browser." />
      <Card><EmailSettingsForm defaults={settings} canEdit={profile.role === "admin"} /></Card>
    </>
  );
}
