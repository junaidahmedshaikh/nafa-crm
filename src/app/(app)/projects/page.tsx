import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { NoFinanceAccess, Profit, ProjectStatusBadge, pctText } from "@/components/finance/bits";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { profitAndLoss } from "@/lib/finance/calc";
import { getFinanceAccess, listProjects, projectCode } from "@/lib/finance/repo";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/finance/schemas";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Projects" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const sp = await searchParams;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Projects" /><NoFinanceAccess /></>;
  const q = one(sp.q).trim().slice(0, 100);
  const status = (PROJECT_STATUSES as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const trash = one(sp.trash) === "1" && access.manage;
  const { rows, summaries, total, pageSize } = await listProjects(supabase, { q, status, page, deleted: trash });
  const href = (n: number) => `/projects?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(trash && { trash: "1" }), page: String(n) })}`;

  return (
    <>
      <PageHeader
        title={trash ? "Deleted projects" : "Projects"}
        description="Budget, expenses and profit for every project."
        actions={access.manage && <>{access.seesRevenue && <LinkButton href="/finance" variant="outline">Finance dashboard</LinkButton>}<LinkButton href="/projects/new" variant="primary">New project</LinkButton></>}
      />
      <Card>
        <FilterForm basePath="/projects" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Input name="q" aria-label="Search projects" defaultValue={q} placeholder="Search name, location, category…" className="max-w-sm flex-1" />
          <Select name="status" aria-label="Status" defaultValue={status} className="w-44"><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}</Select>
          {trash && <input type="hidden" name="trash" value="1" />}
          <Button type="submit" variant="primary" size="sm">Apply</Button>
          {access.manage && <Link href={trash ? "/projects" : "/projects?trash=1"} className="text-sm text-muted hover:text-foreground hover:underline">{trash ? "Back to projects" : "Show deleted"}</Link>}
        </FilterForm>
        {rows.length === 0 ? (
          <EmptyState icon={FolderKanban} title={trash ? "No deleted projects" : "No projects yet"} description={access.manage ? "Create a project to start tracking its budget, expenses and profit." : "You will see projects you are assigned to here."}
            action={access.manage && !trash ? <LinkButton href="/projects/new" variant="primary">New project</LinkButton> : undefined} />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Project</Th><Th>Client</Th><Th>Dates</Th><Th>Status</Th><Th className="text-right">Budget</Th><Th className="text-right">Spent</Th>{access.seesRevenue && <><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th></>}</tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = summaries[r.id];
                  const pl = s ? profitAndLoss(s) : null;
                  return (
                    <tr key={r.id} className="hover:bg-surface-muted">
                      <Td><Link href={`/projects/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.name}</Link><p className="text-xs text-muted">{projectCode(r.project_number)}{r.category ? ` · ${r.category}` : ""}</p></Td>
                      <Td>{r.company?.name ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-xs">{r.start_date ? formatDate(r.start_date) : "—"}{r.end_date ? ` → ${formatDate(r.end_date)}` : ""}</Td>
                      <Td><ProjectStatusBadge status={r.status} /></Td>
                      <Td className="text-right tabular-nums">{formatINR(pl?.estimated_cost ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{formatINR(pl?.cost_total ?? 0)}</Td>
                      {access.seesRevenue && <>
                        <Td className="text-right">{pl ? <Profit value={pl.gross_profit} exact={false} /> : "—"}</Td>
                        <Td className={`text-right tabular-nums ${pl?.is_loss ? "text-danger" : ""}`}>{pctText(pl?.profit_margin ?? null)}</Td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
