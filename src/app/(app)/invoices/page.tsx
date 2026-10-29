import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { DocListFilter } from "@/components/documents/list-filter";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { LinkButton } from "@/components/ui/button";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { INVOICE_STATUSES, listInvoices, parseListParams } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const p = parseListParams(await searchParams, INVOICE_STATUSES);
  const { supabase } = await requireMember();
  const { rows, total, pageSize } = await listInvoices(supabase, p);
  const href = (n: number) => `/invoices?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(p.status && { status: p.status }), page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        description={`${total} ${p.q || p.status ? "matching" : "total"}`}
        actions={<LinkButton href="/invoices/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New invoice</LinkButton>}
      />
      <Card>
        <DocListFilter basePath="/invoices" q={p.q} status={p.status} statuses={INVOICE_STATUSES} placeholder="Search number, client, project, quotation…" />
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={p.q || p.status ? "No invoices match" : "No invoices yet"}
            description={p.q || p.status ? "Try a different search or filter." : "Convert an accepted quotation, or create an invoice from scratch."}
            action={!p.q && !p.status ? <LinkButton href="/invoices/new" variant="primary">New invoice</LinkButton> : undefined}
          />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Invoice</Th><Th>Client</Th><Th>Project</Th><Th>Date</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-muted">
                    <Td><Link href={`/invoices/${i.id}`} className="font-medium hover:text-accent hover:underline">{i.number ?? "Draft"}</Link>{i.quotation_number && <p className="text-xs text-muted">from {i.quotation_number}</p>}</Td>
                    <Td>{i.client_company || i.client_name || "—"}</Td>
                    <Td>{i.project_name || "—"}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(i.invoice_date)}</Td>
                    <Td className={cn("whitespace-nowrap", i.payment_status === "overdue" ? "font-medium text-danger" : "text-muted")}>{i.due_date ? formatDate(i.due_date) : "—"}</Td>
                    <Td className="text-right tabular-nums">{formatINR(i.grand_total, { exact: true })}</Td>
                    <Td className="text-right tabular-nums">{i.number && i.payment_status !== "cancelled" ? formatINR(i.balance_due, { exact: true }) : "—"}</Td>
                    <Td><DocStatusBadge status={i.payment_status} /></Td>
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
