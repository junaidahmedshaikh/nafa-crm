import Link from "next/link";
import { Plus, Search, Upload, UserRound } from "lucide-react";
import { ExportLink } from "@/components/shared/export-link";
import { FilterForm } from "@/components/shared/filter-form";
import { Button, LinkButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { ContactsTable } from "@/components/directory/contacts-table";
import { listContacts } from "@/lib/data/directory";
import { listAssignableGroups } from "@/lib/data/groups";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const archived = one(sp.archived) === "1";
  const { supabase, profile } = await requireMember();
  const [{ rows, total, pageSize }, groups] = await Promise.all([listContacts(supabase, { q, page, archived }), listAssignableGroups(supabase)]);
  const href = (p: number) => {
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set("q", q);
    if (archived) params.set("archived", "1");
    return `/contacts?${params}`;
  };

  return (
    <>
      <PageHeader
        title={archived ? "Archived contacts" : "Contacts"}
        description={`${total} ${archived ? "archived" : q ? "matching" : "total"}`}
        actions={
          <>
            <LinkButton href="/contacts/import"><Upload className="h-4 w-4" aria-hidden />Import</LinkButton>
            <ExportLink href="/api/export/contacts" />
            <LinkButton href="/contacts/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />New contact</LinkButton>
          </>
        }
      />
      <Card>
        <FilterForm basePath="/contacts" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[16rem] flex-1">
            <label htmlFor="q" className="sr-only">Search contacts</label>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input id="q" name="q" defaultValue={q} placeholder="Search name, email, phone, company…" className="pl-9" />
          </div>
          {archived && <input type="hidden" name="archived" value="1" />}
          <Button type="submit" variant="primary" size="sm">Search</Button>
          <Link href={archived ? "/contacts" : "/contacts?archived=1"} className="text-sm text-muted hover:text-foreground hover:underline">
            {archived ? "Show active" : "Show archived"}
          </Link>
        </FilterForm>
        {rows.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title={q ? "No contacts match" : archived ? "No archived contacts" : "No contacts yet"}
            description={q ? "Try a different search." : "Contacts are created automatically when you add leads, or you can add one here."}
            action={!q && !archived ? <div className="flex gap-2"><LinkButton href="/contacts/new" variant="primary">Add a contact</LinkButton><LinkButton href="/contacts/import">Import from CSV</LinkButton></div> : undefined}
          />
        ) : (
          <>
            <ContactsTable rows={rows} total={total} q={q} archived={archived} groups={groups} isAdmin={profile.role === "admin"} />
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
