import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { CHART_COLORS, BarChart, HBarChart, Legend, LineChart, PieChart } from "@/components/finance/charts";
import { NoFinanceAccess, Profit, StatCard, pctText } from "@/components/finance/bits";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { profitAndLoss } from "@/lib/finance/calc";
import { RANGE_LABELS, RANGE_PRESETS, isRangePreset, resolveRange } from "@/lib/finance/range";
import { getDashboard, getFinanceAccess } from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";
import { todayIST } from "@/lib/documents/repo";

export const metadata = { title: "Project Finance" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const monthLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function FinanceDashboard({ searchParams }: PageProps<"/finance">) {
  const sp = await searchParams;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Project Finance" /><NoFinanceAccess /></>;
  if (!access.seesRevenue) redirect("/projects");

  const preset = isRangePreset(one(sp.range)) ? (one(sp.range) as (typeof RANGE_PRESETS)[number]) : "month";
  const today = todayIST();
  const range = resolveRange(preset, today, { from: one(sp.from), to: one(sp.to) });
  const projectId = one(sp.project);
  const dash = await getDashboard(supabase, range, projectId || undefined);
  const t = dash.totals;
  const approvedBudgets = dash.summaries.reduce((a, s) => a + Number(s.approved_value), 0);
  const byProject = dash.summaries.map((s) => ({ name: s.name, ...profitAndLoss(s) })).sort((a, b) => b.revenue_total - a.revenue_total).slice(0, 8);
  const projectNames = Object.fromEntries(dash.summaries.map((s) => [s.project_id, s.name]));
  const monthly = dash.monthly;
  const scope = projectId ? "the selected project" : range.from || range.to ? `projects starting ${range.from ?? "…"} to ${range.to ?? "…"}` : "all projects";

  return (
    <>
      <PageHeader
        title="Project Finance"
        description={`Figures cover ${scope}. Revenue and costs exclude GST.`}
        actions={<><LinkButton href="/projects" variant="outline">All projects</LinkButton><LinkButton href="/projects/new" variant="primary">New project</LinkButton></>}
      />

      <Card className="mb-4">
        <FilterForm basePath="/finance" className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs font-medium text-muted">Period
            <Select name="range" aria-label="Period" defaultValue={preset} className="mt-1 w-52">{RANGE_PRESETS.map((p) => <option key={p} value={p}>{RANGE_LABELS[p]}</option>)}</Select>
          </label>
          {preset === "custom" && (
            <>
              <label className="text-xs font-medium text-muted">From<Input type="date" name="from" defaultValue={range.from ?? ""} className="mt-1 w-40" /></label>
              <label className="text-xs font-medium text-muted">To<Input type="date" name="to" defaultValue={range.to ?? ""} className="mt-1 w-40" /></label>
            </>
          )}
          <label className="text-xs font-medium text-muted">Project
            <Select name="project" aria-label="Project" defaultValue={projectId} className="mt-1 w-56">
              <option value="">All projects in period</option>
              {projectId && !projectNames[projectId] && <option value={projectId}>Selected project</option>}
              {dash.summaries.map((s) => <option key={s.project_id} value={s.project_id}>{s.name}</option>)}
            </Select>
          </label>
          <Button type="submit" variant="primary" size="sm">Apply</Button>
        </FilterForm>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">A project belongs to the period of its start date (its created date if no start date is set). Monthly trends use invoice and expense dates.</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Total project revenue" value={formatINR(t.revenue_total)} hint={`${t.project_count} project${t.project_count === 1 ? "" : "s"} · ex-GST`} />
        <StatCard label="Approved client budgets" value={formatINR(approvedBudgets)} />
        <StatCard label="Estimated expenses" value={formatINR(t.estimated_cost)} hint="Sum of category budgets" />
        <StatCard label="Actual expenses" value={formatINR(t.cost_total)} tone={t.cost_total > t.estimated_cost && t.estimated_cost > 0 ? "bad" : "neutral"} />
        <StatCard label="Received from clients" value={formatINR(t.received)} />
        <StatCard label="Client outstanding" value={formatINR(t.client_outstanding)} tone={t.client_outstanding > 0 ? "bad" : "neutral"} hint="Issued invoices less payments" />
        <StatCard label="Vendor payments made" value={formatINR(t.vendor_paid)} />
        <StatCard label="Pending vendor payments" value={formatINR(t.vendor_payable)} tone={t.vendor_payable > 0 ? "bad" : "neutral"} href="/finance/vendors" />
        <StatCard label="Total project profit" value={formatINR(t.gross_profit)} tone={t.gross_profit > 0 ? "good" : t.gross_profit < 0 ? "bad" : "neutral"} />
        <StatCard label="Overall profit margin" value={pctText(t.profit_margin)} tone={(t.profit_margin ?? 0) > 0 ? "good" : (t.profit_margin ?? 0) < 0 ? "bad" : "neutral"} />
        <StatCard label="Projects running at a loss" value={String(t.loss_projects)} tone={t.loss_projects > 0 ? "bad" : "neutral"} />
        <StatCard label="GST collected / input recoverable" value={`${formatINR(t.gst_collected)} / ${formatINR(t.gst_input_recoverable)}`} hint="Tracked separately, not in profit" />
      </div>

      {dash.alerts.length > 0 && (
        <Card className="mt-4 border-warning/40">
          <CardHeader title={`Budget alerts (${dash.alerts.length})`} />
          <ul className="divide-y divide-border text-sm">
            {dash.alerts.slice(0, 8).map((a, i) => (
              <li key={i} className="flex items-center gap-2 px-5 py-2.5">
                <AlertTriangle className={`h-4 w-4 ${a.alert === "warning" ? "text-warning" : "text-danger"}`} aria-hidden />
                <Link href={`/projects/${a.project_id}?tab=budget`} className="font-medium hover:underline">{projectNames[a.project_id] ?? "Project"}</Link>
                <span className="text-muted">· {a.category_name} · {a.alert === "warning" ? "75% of budget used" : a.alert === "critical" ? "90% of budget used" : "over budget"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue vs expenses" />
          <div className="space-y-2 p-4">
            <Legend items={[{ label: "Revenue", color: CHART_COLORS.green }, { label: "Expenses", color: CHART_COLORS.red }]} />
            <BarChart ariaLabel="Revenue versus expenses by project" labels={byProject.map((p) => p.name)} series={[{ label: "Revenue", color: CHART_COLORS.green, values: byProject.map((p) => p.revenue_total) }, { label: "Expenses", color: CHART_COLORS.red, values: byProject.map((p) => p.cost_total) }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Estimated vs actual budget" />
          <div className="space-y-2 p-4">
            <Legend items={[{ label: "Estimated", color: CHART_COLORS.neutral }, { label: "Actual", color: CHART_COLORS.gold }]} />
            <BarChart ariaLabel="Estimated versus actual expenses by project" labels={byProject.map((p) => p.name)} series={[{ label: "Estimated", color: CHART_COLORS.neutral, values: byProject.map((p) => p.estimated_cost) }, { label: "Actual", color: CHART_COLORS.gold, values: byProject.map((p) => p.cost_total) }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Expense distribution by category" />
          <div className="p-4"><PieChart ariaLabel="Expenses by category" slices={dash.categories.map((c) => ({ label: c.category_name, value: c.amount }))} /></div>
        </Card>
        <Card>
          <CardHeader title="Monthly profit trend" />
          <div className="p-4"><LineChart ariaLabel="Monthly profit" labels={monthly.map((m) => monthLabel(m.month))} values={monthly.map((m) => Math.round((m.revenue - m.cost) * 100) / 100)} /></div>
        </Card>
        <Card>
          <CardHeader title="Client payment status" />
          <div className="p-4">
            <PieChart donut ariaLabel="Client payments: received, outstanding and not yet invoiced" centre={t.invoiced_total ? `${Math.round((t.received / t.invoiced_total) * 100)}% paid` : undefined}
              slices={[{ label: "Received", value: t.received, color: CHART_COLORS.green }, { label: "Outstanding", value: t.client_outstanding, color: CHART_COLORS.red }, { label: "Not yet invoiced", value: t.unbilled_revenue, color: CHART_COLORS.neutral }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Vendor outstanding payments" action={<Link href="/finance/vendors" className="text-xs text-accent hover:underline">View all</Link>} />
          <div className="p-4"><HBarChart ariaLabel="Outstanding payments by vendor" color={CHART_COLORS.red} rows={dash.vendorOutstanding.map((v) => ({ label: v.vendor, value: v.amount }))} /></div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Projects in this view" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-muted"><th className="px-5 py-2">Project</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Expenses</th><th className="px-3 py-2 text-right">Profit</th><th className="px-5 py-2 text-right">Margin</th></tr></thead>
            <tbody>
              {dash.summaries.map((s) => { const p = profitAndLoss(s); return (
                <tr key={s.project_id} className="border-t border-border hover:bg-surface-muted">
                  <td className="px-5 py-2.5"><Link href={`/projects/${s.project_id}`} className="font-medium hover:underline">{s.name}</Link></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(p.revenue_total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(p.cost_total)}</td>
                  <td className="px-3 py-2.5 text-right"><Profit value={p.gross_profit} exact={false} /></td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${p.is_loss ? "text-danger" : p.gross_profit > 0 ? "text-success" : "text-muted"}`}>{pctText(p.profit_margin)}</td>
                </tr>
              ); })}
              {dash.summaries.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted">No projects start in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
