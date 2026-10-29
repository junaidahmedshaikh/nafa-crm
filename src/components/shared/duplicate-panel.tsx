"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DuplicateMatch, DuplicateReport } from "@/lib/types";

function Group({ title, items }: { title: string; items: DuplicateMatch[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-warning">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((m) => (
          <li key={m.id} className="text-sm">
            <Link href={m.href} target="_blank" className="font-medium underline-offset-2 hover:underline">{m.label}</Link>
            <span className="text-muted"> — {m.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Shown instead of silently merging or duplicating. The user chooses how to resolve it.
 * Provide either lead-style resolution (`onUseExisting` + `onCreateNew`) or a single `onCreateAnyway`.
 */
export function DuplicatePanel({
  report, pending, onUseExisting, onCreateNew, onCreateAnyway, onDismiss, entity = "lead",
}: {
  report: DuplicateReport;
  pending?: boolean;
  onUseExisting?: () => void;
  onCreateNew?: () => void;
  onCreateAnyway?: () => void;
  onDismiss: () => void;
  entity?: string;
}) {
  return (
    <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold">Possible duplicate found</p>
            <p className="text-sm text-muted">Nothing has been saved yet. Review the existing records (they open in a new tab), then choose how to continue.</p>
          </div>
          <Group title="Companies" items={report.companies} />
          <Group title="Contacts" items={report.contacts} />
          <Group title="Open leads for the same contact" items={report.leads} />
          <div className="flex flex-wrap gap-2 pt-1">
            {onUseExisting && (
              <Button variant="primary" size="sm" onClick={onUseExisting} loading={pending}>
                Use existing company/contact &amp; save {entity}
              </Button>
            )}
            {onCreateNew && <Button size="sm" onClick={onCreateNew} disabled={pending}>Create as new records</Button>}
            {onCreateAnyway && <Button variant="primary" size="sm" onClick={onCreateAnyway} loading={pending}>Save anyway</Button>}
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={pending}>Go back and edit</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
