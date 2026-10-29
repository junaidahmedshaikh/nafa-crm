import Link from "next/link";
import { Wallet } from "lucide-react";
import { FilterForm } from "@/components/shared/filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { listPayments } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Payments" };
const METHODS = ["bank_transfer", "upi", "cash", "cheque", "card", "other"];

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const method = METHODS.includes(one(sp.method)) ? one(sp.method) : "";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const voided = one(sp.voided) === "1";
  const { supabase } = await requireMember();
  const { rows, total, pageSize, receivedTotal } = await listPayments(supabase, { q, method, page, includeVoided: voided });
  const href = (n: number) => `/payments?${new URLSearchParams({ ...(q && { q }), ...(method && { method }), ...(voided && { voided: "1" }), page: String(n) })}`;

  return (
    <>
      <PageHeader title="Payments" description="Every payment recorded against an invoice. Record new payments from the invoice itself." />
      <div className="mb-4 rounded-lg border border-border bg-surface p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted">Total received (all non-voided payments)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatINR(receivedTotal, { exact: true })}</p></div>
      <Card>
        <FilterForm basePath="/payments" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Input name="q" aria-label="Search payments" defaultValue={q} placeholder="Search invoice, client, reference…" className="max-w-sm flex-1" />
          <Select name="method" aria-label="Method" defaultValue={method} className="w-44"><option value="">All methods</option>{METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</Select>
          {voided && <input type="hidden" name="voided" value="1" />}
          <Button type="submit" variant="primary" size="sm">Apply</Button>
          <Link href={voided ? "/payments" : "/payments?voided=1"} className="text-sm text-muted hover:text-foreground hover:underline">{voided ? "Hide voided" : "Show voided"}</Link>
        </FilterForm>
        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments yet" description="Payments appear here once you record them on an issued invoice." />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Date</Th><Th>Invoice</Th><Th>Client</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-muted">
                    <Td className="whitespace-nowrap">{formatDate(r.paid_on)}</Td>
                    <Td><Link href={`/invoices/${r.invoice_id}`} className="font-medium hover:text-accent hover:underline">{r.invoice_number}</Link></Td>
                    <Td>{r.client_company || r.client_name}</Td>
                    <Td className="capitalize">{r.method.replace("_", " ")}</Td>
                    <Td>{r.reference ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{r.voided_at ? <Badge>Voided</Badge> : null} {formatINR(r.amount, { exact: true })}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
