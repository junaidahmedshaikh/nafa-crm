import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { DocListFilter } from "@/components/documents/list-filter";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { listQuotations, parseListParams, QUOTATION_STATUSES } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  const p = parseListParams(await searchParams, QUOTATION_STATUSES);
  const { supabase } = await requireMember();
  const { rows, total, pageSize } = await listQuotations(supabase, p);
  const href = (n: number) => `/quotations?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(p.status && { status: p.status }), page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="Quotations"
        description={`${total} ${p.q || p.status ? "matching" : "total"}`}
        actions={<LinkButton href="/quotations/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New quotation</LinkButton>}
      />
      <Card>
        <DocListFilter basePath="/quotations" q={p.q} status={p.status} statuses={QUOTATION_STATUSES} placeholder="Search number, client, event…" />
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={p.q || p.status ? "No quotations match" : "No quotations yet"}
            description={p.q || p.status ? "Try a different search or filter." : "Create a quotation from a lead, or start a blank one."}
            action={!p.q && !p.status ? <LinkButton href="/quotations/new" variant="primary">New quotation</LinkButton> : undefined}
          />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Quotation</Th><Th>Client</Th><Th>Event</Th><Th>Date</Th><Th>Valid until</Th><Th className="text-right">Total</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="hover:bg-surface-muted">
                    <Td><Link href={`/quotations/${q.id}`} className="font-medium hover:text-accent hover:underline">{q.number ?? "Draft"}</Link>{q.invoice_count > 0 && <p className="text-xs text-muted">{q.invoice_count} invoice{q.invoice_count === 1 ? "" : "s"}</p>}</Td>
                    <Td>{q.client_company || q.client_name || "—"}{q.client_company && q.client_name && <p className="text-xs text-muted">{q.client_name}</p>}</Td>
                    <Td>{q.event_name || "—"}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(q.quotation_date)}</Td>
                    <Td className="whitespace-nowrap text-muted">{q.valid_until ? formatDate(q.valid_until) : "—"}</Td>
                    <Td className="text-right tabular-nums">{formatINR(q.grand_total, { exact: true })}</Td>
                    <Td><DocStatusBadge status={q.effective_status} /></Td>
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
