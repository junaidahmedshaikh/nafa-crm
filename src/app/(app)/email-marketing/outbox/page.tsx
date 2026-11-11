import Link from "next/link";
import { CampaignStatus, REASON_LABEL } from "@/components/email/bits";
import { Card, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const metadata = { title: "Outbox & sent" };
export const dynamic = "force-dynamic";
const TABS = [["scheduled", "Scheduled"], ["pending", "Outbox (queued)"], ["sent", "Sent"], ["failed", "Failed"]] as const;

export default async function OutboxPage({ searchParams }: PageProps<"/email-marketing/outbox">) {
  const sp = await searchParams;
  const t = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "scheduled";
  const tab = TABS.some(([k]) => k === t) ? t : "scheduled";
  const { supabase } = await requireMember();
  const campaigns = tab === "scheduled" ? (await supabase.from("email_campaigns").select("id, name, status, scheduled_at, subject").in("status", ["scheduled", "sending", "paused"]).order("scheduled_at")).data ?? [] : [];
  const rcpts = tab !== "scheduled"
    ? (await supabase.from("email_recipients").select("email, full_name, status, skip_reason, last_error, sent_at, next_attempt_at, campaign_id, campaign:email_campaigns(name)").eq("status", tab).order(tab === "sent" ? "sent_at" : "created_at", { ascending: false }).limit(200)).data ?? []
    : [];
  return (
    <>
      <PageHeader title="Outbox & sent" />
      <div className="mb-4 flex gap-2 text-sm">
        {TABS.map(([k, l]) => <Link key={k} href={`/email-marketing/outbox?tab=${k}`} className={cn("rounded-md px-3 py-1.5", tab === k ? "bg-foreground/10 font-medium" : "text-muted hover:text-foreground")}>{l}</Link>)}
      </div>
      <Card>
        {tab === "scheduled" ? (
          campaigns.length === 0 ? <EmptyState title="No scheduled campaigns" /> : (
            <DataTable><thead><tr><Th>Campaign</Th><Th>Status</Th><Th>Starts</Th></tr></thead><tbody>
              {campaigns.map((c) => <tr key={c.id}><Td><Link className="font-medium hover:underline" href={`/email-marketing/campaigns/${c.id}`}>{c.name}</Link><p className="text-xs text-muted">{c.subject}</p></Td><Td><CampaignStatus status={c.status} /></Td><Td>{formatDateTime(c.scheduled_at)}</Td></tr>)}
            </tbody></DataTable>
          )
        ) : rcpts.length === 0 ? <EmptyState title="Nothing here" /> : (
          <DataTable><thead><tr><Th>Recipient</Th><Th>Campaign</Th><Th>{tab === "sent" ? "Sent" : "Detail"}</Th></tr></thead><tbody>
            {rcpts.map((r, i) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const camp: any = Array.isArray(r.campaign) ? r.campaign[0] : r.campaign;
              return <tr key={i}><Td>{r.full_name}<p className="text-xs text-muted">{r.email}</p></Td><Td><Link className="hover:underline" href={`/email-marketing/campaigns/${r.campaign_id}`}>{camp?.name}</Link></Td><Td>{tab === "sent" ? formatDateTime(r.sent_at) : <>{r.skip_reason ? REASON_LABEL[r.skip_reason] ?? r.skip_reason : ""}{r.last_error && <span className="text-danger"> {r.last_error}</span>}{r.next_attempt_at && <span className="text-muted"> retry {formatDateTime(r.next_attempt_at)}</span>}</>}</Td></tr>;
            })}
          </tbody></DataTable>
        )}
      </Card>
    </>
  );
}
