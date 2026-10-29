import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({ title, action, className }: { title: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border px-5 py-3", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/5">
          <Icon className="h-5 w-5 text-muted" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title, description, actions, breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
              {b.href ? <Link href={b.href} className="hover:text-foreground hover:underline">{b.label}</Link> : <span aria-current="page">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Pagination({
  page, pageSize, total, hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-muted";
  const disabledCls = "inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface-muted px-3 text-sm text-muted/60";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
      <span>{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link href={hrefFor(page - 1)} className={linkCls}><ChevronLeft className="h-4 w-4" />Previous</Link> : <span className={disabledCls}><ChevronLeft className="h-4 w-4" />Previous</span>}
        <span aria-live="polite">Page {Math.min(page, pages)} of {pages}</span>
        {page < pages ? <Link href={hrefFor(page + 1)} className={linkCls}>Next<ChevronRight className="h-4 w-4" /></Link> : <span className={disabledCls}>Next<ChevronRight className="h-4 w-4" /></span>}
      </div>
    </div>
  );
}

export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[720px] text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn("whitespace-nowrap border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted", className)} {...p} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("border-b border-border px-4 py-3 align-top", className)} {...p} />
);

export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{it.value || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
