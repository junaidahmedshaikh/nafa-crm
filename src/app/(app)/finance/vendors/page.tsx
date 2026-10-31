import Link from "next/link";
import { Store } from "lucide-react";
import { NoFinanceAccess, PaymentStatusBadge, StatCard } from "@/components/finance/bits";
import { FilterForm } from "@/components/shared/filter-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { getFinanceAccess, listVendorPayables, listVendors } from "@/lib/finance/repo";
import { MODE_LABELS } from "@/lib/finance/schemas";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Vendor payments" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function VendorsPage({ searchParams }: PageProps<"/finance/vendors">) {
  const sp = await searchParams;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.manage) return <><PageHeader title="Vendor payments" /><NoFinanceAccess /></>;
  const vendor = one(sp.vendor);
  const unpaidOnly = one(sp.unpaid) !== "0";
  const [vendors, bills] = await Promise.all([listVendors(supabase), listVendorPayables(supabase, { vendor, unpaidOnly })]);

  const total = bills.reduce((a, b) => a + Number(b.total_amount), 0);
  const paid = bills.reduce((a, b) => a + Number(b.paid_amount), 0);
  const overdue = bills.filter((b) => b.payment_status === "overdue").reduce((a, b) => a + Number(b.outstanding_amount), 0);

  // Vendor-wise payment history (only when one vendor is selected).
  const history = vendor && bills.length
    ? ((await supabase.from("expense_payments").select("id, expense_id, paid_on, amount, method, reference, voided_at").in("expense_id", bills.map((b) => b.expense_id)).order("paid_on", { ascending: false })).data ?? [])
    : [];
  const billNo = Object.fromEntries(bills.map((b) => [b.expense_id, b]));

  return (
    <>
      <PageHeader title="Vendor payments" description="Every vendor bill across projects, with what has been paid and what is still owed. Record payments from the project's Expenses tab." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Billed" value={formatINR(total)} />
        <StatCard label="Paid" value={formatINR(paid)} />
        <StatCard label="Outstanding" value={formatINR(total - paid)} tone={total - paid > 0 ? "bad" : "neutral"} />
        <StatCard label="Overdue" value={formatINR(overdue)} tone={overdue > 0 ? "bad" : "neutral"} />
      </div>
      <Card>
        <FilterForm basePath="/finance/vendors" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Select name="vendor" aria-label="Vendor" defaultValue={vendor} className="w-60"><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
          <Select name="unpaid" aria-label="Show" defaultValue={unpaidOnly ? "1" : "0"} className="w-44"><option value="1">Unpaid bills only</option><option value="0">All bills</option></Select>
          <Button type="submit" variant="primary" size="sm">Apply</Button>
        </FilterForm>
        {bills.length === 0 ? <EmptyState icon={Store} title="No vendor bills" description="Bills appear when an approved expense has a vendor." /> : (
          <DataTable>
            <thead><tr><Th>Vendor</Th><Th>Project</Th><Th>Bill no.</Th><Th>Bill date</Th><Th>Due</Th><Th className="text-right">Bill total</Th><Th className="text-right">Paid</Th><Th className="text-right">Outstanding</Th><Th>Status</Th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.expense_id} className="hover:bg-surface-muted">
                  <Td className="font-medium">{b.vendor_name}</Td>
                  <Td><Link href={`/projects/${b.project_id}?tab=expenses`} className="hover:underline">{b.project_name}</Link></Td>
                  <Td>{b.bill_number ?? "—"}<p className="text-xs text-muted">{b.expense_code}</p></Td>
                  <Td>{formatDate(b.expense_date)}</Td><Td>{b.due_date ? formatDate(b.due_date) : "—"}</Td>
                  <Td className="text-right tabular-nums">{formatINR(b.total_amount, { exact: true })}</Td><Td className="text-right tabular-nums">{formatINR(b.paid_amount, { exact: true })}</Td>
                  <Td className={`text-right tabular-nums ${Number(b.outstanding_amount) > 0 ? "text-danger" : ""}`}>{formatINR(b.outstanding_amount, { exact: true })}</Td>
                  <Td><PaymentStatusBadge status={b.payment_status} /></Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      {vendor && (
        <Card className="mt-4">
          <CardHeader title="Payment history" />
          {history.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No payments recorded for this vendor in the bills shown.</p> : (
            <DataTable>
              <thead><tr><Th>Paid on</Th><Th>Bill</Th><Th>Mode</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className={h.voided_at ? "text-muted line-through" : ""}>
                    <Td>{formatDate(h.paid_on)}</Td><Td>{billNo[h.expense_id]?.bill_number ?? billNo[h.expense_id]?.expense_code ?? "—"}</Td>
                    <Td>{MODE_LABELS[h.method as keyof typeof MODE_LABELS] ?? h.method}</Td><Td>{h.reference ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{formatINR(h.amount, { exact: true })}{h.voided_at ? " (voided)" : ""}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      )}
    </>
  );
}
