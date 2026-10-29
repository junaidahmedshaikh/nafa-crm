import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { ExportLink } from "@/components/shared/export-link";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/directory";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const archived = one(sp.archived) === "1";
  const { supabase } = await requireMember();
  const { rows, total, pageSize } = await listCompanies(supabase, { q, page, archived });
  const href = (p: number) => {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set("q", q);
    if (archived) params.set("archived", "1");
    return `/companies?${params}`;
  };

  return (
    <>
      <PageHeader
        title={archived ? "Archived companies" : "Companies"}
        description={`${total} ${archived ? "archived" : q ? "matching" : "total"}`}
        actions={
          <>
            <ExportLink href="/api/export/companies" />
            <LinkButton href="/companies/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New company</LinkButton>
          </>
        }
      />
      <Card>
        <FilterForm basePath="/companies" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[16rem] flex-1">
            <label htmlFor="q" className="sr-only">Search companies</label>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input id="q" name="q" defaultValue={q} placeholder="Search name, city, industry, website…" className="pl-9" />
          </div>
          {archived && <input type="hidden" name="archived" value="1" />}
          <Button type="submit" variant="primary" size="sm">Search</Button>
          <Link href={archived ? "/companies" : "/companies?archived=1"} className="text-sm text-muted hover:text-foreground hover:underline">
            {archived ? "Show active" : "Show archived"}
          </Link>
        </FilterForm>
        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q ? "No companies match" : archived ? "No archived companies" : "No companies yet"}
            description={q ? "Try a different search." : "Companies are created automatically when you add leads, or you can add one here."}
            action={!q && !archived ? <LinkButton href="/companies/new" variant="primary">Add a company</LinkButton> : undefined}
          />
        ) : (
          <>
            <DataTable>
              <thead>
                <tr><Th>Company</Th><Th>Industry</Th><Th>City</Th><Th className="text-right">Contacts</Th><Th className="text-right">Leads</Th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link href={`/companies/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.name}</Link>
                      {c.website && <p className="text-xs text-muted">{c.website}</p>}
                    </Td>
                    <Td>{c.industry ?? "—"}</Td>
                    <Td>{c.city ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{c.contact_count}</Td>
                    <Td className="text-right tabular-nums">{c.lead_count}</Td>
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
