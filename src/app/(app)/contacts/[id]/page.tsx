import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteContactButton } from "@/components/directory/delete-contact-button";
import { ContactGroups } from "@/components/email/contact-groups";
import { ArchiveButton } from "@/components/directory/archive-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, DataTable, DetailList, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { ScheduleEmailButton } from "@/components/scheduled/schedule-dialog";
import { requireMember } from "@/lib/auth";
import { getContact } from "@/lib/data/directory";
import { contactGroupIds, listAssignableGroups } from "@/lib/data/groups";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";

export const metadata = { title: "Contact" };

export default async function ContactDetailPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireMember();
  const data = await getContact(supabase, id);
  if (!data) notFound();
  const { contact: c, leads } = data;
  const [groups, groupIds] = await Promise.all([listAssignableGroups(supabase), contactGroupIds(supabase, id)]);

  return (
    <>
      <PageHeader
        title={c.full_name}
        breadcrumbs={[{ label: "Contacts", href: "/contacts" }, { label: c.full_name }]}
        description={[c.designation, c.company_name].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {c.archived_at && <Badge>Archived {formatDate(c.archived_at)}</Badge>}
            {!c.archived_at && <ScheduleEmailButton type="contact" id={c.id} />}
            <LinkButton href={`/contacts/${c.id}/edit`}>Edit</LinkButton>
            {profile.role === "admin" && <DeleteContactButton id={c.id} name={c.full_name} leadCount={leads.length} />}
            <ArchiveButton kind="contact" id={c.id} name={c.full_name} archived={!!c.archived_at} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Leads" />
          {leads.length === 0 ? (
            <EmptyState title="No leads for this contact" />
          ) : (
            <DataTable>
              <thead><tr><Th>Lead</Th><Th>Status</Th><Th className="text-right">Expected revenue</Th><Th>Created</Th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link href={`/leads/${l.id}`} className="font-medium hover:text-accent hover:underline">{l.title}</Link>
                      <p className="text-xs text-muted">{formatLeadNumber(l.lead_number)}</p>
                    </Td>
                    <Td><StatusBadge status={l.status} /></Td>
                    <Td className="text-right tabular-nums">{formatINR(l.expected_revenue_inr)}</Td>
                    <Td className="text-muted">{formatDate(l.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
        <Card>
          <CardHeader title="Details" />
          <div className="space-y-4 p-5">
            <DetailList
              items={[
                { label: "Company", value: c.company_id ? <Link href={`/companies/${c.company_id}`} className="text-accent hover:underline">{c.company_name}</Link> : null },
                { label: "Email", value: c.email ? <a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a> : null },
                { label: "Phone", value: c.phone ? <a href={`tel:${c.phone}`} className="text-accent hover:underline">{c.phone}</a> : null },
                { label: "WhatsApp", value: c.whatsapp },
                { label: "Created", value: formatDateTime(c.created_at) },
                { label: "Updated", value: formatDateTime(c.updated_at) },
              ]}
            />
            {c.communication_notes && (
              <div className="rounded-md bg-warning-soft px-3 py-2 text-sm">
                <span className="font-medium text-warning">Communication preferences: </span>{c.communication_notes}
              </div>
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.notes || <span className="text-muted">No notes.</span>}</p>
            </div>
          </div>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader title="Recipient groups" />
          <ContactGroups contactId={c.id} groups={groups} initial={groupIds} />
        </Card>
      </div>
    </>
  );
}
