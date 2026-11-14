import Link from "next/link";
import { NoFinanceAccess, PaymentStatusBadge, Profit, StatCard, pctText } from "@/components/finance/bits";
import { PrintButton } from "@/components/finance/print-button";
import { ExportLink } from "@/components/shared/export-link";
import { FilterForm } from "@/components/shared/filter-form";
import { Input, Select } from "@/components/ui/form";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { expenseReport, PAID_FILTERS, parseReportFilters, projectReport, projectReportTotals } from "@/lib/finance/reports";
import { getFinanceAccess, listCategories } from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Finance Reports" };
const PAID_LABEL: Record<string, string> = { pending: "Pending", partial: "Partially paid", paid: "Paid", overdue: "Overdue" };
const money = (v: number | string) => formatINR(v, { exact: true });

export default async function FinanceReportsPage({ searchParams }: PageProps<"/finance/reports">) {
  const sp = await searchParams;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Finance Reports" /><NoFinanceAccess /></>;

  const f = parseReportFilters(sp);
  const [projects, expenses, categories, projectOptions, companies] = await Promise.all([
    access.seesRevenue ? projectReport(supabase, f) : Promise.resolve([]),
    expenseReport(supabase, f, 500),
    listCategories(supabase),
    supabase.from("projects").select("id, name, company_id").is("deleted_at", null).order("name").limit(1000),
    supabase.from("companies").select("id, name").is("archived_at", null).order("name").limit(2000),
  ]);
  const clientIds = new Set((projectOptions.data ?? []).map((p) => p.company_id as string | null).filter(Boolean));
  const clients = (companies.data ?? []).filter((c) => clientIds.has(c.id as string));
  const t = projectReportTotals(projects);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const filtered = qs.length > 0;
  const expenseTotal = expenses.reduce((a, e) => a + Number(e.total_amount), 0);
  const expenseUnpaid = expenses.reduce((a, e) => a + Number(e.outstanding_amount), 0);

  return (
    <>
      <PageHeader
        title="Finance Reports"
        description="Project-wise revenue, expenses and profit. Revenue, expenses and profit exclude GST; invoiced and received amounts include it."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {access.seesRevenue && <ExportLink href={`/api/export/finance-projects${qs ? `?${qs}` : ""}`} label="Projects (Excel/CSV)" />}
            <ExportLink href={`/api/export/finance-expenses${qs ? `?${qs}` : ""}`} label="Expenses (Excel/CSV)" />
            <PrintButton />
          </div>
        }
      />

      <Card className="mb-4 print:hidden">
        <FilterForm basePath="/finance/reports" className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs font-medium text-muted">Project
            <Select name="project" defaultValue={f.project} className="mt-1 w-52"><option value="">All projects</option>{(projectOptions.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </label>
          <label className="text-xs font-medium text-muted">Client
            <Select name="client" defaultValue={f.client} className="mt-1 w-48"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </label>
          <label className="text-xs font-medium text-muted">From<Input type="date" name="from" defaultValue={f.from} className="mt-1 w-40" /></label>
          <label className="text-xs font-medium text-muted">To<Input type="date" name="to" defaultValue={f.to} className="mt-1 w-40" /></label>
          <label className="text-xs font-medium text-muted">Expense category
            <Select name="category" defaultValue={f.category} className="mt-1 w-48"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </label>
          <label className="text-xs font-medium text-muted">Expense payment status
            <Select name="paid" defaultValue={f.paid} className="mt-1 w-44"><option value="">Any</option>{PAID_FILTERS.map((p) => <option key={p} value={p}>{PAID_LABEL[p]}</option>)}</Select>
          </label>
          {filtered && <Link href="/finance/reports" className="pb-2 text-sm text-accent hover:underline">Clear</Link>}
        </FilterForm>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">Dates filter projects by start date and expenses by expense date. Category and payment status apply to the expense register.</p>
      </Card>

      {access.seesRevenue && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Project revenue" value={money(t.project_value)} hint={`${projects.length} project${projects.length === 1 ? "" : "s"}`} />
            <StatCard label="Invoiced" value={money(t.invoiced)} hint="Incl. GST" />
            <StatCard label="Received" value={money(t.received)} tone="good" />
            <StatCard label="Outstanding receivables" value={money(t.outstanding)} tone={t.outstanding > 0 ? "bad" : "neutral"} hint="Invoiced − received" />
            <StatCard label="Expenses" value={money(t.expenses)} hint={`Estimated ${money(t.estimated_expenses)}`} />
            <StatCard label="Pending vendor payments" value={money(t.expenses_unpaid)} tone={t.expenses_unpaid > 0 ? "bad" : "neutral"} hint={`Paid ${money(t.expenses_paid)}`} />
            <StatCard label="Gross profit" value={money(t.gross_profit)} tone={t.gross_profit < 0 ? "bad" : "good"} hint={`Margin ${pctText(t.margin)}${t.low ? ` · ${t.low} low / loss` : ""}`} />
          </div>
          <Card className="mb-6">
            <CardHeader title="Project-wise profitability" />
            {projects.length === 0 ? <EmptyState title="No projects match" description="Change the filters, or create a project first." /> : (
              <DataTable className="[&_table]:min-w-[1100px]">
                <thead><tr><Th>Project</Th><Th>Client</Th><Th className="text-right">Project value</Th><Th className="text-right">Invoiced</Th><Th className="text-right">Received</Th><Th className="text-right">Outstanding</Th><Th className="text-right">Est. expenses</Th><Th className="text-right">Expenses</Th><Th className="text-right">Unpaid bills</Th><Th className="text-right">Gross profit</Th><Th className="text-right">Margin</Th></tr></thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.project_id} className="hover:bg-surface-muted">
                      <Td><Link href={`/projects/${p.project_id}`} className="font-medium hover:text-accent hover:underline">{p.name}</Link></Td>
                      <Td>{p.client || "—"}</Td>
                      <Td className="text-right tabular-nums">{money(p.project_value)}</Td>
                      <Td className="text-right tabular-nums">{money(p.invoiced)}</Td>
                      <Td className="text-right tabular-nums">{money(p.received)}</Td>
                      <Td className={cn("text-right tabular-nums", p.outstanding > 0 && "font-medium text-danger")}>{money(p.outstanding)}</Td>
                      <Td className="text-right tabular-nums text-muted">{money(p.estimated_expenses)}</Td>
                      <Td className="text-right tabular-nums">{money(p.expenses)}</Td>
                      <Td className="text-right tabular-nums">{money(p.expenses_unpaid)}</Td>
                      <Td className="text-right font-medium"><Profit value={p.gross_profit} /></Td>
                      <Td className={cn("text-right tabular-nums", (p.is_loss || (p.margin !== null && p.margin < 10)) && "font-medium text-danger")}>{pctText(p.margin)}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
        </>
      )}

      <Card>
        <CardHeader title="Expense register" action={<span className="text-xs text-muted">{expenses.length}{expenses.length === 500 ? "+" : ""} expenses · total {money(expenseTotal)} · unpaid {money(expenseUnpaid)}</span>} />
        {expenses.length === 0 ? <EmptyState title="No expenses match" description="Change the filters, or record expenses from a project." /> : (
          <DataTable className="[&_table]:min-w-[900px]">
            <thead><tr><Th>Date</Th><Th>Project</Th><Th>Category</Th><Th>Expense</Th><Th>Vendor</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th className="text-right">Unpaid</Th><Th>Status</Th></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="hover:bg-surface-muted">
                  <Td className="whitespace-nowrap text-muted">{formatDate(e.expense_date)}</Td>
                  <Td><Link href={`/projects/${e.project_id}?tab=expenses`} className="hover:text-accent hover:underline">{e.project_name}</Link></Td>
                  <Td>{e.category_name}</Td>
                  <Td>{e.title}<p className="text-xs text-muted">{e.expense_code}{e.approval_status !== "approved" ? ` · ${e.approval_status}` : ""}</p></Td>
                  <Td>{e.vendor_name || "—"}</Td>
                  <Td className="text-right tabular-nums">{money(e.total_amount)}</Td>
                  <Td className="text-right tabular-nums">{money(e.paid_amount)}</Td>
                  <Td className="text-right tabular-nums">{money(e.outstanding_amount)}</Td>
                  <Td><PaymentStatusBadge status={e.payment_status} /></Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {expenses.length === 500 && <p className="border-t border-border px-5 py-2 text-xs text-muted">Showing the latest 500. Narrow the filters, or export to get every row.</p>}
      </Card>
    </>
  );
}
