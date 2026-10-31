import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt } from "lucide-react";
import { BarChart, CHART_COLORS, Legend, PieChart } from "@/components/finance/charts";
import { NoFinanceAccess, Profit, ProjectStatusBadge, StatCard, pctText } from "@/components/finance/bits";
import { AddExpenseButton, ExpenseRowActions, ExpenseStatusCell } from "@/components/finance/expense-dialogs";
import { PnlExpenseDetail } from "@/components/finance/pnl-detail";
import { BudgetEditor, DeleteRestoreButton, ReimbursementForm, ReimbursementTable, RevenuePanel } from "@/components/finance/panels";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, CardHeader, DataTable, DetailList, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { groupCostLines, profitAndLoss, type CostLine } from "@/lib/finance/calc";
import {
  getBudgetStatus, getCategoryTotals, getCostDetail, getFinanceAccess, getProject, getRevenueDetail, listCategories, listExpensePayments, listExpenses, listLinkableInvoices,
  listPeople, listProjectAudit, listReimbursements, listVendors, projectCode, type ExpenseFilters,
} from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TABS = [["overview", "Overview"], ["expenses", "Expenses"], ["budget", "Budget"], ["revenue", "Client revenue"], ["reimbursements", "Reimbursements"], ["activity", "Activity"]] as const;
type Tab = (typeof TABS)[number][0];

export async function generateMetadata({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  return { title: `Project ${id.slice(0, 8)}` };
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, user } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Project" /><NoFinanceAccess /></>;
  const found = await getProject(supabase, id);
  if (!found) notFound();
  const { project, summary } = found;
  const deleted = !!project.deleted_at;

  const visibleTabs = TABS.filter(([t]) => access.seesRevenue || (t !== "revenue" && t !== "activity"));
  const reqTab = one(sp.tab) as Tab;
  const tab: Tab = visibleTabs.some(([t]) => t === reqTab) ? reqTab : "overview";
  const pl = summary ? profitAndLoss(summary) : null;
  const base = `/projects/${id}`;
  const tabHref = (t: string) => (t === "overview" ? base : `${base}?tab=${t}`);

  const [categories, vendors] = await Promise.all([listCategories(supabase), listVendors(supabase)]);

  return (
    <>
      <PageHeader
        title={project.name}
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: projectCode(project.project_number) }]}
        description={`${projectCode(project.project_number)}${project.company?.name ? ` · ${project.company.name}` : ""}${deleted ? " · Deleted" : ""}`}
        actions={
          <>
            {!deleted && <AddExpenseButton projectId={id} categories={categories} vendors={vendors} canAddCategory={access.manage} />}
            {access.manage && !deleted && <LinkButton href={`${base}/edit`} variant="outline">Edit project</LinkButton>}
            {access.manage && <DeleteRestoreButton kind="project" id={id} deleted={deleted} isAdmin={access.admin} label="Project" />}
          </>
        }
      />

      <nav aria-label="Project sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {visibleTabs.map(([t, label]) => (
          <Link key={t} href={tabHref(t)} aria-current={tab === t ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "overview" && <Overview project={project} pl={pl} summary={summary} seesRevenue={access.seesRevenue} categoriesPromise={access.seesRevenue ? getCategoryTotals(supabase, id) : Promise.resolve([])} costPromise={access.seesRevenue ? getCostDetail(supabase, id) : Promise.resolve([])} budgetPromise={access.seesRevenue ? getBudgetStatus(supabase, id) : Promise.resolve([])} />}

      {tab === "expenses" && <ExpensesTab id={id} sp={sp} supabase={supabase} userId={user.id} access={access} categories={categories} vendors={vendors} />}

      {tab === "budget" && <BudgetTab id={id} supabase={supabase} categories={categories} canEdit={access.manage && !deleted} />}

      {tab === "revenue" && access.seesRevenue && <RevenueTab id={id} supabase={supabase} companyId={project.company_id} canEdit={access.manage && !deleted} />}

      {tab === "reimbursements" && <ReimbursementsTab id={id} supabase={supabase} manage={access.manage} categories={categories} projectName={project.name} />}

      {tab === "activity" && access.seesRevenue && <ActivityTab id={id} supabase={supabase} />}
    </>
  );
}

type Sb = Awaited<ReturnType<typeof requireMember>>["supabase"];

// ---------------------------------------------------------------------------
async function Overview({ project, pl, summary, seesRevenue, categoriesPromise, costPromise, budgetPromise }: {
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>["project"]; pl: ReturnType<typeof profitAndLoss> | null; summary: NonNullable<Awaited<ReturnType<typeof getProject>>>["summary"]; seesRevenue: boolean;
  categoriesPromise: ReturnType<typeof getCategoryTotals>; costPromise: Promise<CostLine[]>; budgetPromise: ReturnType<typeof getBudgetStatus>;
}) {
  const [cats, costLines, budgets] = await Promise.all([categoriesPromise, costPromise, budgetPromise]);
  const detail = groupCostLines(costLines);
  const budgetBy = new Map(budgets.map((b) => [b.category_id, Number(b.budget)]));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Project overview" />
        <div className="p-5">
          <DetailList items={[
            { label: "Project ID", value: projectCode(project.project_number) },
            { label: "Client", value: project.company?.name ?? "—" },
            { label: "Category", value: project.category || "—" },
            { label: "Event location", value: project.location || "—" },
            { label: "Event start", value: project.start_date ? formatDate(project.start_date) : "—" },
            { label: "Event end", value: project.end_date ? formatDate(project.end_date) : "—" },
            { label: "Project manager", value: project.manager?.full_name ?? "—" },
            { label: "Status", value: <ProjectStatusBadge status={project.status} /> },
            { label: "Approved client budget", value: formatINR(project.approved_value, { exact: true }) },
            { label: "Final client billing", value: project.final_billing_amount == null ? "—" : formatINR(project.final_billing_amount, { exact: true }) },
          ]} />
          {project.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{project.notes}</p>}
        </div>
      </Card>

      {pl && seesRevenue && summary && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total revenue" value={formatINR(pl.revenue_total)} hint="Ex-GST" />
            <StatCard label="Total expenses" value={formatINR(pl.cost_total)} hint={`Budget ${formatINR(pl.estimated_cost)}`} tone={pl.estimated_cost > 0 && pl.cost_total > pl.estimated_cost ? "bad" : "neutral"} />
            <StatCard label="Profit / loss" value={formatINR(pl.gross_profit)} tone={pl.gross_profit > 0 ? "good" : pl.gross_profit < 0 ? "bad" : "neutral"} hint={`Margin ${pctText(pl.profit_margin)}`} />
            <StatCard label="Client outstanding" value={formatINR(pl.client_outstanding)} tone={pl.client_outstanding > 0 ? "bad" : "neutral"} hint={`Received ${formatINR(pl.received)} of ${formatINR(pl.invoiced_total)} invoiced`} />
            <StatCard label="Vendor payable" value={formatINR(pl.vendor_payable)} tone={pl.vendor_payable > 0 ? "bad" : "neutral"} hint={`Paid ${formatINR(pl.vendor_paid)} of ${formatINR(pl.bills_total)} billed`} />
            <StatCard label="Not yet invoiced" value={formatINR(pl.unbilled_revenue)} />
            <StatCard label="GST collected" value={formatINR(pl.gst_collected)} hint="Not part of revenue" />
            <StatCard label="Input GST recoverable" value={formatINR(pl.gst_input_recoverable)} hint="Not part of expenses" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Profit & loss" />
              <dl className="divide-y divide-border text-sm">
                {([
                  ["Approved project value", Number(summary.approved_value)], ["Additional client charges", Number(summary.additional_charges)], ["Approved change orders", Number(summary.change_orders)],
                ] as const).map(([k, v]) => <Row key={k} k={k} v={formatINR(v, { exact: true })} />)}
                <Row k="Total revenue (ex-GST)" v={formatINR(pl.revenue_total, { exact: true })} strong />
                <Row k="Expenses (bills, ex recoverable GST)" v={formatINR(Number(summary.expense_cost), { exact: true })} />
                <Row k="Approved reimbursements" v={formatINR(Number(summary.reimbursement_cost), { exact: true })} />
                <Row k="Total expenses" v={formatINR(pl.cost_total, { exact: true })} strong />
                <Row k="Project gross profit" v={<Profit value={pl.gross_profit} />} strong />
                <Row k="Actual profit margin" v={pctText(pl.profit_margin)} />
                <Row k="Estimated profit (revenue − budget)" v={<Profit value={pl.estimated_profit} />} />
                <Row k="Estimated profit margin" v={pctText(pl.estimated_margin)} />
                <Row k="Profit difference (actual − estimated)" v={<Profit value={pl.profit_difference} />} />
                <Row k="Break-even revenue (costs so far)" v={formatINR(pl.break_even_revenue, { exact: true })} />
              </dl>
            </Card>
            <Card>
              <CardHeader title="Where the money went" />
              <div className="p-4"><PieChart ariaLabel="Expenses by category" slices={cats.map((c) => ({ label: c.category_name, value: c.amount }))} /></div>
              <div className="border-t border-border p-4">
                <Legend items={[{ label: "Revenue", color: CHART_COLORS.green }, { label: "Expenses", color: CHART_COLORS.red }]} />
                <BarChart ariaLabel="Revenue versus expenses" height={160} labels={["This project"]} series={[{ label: "Revenue", color: CHART_COLORS.green, values: [pl.revenue_total] }, { label: "Expenses", color: CHART_COLORS.red, values: [pl.cost_total] }]} />
              </div>
            </Card>
          </div>

          <PnlExpenseDetail groups={detail.groups} total={detail.total} itemCount={costLines.length} budgetBy={budgetBy} />
        </>
      )}
    </div>
  );
}
const Row = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
  <div className={`flex items-center justify-between gap-4 px-5 py-2.5 ${strong ? "bg-surface-muted font-semibold" : ""}`}><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>
);

// ---------------------------------------------------------------------------
async function ExpensesTab({ id, sp, supabase, userId, access, categories, vendors }: {
  id: string; sp: Record<string, string | string[] | undefined>; supabase: Sb; userId: string; access: Awaited<ReturnType<typeof getFinanceAccess>>; categories: Awaited<ReturnType<typeof listCategories>>; vendors: Awaited<ReturnType<typeof listVendors>>;
}) {
  const f: ExpenseFilters = {
    q: one(sp.q).trim().slice(0, 100), category: one(sp.category), vendor: one(sp.vendor), status: one(sp.status), from: one(sp.from), to: one(sp.to), paid: one(sp.paid), kind: one(sp.kind),
    sort: one(sp.sort) || "date", dir: one(sp.dir) === "asc" ? "asc" : "desc", page: Math.max(1, Math.floor(Number(one(sp.page))) || 1), deleted: one(sp.trash) === "1" && access.manage,
  };
  const { rows, total, pageSize } = await listExpenses(supabase, id, f);
  const payments = await listExpensePayments(supabase, rows.map((r) => r.id));
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab: "expenses" });
    for (const [k, v] of Object.entries({ q: f.q, category: f.category, vendor: f.vendor, status: f.status, from: f.from, to: f.to, paid: f.paid, kind: f.kind, sort: f.sort, dir: f.dir, ...(f.deleted && { trash: "1" }), ...over })) if (v) p.set(k, v);
    return `/projects/${id}?${p}`;
  };
  const sortLink = (col: string, label: string) => <Link href={qs({ sort: col, dir: f.sort === col && f.dir === "desc" ? "asc" : "desc", page: "1" })} className="hover:text-foreground">{label}{f.sort === col ? (f.dir === "asc" ? " ↑" : " ↓") : ""}</Link>;

  return (
    <Card>
      <FilterForm basePath={`/projects/${id}`} className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="tab" value="expenses" />
        <input type="hidden" name="sort" value={f.sort} /><input type="hidden" name="dir" value={f.dir} />{f.deleted && <input type="hidden" name="trash" value="1" />}
        <Input name="q" aria-label="Search expenses" defaultValue={f.q} placeholder="Search description, vendor, bill no…" className="sm:col-span-2" />
        <Select name="category" aria-label="Category" defaultValue={f.category}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="vendor" aria-label="Vendor" defaultValue={f.vendor}><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
        <Select name="status" aria-label="Payment status" defaultValue={f.status}><option value="">Any payment status</option><option value="pending">Pending</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option></Select>
        <Select name="paid" aria-label="Paid or unpaid" defaultValue={f.paid}><option value="">Paid &amp; unpaid</option><option value="paid">Paid only</option><option value="unpaid">Unpaid only</option></Select>
        <Select name="kind" aria-label="Estimated or actual" defaultValue={f.kind}><option value="">Estimated &amp; actual</option><option value="estimated">With an estimate</option></Select>
        <div className="flex items-center gap-2"><Input type="date" name="from" aria-label="From date" defaultValue={f.from} /><Input type="date" name="to" aria-label="To date" defaultValue={f.to} /></div>
        <div className="flex items-center gap-3"><Button type="submit" variant="primary" size="sm">Apply</Button><Link href={`/projects/${id}?tab=expenses`} className="text-sm text-muted hover:underline">Reset</Link>{access.manage && <Link href={qs({ trash: f.deleted ? "" : "1", page: "1" })} className="text-sm text-muted hover:underline">{f.deleted ? "Back" : "Show deleted"}</Link>}</div>
      </FilterForm>
      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title={f.deleted ? "No deleted expenses" : "No expenses found"} description="Use “Quick add expense” to record the first one, or loosen the filters." />
      ) : (
        <>
          <DataTable className="min-w-[960px]">
            <thead><tr><Th>{sortLink("date", "Date")}</Th><Th>{sortLink("category", "Category")}</Th><Th>Title</Th><Th>Vendor</Th><Th className="text-right">Estimated</Th><Th className="text-right">{sortLink("amount", "Actual")}</Th><Th className="text-right">Paid</Th><Th className="text-right">Outstanding</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-muted">
                  <Td className="whitespace-nowrap">{formatDate(r.expense_date)}<p className="text-xs text-muted">{r.expense_code}</p></Td>
                  <Td>{r.category_name}</Td>
                  <Td className="max-w-xs"><p className="truncate font-medium" title={r.title}>{r.title}</p>{r.description && <p className="truncate text-xs text-muted" title={r.description}>{r.description}</p>}{r.bill_number && <p className="text-xs text-muted">Bill {r.bill_number}</p>}</Td>
                  <Td>{r.vendor_name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{r.estimated_amount == null ? "—" : formatINR(r.estimated_amount, { exact: true })}</Td>
                  <Td className={`text-right tabular-nums ${r.estimated_amount != null && Number(r.subtotal) > Number(r.estimated_amount) ? "text-danger" : ""}`}>{formatINR(r.total_amount, { exact: true })}{Number(r.gst_amount) > 0 && <p className="text-xs text-muted">incl. GST {formatINR(r.gst_amount, { exact: true })}{r.gst_recoverable ? " (recoverable)" : ""}</p>}</Td>
                  <Td className="text-right tabular-nums">{formatINR(r.paid_amount, { exact: true })}</Td>
                  <Td className={`text-right tabular-nums ${Number(r.outstanding_amount) > 0 && r.approval_status === "approved" ? "text-danger" : ""}`}>{formatINR(r.outstanding_amount, { exact: true })}</Td>
                  <Td><ExpenseStatusCell e={r} /></Td>
                  <Td><ExpenseRowActions expense={r} payments={payments} categories={categories} vendors={vendors} manage={access.manage} isAdmin={access.admin} trash={f.deleted}
                    canEdit={!f.deleted && (access.manage || (r.created_by === userId && r.approval_status === "submitted"))} /></Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <Pagination page={f.page} pageSize={pageSize} total={total} hrefFor={(n) => qs({ page: String(n) })} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
async function BudgetTab({ id, supabase, categories, canEdit }: { id: string; supabase: Sb; categories: Awaited<ReturnType<typeof listCategories>>; canEdit: boolean }) {
  const rows = await getBudgetStatus(supabase, id);
  return (
    <Card>
      <CardHeader title="Budget allocation vs actual" />
      <p className="px-5 py-3 text-xs text-muted">Estimated budgets are GST-exclusive. Categories turn amber at 75% used, red at 90%, and are flagged when spending goes over budget. Alerts also show on the finance dashboard.</p>
      <BudgetEditor projectId={id} categories={categories} rows={rows} canEdit={canEdit} />
    </Card>
  );
}

async function RevenueTab({ id, supabase, companyId, canEdit }: { id: string; supabase: Sb; companyId: string | null; canEdit: boolean }) {
  const [detail, linkable] = await Promise.all([getRevenueDetail(supabase, id), canEdit ? listLinkableInvoices(supabase, companyId) : Promise.resolve([])]);
  return (
    <Card className="py-4">
      <RevenuePanel projectId={id} items={detail.items} invoices={detail.invoices} linkable={linkable} canEdit={canEdit} />
    </Card>
  );
}

async function ReimbursementsTab({ id, supabase, manage, categories, projectName }: { id: string; supabase: Sb; manage: boolean; categories: Awaited<ReturnType<typeof listCategories>>; projectName: string }) {
  const [{ rows }, people] = await Promise.all([listReimbursements(supabase, { status: "", project: id, page: 1 }), listPeople(supabase)]);
  void people;
  return (
    <Card>
      <CardHeader title="Reimbursements" action={<ReimbursementForm projects={[{ id, name: projectName }]} categories={categories} defaultName="" fixedProject={id} />} />
      {rows.length === 0 ? <EmptyState title="No reimbursements" description="Expenses paid personally by staff appear here once submitted." /> : <ReimbursementTable rows={rows} manage={manage} showProject={false} />}
    </Card>
  );
}

async function ActivityTab({ id, supabase }: { id: string; supabase: Sb }) {
  const [audit, people] = await Promise.all([listProjectAudit(supabase, id), listPeople(supabase)]);
  const name = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
  const changed = (o: Record<string, unknown> | null, n: Record<string, unknown> | null) =>
    o && n ? Object.keys(n).filter((k) => !["updated_at"].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).join(", ") : "";
  return (
    <Card>
      <CardHeader title="Audit log" />
      {audit.length === 0 ? <EmptyState title="No activity yet" /> : (
        <DataTable>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Record</Th><Th>Change</Th></tr></thead>
          <tbody>
            {audit.map((a) => {
              const row = (a.new_row ?? a.old_row ?? {}) as Record<string, unknown>;
              const label = (row.title ?? row.description ?? row.name ?? row.person_name ?? "") as string;
              return (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(a.at)}</Td><Td>{a.actor ? name[a.actor] ?? "Team member" : "System"}</Td>
                  <Td className="capitalize">{a.table_name.replace(/_/g, " ")}{label && <p className="max-w-xs truncate text-xs text-muted">{label}</p>}</Td>
                  <Td>{a.action === "UPDATE" ? `Updated: ${changed(a.old_row, a.new_row) || "—"}` : a.action === "INSERT" ? "Created" : "Removed"}{a.new_row?.deleted_at && !a.old_row?.deleted_at ? " (deleted)" : ""}</Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}
