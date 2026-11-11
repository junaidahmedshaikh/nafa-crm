import Link from "next/link";
import { Mail, Plus } from "lucide-react";
import { CampaignStatus, Progress } from "@/components/email/bits";
import { LinkButton } from "@/components/ui/button";
import { Card, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { emptyCounts, recipientCounts } from "@/lib/email/data";

export const metadata = { title: "All campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const { supabase } = await requireMember();
  const { data } = await supabase.from("email_campaigns").select("id, name, status, subject, scheduled_at, created_at").order("created_at", { ascending: false }).limit(200);
  const campaigns = data ?? [];
  const counts = await recipientCounts(supabase, campaigns.map((c) => c.id));
  return (
    <>
      <PageHeader title="All campaigns" actions={<LinkButton href="/email-marketing/campaigns/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />Create campaign</LinkButton>} />
      <Card>
        {campaigns.length === 0 ? <EmptyState icon={Mail} title="No campaigns yet" description="Create your first campaign to reach wedding planners, agencies and corporates." /> : (
          <DataTable>
            <thead><tr><Th>Campaign</Th><Th>Status</Th><Th>Recipients</Th><Th>Progress</Th><Th>Schedule</Th><Th>Created</Th></tr></thead>
            <tbody>
              {campaigns.map((c) => {
                const k = counts.get(c.id) ?? emptyCounts();
                return (
                  <tr key={c.id}>
                    <Td><Link href={`/email-marketing/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><p className="max-w-xs truncate text-xs text-muted">{c.subject}</p></Td>
                    <Td><CampaignStatus status={c.status} /></Td>
                    <Td className="tabular-nums">{k.total}</Td>
                    <Td><Progress counts={k} /></Td>
                    <Td>{c.scheduled_at ? formatDateTime(c.scheduled_at) : "—"}</Td>
                    <Td>{formatDateTime(c.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
