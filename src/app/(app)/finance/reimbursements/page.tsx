import { HandCoins } from "lucide-react";
import { NoFinanceAccess } from "@/components/finance/bits";
import { ReimbursementForm, ReimbursementTable } from "@/components/finance/panels";
import { FilterForm } from "@/components/shared/filter-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getFinanceAccess, listCategories, listReimbursements } from "@/lib/finance/repo";

export const metadata = { title: "Reimbursements" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ReimbursementsPage({ searchParams }: PageProps<"/finance/reimbursements">) {
  const sp = await searchParams;
  const { supabase, profile } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Reimbursements" /><NoFinanceAccess /></>;
  const status = one(sp.status);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const [{ rows, total, pageSize }, categories, projects] = await Promise.all([
    listReimbursements(supabase, { status, page }),
    listCategories(supabase),
    supabase.from("projects").select("id, name").is("deleted_at", null).order("name").limit(500),
  ]);
  const href = (n: number) => `/finance/reimbursements?${new URLSearchParams({ ...(status && { status }), page: String(n) })}`;
  return (
    <>
      <PageHeader
        title="Reimbursements"
        description={access.manage ? "Expenses staff paid personally. Approved ones are counted in the project's expenses exactly once." : "Your submitted reimbursements."}
        actions={<ReimbursementForm projects={(projects.data ?? []) as { id: string; name: string }[]} categories={categories} defaultName={profile.full_name} />}
      />
      <Card>
        <FilterForm basePath="/finance/reimbursements" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Select name="status" aria-label="Status" defaultValue={status} className="w-44"><option value="">All statuses</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="reimbursed">Reimbursed</option></Select>
          <Button type="submit" variant="primary" size="sm">Apply</Button>
        </FilterForm>
        {rows.length === 0 ? <EmptyState icon={HandCoins} title="No reimbursements" description="Submitted reimbursements will be listed here." /> : (
          <>
            <ReimbursementTable rows={rows} manage={access.manage} />
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
