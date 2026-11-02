import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { TemplateForm } from "@/components/whatsapp/template-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getWaSettings } from "@/lib/whatsapp/repo";

export const metadata = { title: "New WhatsApp template" };

export default async function NewTemplatePage() {
  const { supabase } = await requireMember();
  const loaded = await guarded(() => getWaSettings(supabase));
  return (
    <>
      <PageHeader title="New template" breadcrumbs={[{ label: "WhatsApp", href: "/whatsapp" }, { label: "Templates", href: "/whatsapp/templates" }, { label: "New" }]} />
      {!loaded.ok ? <SetupNeeded message={loaded.message} /> : (
        <TemplateForm defaults={{ name: "", language: "en", category: "marketing", body: "", footer: "Reply STOP to unsubscribe" }} />
      )}
    </>
  );
}
