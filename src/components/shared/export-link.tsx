import { Download } from "lucide-react";

/** Plain anchor on purpose: CSV downloads are served by a route handler, not a page. */
export function ExportLink({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
    >
      <Download className="h-4 w-4" aria-hidden />
      {label}
    </a>
  );
}
