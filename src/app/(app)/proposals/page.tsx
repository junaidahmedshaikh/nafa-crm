import Link from "next/link";
import { Plus, Presentation } from "lucide-react";
import { DocListFilter } from "@/components/documents/list-filter";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { listProposals, parseListParams, PROPOSAL_STATUSES } from "@/lib/documents/repo";

export const metadata = { title: "Proposals" };

export default async function ProposalsPage({ searchParams }: PageProps<"/proposals">) {
  const p = parseListParams(await searchParams, PROPOSAL_STATUSES);
  const { supabase } = await requireMember();
  const { rows, total, pageSize } = await listProposals(supabase, p);
  const href = (n: number) => `/proposals?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(p.status && { status: p.status }), page: String(n) })}`;
  return (
    <>
      <PageHeader
        title="Proposals"
        description={`${total} ${p.q || p.status ? "matching" : "total"}`}
        actions={<LinkButton href="/proposals/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New proposal</LinkButton>}
      />
      <Card>
        <DocListFilter basePath="/proposals" q={p.q} status={p.status} statuses={PROPOSAL_STATUSES} placeholder="Search number, title, client…" />
        {rows.length === 0 ? (
          <EmptyState
            icon={Presentation}
            title={p.q || p.status ? "No proposals match" : "No proposals yet"}
            description={p.q || p.status ? "Try a different search or filter." : "Build a multi-section proposal for an event, activation or campaign."}
            action={!p.q && !p.status ? <LinkButton href="/proposals/new" variant="primary">New proposal</LinkButton> : undefined}
          />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Proposal</Th><Th>Title</Th><Th>Client</Th><Th>Date</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted">
                    <Td><Link href={`/proposals/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.number ?? "Draft"}</Link></Td>
                    <Td>{r.title || "—"}</Td>
                    <Td>{r.client_company || r.client_name || "—"}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(r.proposal_date)}</Td>
                    <Td><DocStatusBadge status={r.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={p.page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
