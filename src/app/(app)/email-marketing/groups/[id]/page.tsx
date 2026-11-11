import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignStatus, REASON_LABEL, Stat } from "@/components/email/bits";
import { GroupActions, GroupForm, MemberTools, RemoveMember, TypeBadge } from "@/components/email/group-ui";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { isUuid } from "@/lib/actions/util";
import { formatDate } from "@/lib/datetime";
import { loadGroupDetail } from "@/lib/email/group-stats";

export const metadata = { title: "Recipient group" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");

export default async function GroupPage({ params }: PageProps<"/email-marketing/groups/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, profile } = await requireMember();
  const d = await loadGroupDetail(supabase, id);
  if (!d) notFound();
  const { group: g, members, totals: t } = d;
  const isStatic = g.group_type === "static";
  return (
    <>
      <PageHeader
        title={g.name}
        description={g.description || undefined}
        breadcrumbs={[{ label: "Recipient groups", href: "/email-marketing/groups" }, { label: g.name }]}
        actions={<><TypeBadge t={g.group_type} /><GroupActions id={g.id} status={g.status} isAdmin={profile.role === "admin"} name={g.name} redirect /><LinkButton href={`/email-marketing/campaigns/new?group=${g.id}`} variant="primary">Email this group</LinkButton></>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Stat label="Total contacts" value={members.length} />
        <Stat label="Eligible email contacts" value={d.eligible} note={`${d.excluded.length} excluded (no/invalid email, unsubscribed, bounced, duplicates)`} />
        <Stat label="Emails sent" value={t.emailsSent} note={`${t.recipients} people`} />
        <Stat label="Delivery rate" value={t.delivered ? pct(t.delivered, t.recipients) : "—"} note={t.delivered ? `${t.delivered} confirmed` : "Needs the Resend webhook"} />
        <Stat label="Replies" value={t.replies} note={pct(t.replies, t.recipients)} />
        <Stat label="Positive replies" value={t.positive} />
        <Stat label="Meetings requested" value={t.meetings} />
        <Stat label="Opportunities created" value={t.opportunities} />
        <Stat label="Deals won" value={t.won} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Members (${members.length})`} />
          {isStatic ? <MemberTools groupId={g.id} /> : <p className="border-b border-border px-5 py-2 text-xs text-muted">Dynamic group: members are the contacts that currently match the saved conditions. Edit the contact (or the conditions) to change membership.</p>}
          {members.length === 0 ? <EmptyState title="No contacts in this group yet" description={isStatic ? "Search above, or select contacts on the Contacts page and use “Add to group”." : "No contact currently matches the conditions."} /> : (
            <DataTable>
              <thead><tr><Th>Name</Th><Th>Company</Th><Th>Email</Th><Th>City</Th><Th>Email status</Th>{isStatic && <Th />}</tr></thead>
              <tbody>
                {members.slice(0, 200).map((m) => (
                  <tr key={m.id}>
                    <Td><Link href={`/contacts/${m.id}`} className="font-medium hover:underline">{m.fullName}</Link></Td>
                    <Td>{m.companyName ?? "—"}</Td><Td>{m.email ?? "—"}</Td><Td>{m.city ?? "—"}</Td><Td>{m.emailStatus}</Td>
                    {isStatic && <Td><RemoveMember groupId={g.id} contactId={m.id} /></Td>}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          {members.length > 200 && <p className="border-t border-border px-5 py-3 text-xs text-muted">Showing the first 200 of {members.length}.</p>}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <GroupForm initial={{ id: g.id, name: g.name, description: g.description, group_type: g.group_type, business_category: g.business_category, target_industry: g.target_industry, location: g.location, filter_conditions: g.filter_conditions ?? {} }} />
          </Card>
          <Card>
            <CardHeader title="Excluded from emails" />
            {d.excluded.length === 0 ? <EmptyState title="Everyone is emailable" /> : (
              <ul className="divide-y divide-border text-sm">
                {Object.entries(d.excluded.reduce<Record<string, number>>((a, e) => ({ ...a, [e.reason]: (a[e.reason] ?? 0) + 1 }), {})).map(([k, v]) => <li key={k} className="flex justify-between px-5 py-2"><span>{REASON_LABEL[k] ?? k}</span><span className="tabular-nums text-muted">{v}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Campaign history" />
        {d.history.length === 0 ? <EmptyState title="No campaigns have used this group yet" /> : (
          <DataTable>
            <thead><tr><Th>Campaign</Th><Th>Status</Th><Th>Subject</Th><Th>Created</Th></tr></thead>
            <tbody>{d.history.map((c) => <tr key={c.id}><Td><Link href={`/email-marketing/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link></Td><Td><CampaignStatus status={c.status} /></Td><Td className="max-w-xs truncate">{c.subject}</Td><Td>{formatDate(c.created_at)}</Td></tr>)}</tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
