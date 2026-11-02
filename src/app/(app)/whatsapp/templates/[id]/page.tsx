import { notFound } from "next/navigation";
import { TemplateArchiveButton, TemplateStatusControl } from "@/components/whatsapp/template-actions";
import { TemplateStatusBadge } from "@/components/whatsapp/bits";
import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { TemplateForm } from "@/components/whatsapp/template-form";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getTemplate } from "@/lib/whatsapp/repo";

export const metadata = { title: "WhatsApp template" };

export default async function TemplateDetailPage({ params }: PageProps<"/whatsapp/templates/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireMember();
  const loaded = await guarded(() => getTemplate(supabase, id));
  if (!loaded.ok) return <><PageHeader title="Template" breadcrumbs={[{ label: "WhatsApp", href: "/whatsapp" }, { label: "Templates", href: "/whatsapp/templates" }, { label: "Template" }]} /><SetupNeeded message={loaded.message} /></>;
  const t = loaded.data;
  if (!t) notFound();

  return (
    <>
      <PageHeader
        title={t.name}
        breadcrumbs={[{ label: "WhatsApp", href: "/whatsapp" }, { label: "Templates", href: "/whatsapp/templates" }, { label: t.name }]}
        actions={<>{t.archived_at && <Badge>Archived</Badge>}<TemplateStatusBadge status={t.status} /><TemplateArchiveButton id={t.id} archived={!!t.archived_at} /></>}
      />
      {t.status === "rejected" && t.rejection_reason && (
        <p className="mb-5 rounded-md border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger" role="alert"><strong>Rejected by WhatsApp:</strong> {t.rejection_reason}</p>
      )}
      <div className="space-y-6">
        <TemplateForm
          key={t.updated_at}
          templateId={t.id}
          defaults={{ name: t.name, language: t.language, category: t.category, body: t.body, footer: t.footer ?? "" }}
        />
        {profile.role === "admin" && <TemplateStatusControl key={`${t.status}-${t.updated_at}`} id={t.id} status={t.status} reason={t.rejection_reason} />}
      </div>
    </>
  );
}
