import Link from "next/link";
import { FileText, MessageSquareText, Plus, Settings2 } from "lucide-react";
import { CampaignStatusBadge, ModeBadge } from "@/components/whatsapp/bits";
import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { consentTotals, getWaSettings, listCampaigns, sentLast24h, totalOf } from "@/lib/whatsapp/repo";

export const metadata = { title: "WhatsApp" };

export default async function WhatsAppPage({ searchParams }: PageProps<"/whatsapp">) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page)) || 1);
  const { supabase } = await requireMember();
  const loaded = await guarded(async () => {
    const [settings, consent, used, campaigns] = await Promise.all([getWaSettings(supabase), consentTotals(supabase), sentLast24h(supabase), listCampaigns(supabase, page)]);
    return { settings, consent, used, campaigns };
  });

  const header = (
    <PageHeader
      title="WhatsApp"
      description="Send personalised messages to people who have agreed to receive them."
      actions={
        <>
          <LinkButton href="/whatsapp/templates"><FileText className="h-4 w-4" aria-hidden />Templates</LinkButton>
          <LinkButton href="/whatsapp/settings"><Settings2 className="h-4 w-4" aria-hidden />Settings</LinkButton>
          <LinkButton href="/whatsapp/campaigns/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New campaign</LinkButton>
        </>
      }
    />
  );
  if (!loaded.ok) return <>{header}<SetupNeeded message={loaded.message} /></>;
  const { settings, consent, used, campaigns } = loaded.data;
  const usedPct = Math.min(100, Math.round((used / settings.daily_limit) * 100));

  return (
    <>
      {header}
      {settings.mode === "dry_run" ? (
        <p className="mb-5 rounded-md border border-info/20 bg-info-soft px-4 py-2.5 text-sm text-info" role="status">
          <strong>Dry-run mode.</strong> Campaigns are rehearsed end to end but nothing is sent to anyone. An admin switches to live in Settings once your WhatsApp Business account is connected.
        </p>
      ) : (
        <p className="mb-5 rounded-md border border-danger/20 bg-danger-soft px-4 py-2.5 text-sm text-danger" role="status"><strong>Live mode.</strong> Campaigns send real WhatsApp messages.</p>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted">Opted in</p><p className="mt-1 text-2xl font-semibold tabular-nums">{consent.opted_in}</p><p className="text-xs text-muted">can be messaged</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Consent not recorded</p><p className="mt-1 text-2xl font-semibold tabular-nums">{consent.unknown}</p><p className="text-xs text-muted">will be skipped</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Opted out</p><p className="mt-1 text-2xl font-semibold tabular-nums">{consent.opted_out}</p><p className="text-xs text-muted">never messaged</p></Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Sent in the last 24 hours</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{used}<span className="text-sm font-normal text-muted"> / {settings.daily_limit}</span></p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of daily limit used">
            <div className={`h-full rounded-full ${usedPct >= 90 ? "bg-danger" : usedPct >= 75 ? "bg-warning" : "bg-accent"}`} style={{ width: `${usedPct}%` }} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Campaigns" />
        {campaigns.rows.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="No campaigns yet" description="Write a template, record who has agreed to hear from you, then create your first campaign." action={<LinkButton href="/whatsapp/campaigns/new" variant="primary">New campaign</LinkButton>} />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Campaign</Th><Th>Template</Th><Th>Status</Th><Th className="text-right">Sent / total</Th><Th className="text-right">Failed</Th><Th>Created</Th></tr></thead>
              <tbody>
                {campaigns.rows.map((c) => {
                  const total = totalOf(c.counts);
                  const sent = (c.counts.sent ?? 0) + (c.counts.delivered ?? 0) + (c.counts.read ?? 0);
                  return (
                    <tr key={c.id} className="hover:bg-surface-muted">
                      <Td><Link href={`/whatsapp/campaigns/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.name}</Link> <ModeBadge mode={c.mode} /></Td>
                      <Td className="text-muted">{c.template?.name ?? "—"}</Td>
                      <Td><CampaignStatusBadge status={c.status} /></Td>
                      <Td className="text-right tabular-nums">{sent} / {total}</Td>
                      <Td className="text-right tabular-nums">{(c.counts.failed ?? 0) > 0 ? <Badge tone="danger">{c.counts.failed}</Badge> : "—"}</Td>
                      <Td className="whitespace-nowrap text-muted">{formatDateTime(c.created_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={campaigns.pageSize} total={campaigns.total} hrefFor={(p) => `/whatsapp?page=${p}`} />
          </>
        )}
      </Card>
    </>
  );
}
