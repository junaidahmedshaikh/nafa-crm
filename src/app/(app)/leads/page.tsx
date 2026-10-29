import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Search, Target, Upload } from "lucide-react";
import { ExportLink } from "@/components/shared/export-link";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { getTeam, requireMember } from "@/lib/auth";
import {
  LEAD_PRIORITY_OPTIONS, LEAD_SOURCE_OPTIONS, LEAD_STATUS_OPTIONS, SERVICE_CATEGORY_OPTIONS,
} from "@/lib/constants";
import { listLeads } from "@/lib/data/leads";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { leadFiltersToSearch, parseLeadFilters, type LeadSort } from "@/lib/lead-filters";
import { cn } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const filters = parseLeadFilters(await searchParams);
  const { supabase } = await requireMember();
  const [{ rows, total, pageSize }, team] = await Promise.all([listLeads(supabase, filters), getTeam()]);

  const hasFilters = !!(filters.q || filters.status.length || filters.source || filters.service || filters.priority || filters.owner || filters.from || filters.to || filters.closedFrom);
  const href = (overrides: Record<string, string | null>) => `/leads?${leadFiltersToSearch(filters, overrides)}`;
  const sortLink = (sort: LeadSort, label: string) => {
    const active = filters.sort === sort;
    const nextDir = active ? (filters.dir === "asc" ? "desc" : "asc") : sort === "created" || sort === "revenue" ? "desc" : "asc";
    return (
      <Link href={href({ sort, dir: nextDir, page: null })} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Sort by ${label}`}>
        {label}
        {active && (filters.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </Link>
    );
  };
  const exportHref = `/api/export/leads?${leadFiltersToSearch(filters)}`;

  return (
    <>
      <PageHeader
        title={filters.archived ? "Archived leads" : "Leads"}
        description={`${total} ${filters.archived ? "archived" : hasFilters ? "matching" : "total"} lead${total === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href="/leads/import"><Upload className="h-4 w-4" aria-hidden />Import</LinkButton>
            <ExportLink href={exportHref} />
            <LinkButton href="/leads/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New lead</LinkButton>
          </>
        }
      />

      <Card>
        <FilterForm basePath="/leads" className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <label htmlFor="q" className="sr-only">Search leads</label>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input id="q" name="q" defaultValue={filters.q} placeholder="Search lead, company, contact, email, phone…" className="pl-9" />
          </div>
          {filters.status.length > 1 ? (
            <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface-muted px-3 text-sm">
              <input type="hidden" name="status" value={filters.status.join(",")} />
              <span className="truncate">{filters.status.length} statuses</span>
              <Link href={href({ status: null, page: null })} className="text-xs text-accent hover:underline">Clear</Link>
            </div>
          ) : (
            <Select name="status" aria-label="Status" defaultValue={filters.status[0] ?? ""}>
              <option value="">All statuses</option>
              {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          <Select name="source" aria-label="Source" defaultValue={filters.source ?? ""}>
            <option value="">All sources</option>
            {LEAD_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select name="service" aria-label="Service category" defaultValue={filters.service ?? ""}>
            <option value="">All services</option>
            {SERVICE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select name="priority" aria-label="Priority" defaultValue={filters.priority ?? ""}>
            <option value="">All priorities</option>
            {LEAD_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select name="owner" aria-label="Owner" defaultValue={filters.owner ?? ""}>
            <option value="">All owners</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.full_name || "Team member"}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <label htmlFor="from" className="sr-only">Created from</label>
            <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} title="Created from" />
            <span className="text-muted" aria-hidden>–</span>
            <label htmlFor="to" className="sr-only">Created to</label>
            <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} title="Created to" />
          </div>
          {filters.closedFrom && <input type="hidden" name="closed_from" value={filters.closedFrom} />}
          {filters.sort !== "created" && <input type="hidden" name="sort" value={filters.sort} />}
          <input type="hidden" name="dir" value={filters.dir} />
          {filters.archived && <input type="hidden" name="archived" value="1" />}
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-6">
            <Button type="submit" variant="primary" size="sm">Apply</Button>
            {hasFilters && <Link href={filters.archived ? "/leads?archived=1" : "/leads"} className="text-sm text-accent hover:underline">Clear filters</Link>}
            <span className="flex-1" />
            <Link href={href({ archived: filters.archived ? null : "1", page: null })} className="text-sm text-muted hover:text-foreground hover:underline">
              {filters.archived ? "Show active leads" : "Show archived"}
            </Link>
          </div>
        </FilterForm>

        {rows.length === 0 ? (
          hasFilters || filters.archived ? (
            <EmptyState icon={Search} title="No leads match" description="Try removing a filter or searching for something else." />
          ) : (
            <EmptyState
              icon={Target}
              title="No leads yet"
              description="Add your first lead or import a spreadsheet."
              action={<LinkButton href="/leads/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New lead</LinkButton>}
            />
          )
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <Th>Lead</Th>
                  <Th>Company / contact</Th>
                  <Th>Status</Th>
                  <Th>{sortLink("priority", "Priority")}</Th>
                  <Th>{sortLink("followup", "Next follow-up")}</Th>
                  <Th className="text-right">{sortLink("revenue", "Expected revenue")}</Th>
                  <Th>{sortLink("created", "Created")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const overdue = l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
                  return (
                    <tr key={l.id} className="hover:bg-surface-muted">
                      <Td>
                        <Link href={`/leads/${l.id}`} className="font-medium hover:text-accent hover:underline">{l.title}</Link>
                        <p className="text-xs text-muted">{formatLeadNumber(l.lead_number)}{l.event_date ? ` · Event ${formatDate(l.event_date)}` : ""}</p>
                      </Td>
                      <Td>
                        <p>{l.company_name ?? "—"}</p>
                        <p className="text-xs text-muted">{l.contact_name ?? ""}</p>
                      </Td>
                      <Td><StatusBadge status={l.status} /></Td>
                      <Td><PriorityBadge priority={l.priority} /></Td>
                      <Td className={cn("whitespace-nowrap tabular-nums", overdue && "font-medium text-danger")}>
                        {l.next_follow_up_at ? formatDateTime(l.next_follow_up_at) : <span className="text-muted">—</span>}
                      </Td>
                      <Td className="text-right tabular-nums">{formatINR(l.expected_revenue_inr)}</Td>
                      <Td className="whitespace-nowrap text-muted">{formatDate(l.created_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pagination page={filters.page} pageSize={pageSize} total={total} hrefFor={(p) => href({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  );
}
