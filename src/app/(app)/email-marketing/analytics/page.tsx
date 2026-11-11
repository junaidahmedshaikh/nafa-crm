import { Stat } from "@/components/email/bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { buildAnalytics, loadAnalyticsInput, MIN_SAMPLE, type Row } from "@/lib/email/analytics";
import { REPLY_LABEL, type ReplyCategory } from "@/lib/email/reply-categories";

export const metadata = { title: "Email analytics" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");

function Table({ title, rows, note }: { title: string; rows: Row[]; note?: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {note && <p className="border-b border-border px-5 py-2 text-xs text-muted">{note}</p>}
      {rows.length === 0 ? <EmptyState title="No data yet" /> : (
        <DataTable>
          <thead><tr><Th>Name</Th><Th>People</Th><Th>Delivered</Th><Th>Bounced</Th><Th>Opened*</Th><Th>Clicked</Th><Th>Replies</Th><Th>Positive</Th><Th>Leads</Th><Th>Won</Th></tr></thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <tr key={r.key}>
                <Td className="max-w-xs truncate">{r.label}</Td><Td className="tabular-nums">{r.recipients}</Td><Td className="tabular-nums">{r.delivered}</Td>
                <Td className="tabular-nums">{r.bounced}</Td><Td className="tabular-nums">{r.opened}</Td><Td className="tabular-nums">{r.clicked}</Td>
                <Td className="tabular-nums">{r.replies} <span className="text-xs text-muted">({pct(r.replies, r.recipients)})</span></Td>
                <Td className="tabular-nums">{r.positive}</Td><Td className="tabular-nums">{r.leads}</Td><Td className="tabular-nums">{r.won}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}

export default async function AnalyticsPage() {
  const { supabase } = await requireMember();
  const a = buildAnalytics(await loadAnalyticsInput(supabase));
  const t = a.totals;
  return (
    <>
      <PageHeader title="Email analytics" description="Counts come from sending records, provider events and logged replies. Nothing is estimated." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Stat label="People emailed" value={t.recipients} note={`${t.emailsSent} emails incl. follow-ups`} />
        <Stat label="Delivered (confirmed)" value={t.delivered} note={t.delivered ? pct(t.delivered, t.recipients) : "Needs the Resend webhook"} />
        <Stat label="Bounced" value={t.bounced} />
        <Stat label="Opened*" value={t.opened} note="Only where the provider reports it" />
        <Stat label="Clicked" value={t.clicked} />
        <Stat label="Replies" value={t.replies} note={pct(t.replies, t.recipients)} />
        <Stat label="Positive replies" value={t.positive} />
        <Stat label="Meetings requested" value={t.meetings} />
        <Stat label="Leads created" value={t.leads} />
        <Stat label="Opportunities / won" value={`${t.opportunities} / ${t.won}`} note="Leads qualified or beyond / won" />
      </div>
      <p className="mb-6 text-xs text-muted">*Opens are unreliable: mail apps can pre-load images and many people block them, so treat open numbers as indicative only. Delivered, bounced, opened and clicked appear only after the Resend webhook is connected (and tracking is enabled on your domain).</p>

      {a.abTests.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="A/B test results" />
          <div className="divide-y divide-border">
            {a.abTests.map((x) => (
              <div key={x.campaignId} className="px-5 py-3 text-sm">
                <p className="font-medium">{x.name} {x.winner ? <Badge tone="success">Version {x.winner} leads</Badge> : <Badge tone="warning">{x.enough ? "No clear winner" : `Not enough data (needs ${MIN_SAMPLE}+ per version)`}</Badge>}</p>
                <ul className="mt-1 text-xs text-muted">{x.rows.map((r) => <li key={r.label}>Version {r.label}: {r.recipients} sent · {r.replies} replies ({pct(r.replies, r.recipients)}) · {r.positive} positive · {r.clicked} clicks</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-6">
        <Table title="Campaign comparison" rows={a.byCampaign} />
        <Table title="Subject line performance" rows={a.bySubject} note="Small samples are noise — compare only with a meaningful number of recipients." />
        <Table title="Recipient category" rows={a.byCategory} />
        <Table title="Industry" rows={a.byIndustry} />
        <Table title="City" rows={a.byCity} />
        <Table title="Template" rows={a.byTemplate} />
        <Card>
          <CardHeader title="Reply classification" />
          {Object.keys(a.replyCategories).length === 0 ? <EmptyState title="No replies yet" /> : (
            <ul className="divide-y divide-border text-sm">
              {Object.entries(a.replyCategories).sort((x, y) => y[1] - x[1]).map(([k, v]) => <li key={k} className="flex justify-between px-5 py-2.5"><span>{REPLY_LABEL[k as ReplyCategory] ?? "Needs review"}</span><span className="tabular-nums text-muted">{v}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
