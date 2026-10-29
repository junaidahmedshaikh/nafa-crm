import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ArchiveButton } from "@/components/directory/archive-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, DataTable, DetailList, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getCompany } from "@/lib/data/directory";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";

export const metadata = { title: "Company" };

export default async function CompanyDetailPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const data = await getCompany(supabase, id);
  if (!data) notFound();
  const { company: c, contacts, leads } = data;

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumbs={[{ label: "Companies", href: "/companies" }, { label: c.name }]}
        description={[c.industry, c.city].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {c.archived_at && <Badge>Archived {formatDate(c.archived_at)}</Badge>}
            <LinkButton href={`/companies/${c.id}/edit`}>Edit</LinkButton>
            <ArchiveButton kind="company" id={c.id} name={c.name} archived={!!c.archived_at} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Contacts"
              action={<LinkButton href={`/contacts/new?company=${c.id}`} size="sm"><Plus className="h-4 w-4" aria-hidden />Add contact</LinkButton>}
            />
            {contacts.length === 0 ? (
              <EmptyState title="No contacts for this company" />
            ) : (
              <DataTable>
                <thead><tr><Th>Name</Th><Th>Designation</Th><Th>Email</Th><Th>Phone</Th></tr></thead>
                <tbody>
                  {contacts.map((ct) => (
                    <tr key={ct.id} className="hover:bg-surface-muted">
                      <Td><Link href={`/contacts/${ct.id}`} className="font-medium hover:text-accent hover:underline">{ct.full_name}</Link></Td>
                      <Td>{ct.designation ?? "—"}</Td>
                      <Td>{ct.email ?? "—"}</Td>
                      <Td>{ct.phone ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
          <Card>
            <CardHeader title="Leads" />
            {leads.length === 0 ? (
              <EmptyState title="No leads for this company" />
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
        </div>
        <Card>
          <CardHeader title="Details" />
          <div className="space-y-4 p-5">
            <DetailList
              items={[
                { label: "Website", value: c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{c.website}</a> : null },
                { label: "Industry", value: c.industry },
                { label: "City", value: c.city },
                { label: "Address", value: c.address },
                { label: "Created", value: formatDateTime(c.created_at) },
                { label: "Updated", value: formatDateTime(c.updated_at) },
              ]}
            />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.notes || <span className="text-muted">No notes.</span>}</p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
