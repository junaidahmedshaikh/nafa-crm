import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { TemplateStatusBadge } from "@/components/whatsapp/bits";
import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { listTemplates } from "@/lib/whatsapp/repo";
import { CATEGORY_LABELS } from "@/lib/whatsapp/schemas";

export const metadata = { title: "WhatsApp templates" };

export default async function TemplatesPage({ searchParams }: PageProps<"/whatsapp/templates">) {
  const sp = await searchParams;
  const archived = (Array.isArray(sp.archived) ? sp.archived[0] : sp.archived) === "1";
  const { supabase } = await requireMember();
  const loaded = await guarded(() => listTemplates(supabase, { archived }));
  const crumbs = [{ label: "WhatsApp", href: "/whatsapp" }, { label: "Templates" }];
  const actions = <LinkButton href="/whatsapp/templates/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New template</LinkButton>;
  if (!loaded.ok) return <><PageHeader title="Templates" breadcrumbs={crumbs} /><SetupNeeded message={loaded.message} /></>;
  const rows = loaded.data;

  return (
    <>
      <PageHeader title={archived ? "Archived templates" : "Templates"} breadcrumbs={crumbs} description="Reusable messages with placeholders. WhatsApp approves each template before it can be used for live sending." actions={actions} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={FileText} title={archived ? "No archived templates" : "No templates yet"} description="Write a message once, with placeholders like the person's first name, and reuse it in campaigns." action={!archived ? actions : undefined} />
        ) : (
          <DataTable>
            <thead><tr><Th>Name</Th><Th>Category</Th><Th>Language</Th><Th>Status</Th><Th>Message</Th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-surface-muted">
                  <Td><Link href={`/whatsapp/templates/${t.id}`} className="font-medium hover:text-accent hover:underline">{t.name}</Link></Td>
                  <Td><Badge tone={t.category === "marketing" ? "accent" : "info"}>{CATEGORY_LABELS[t.category]}</Badge></Td>
                  <Td className="text-muted">{t.language}</Td>
                  <Td><TemplateStatusBadge status={t.status} /></Td>
                  <Td className="max-w-md truncate text-muted">{t.body}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <div className="border-t border-border px-5 py-3 text-sm">
          <Link href={archived ? "/whatsapp/templates" : "/whatsapp/templates?archived=1"} className="text-muted hover:text-foreground hover:underline">{archived ? "Show active" : "Show archived"}</Link>
        </div>
      </Card>
    </>
  );
}
