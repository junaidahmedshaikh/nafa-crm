import Link from "next/link";
import { Search } from "lucide-react";
import { FilterForm } from "@/components/shared/filter-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { docStatusLabel } from "@/components/documents/status-badge";

/** Search + status filter bar shared by the document list pages. */
export function DocListFilter({
  basePath, q, status, statuses, placeholder,
}: { basePath: string; q: string; status: string; statuses: readonly string[]; placeholder: string }) {
  return (
    <FilterForm basePath={basePath} className="flex flex-wrap items-center gap-3 border-b border-border p-4">
      <div className="relative min-w-[16rem] flex-1">
        <label htmlFor="q" className="sr-only">Search</label>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <Input id="q" name="q" defaultValue={q} placeholder={placeholder} className="pl-9" />
      </div>
      <Select name="status" aria-label="Status" defaultValue={status} className="w-48">
        <option value="">All statuses</option>
        {statuses.map((s) => <option key={s} value={s}>{docStatusLabel(s)}</option>)}
      </Select>
      <Button type="submit" variant="primary" size="sm">Apply</Button>
      {(q || status) && <Link href={basePath} className="text-sm text-accent hover:underline">Clear</Link>}
    </FilterForm>
  );
}
