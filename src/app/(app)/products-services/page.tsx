import Link from "next/link";
import { Package } from "lucide-react";
import { ProductManager } from "@/components/documents/product-manager";
import { FilterForm } from "@/components/shared/filter-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { listProducts } from "@/lib/documents/repo";

export const metadata = { title: "Products & Services" };

export default async function ProductsPage({ searchParams }: PageProps<"/products-services">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const all = one(sp.inactive) === "1";
  const { supabase } = await requireMember();
  const { rows, total, pageSize } = await listProducts(supabase, { q, page, activeOnly: !all });
  const href = (n: number) => `/products-services?${new URLSearchParams({ ...(q && { q }), ...(all && { inactive: "1" }), page: String(n) })}`;

  return (
    <>
      <PageHeader title="Products & Services" description="A reusable catalogue for quotations and invoices. Custom one-off lines never need an entry here." />
      <Card>
        <FilterForm basePath="/products-services" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Input name="q" aria-label="Search catalogue" defaultValue={q} placeholder="Search name, category, HSN/SAC…" className="max-w-md flex-1" />
          {all && <input type="hidden" name="inactive" value="1" />}
          <Button type="submit" variant="primary" size="sm">Search</Button>
          <Link href={all ? "/products-services" : "/products-services?inactive=1"} className="text-sm text-muted hover:text-foreground hover:underline">{all ? "Hide inactive" : "Show inactive"}</Link>
        </FilterForm>
        {rows.length === 0 && !q ? (
          <>
            <EmptyState icon={Package} title="Your catalogue is empty" description="Add the services you quote most often — stage design, staffing, AV, décor — to build documents faster." />
            <ProductManager rows={[]} />
          </>
        ) : (
          <>
            <ProductManager rows={rows} />
            {rows.length === 0 && <EmptyState title="No items match" />}
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
