"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { setTemplateArchived, setTemplateStatus } from "@/lib/actions/whatsapp";
import { TEMPLATE_STATUSES, TEMPLATE_STATUS_LABELS } from "@/lib/whatsapp/schemas";

export function TemplateArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={archived ? "secondary" : "ghost"} loading={pending}
      onClick={() => start(async () => {
        const res = await setTemplateArchived(id, !archived);
        if (res.ok) { toast.success(archived ? "Template restored" : "Template archived"); router.refresh(); } else toast.error(res.error);
      })}
    >
      {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}{archived ? "Restore" : "Archive"}
    </Button>
  );
}

/** Admin-only. Until live sending is connected, WhatsApp's approval is recorded here by hand. */
export function TemplateStatusControl({ id, status, reason }: { id: string; status: string; reason: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [note, setNote] = useState(reason ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Approval status (admin)</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted">
        WhatsApp approves templates in Meta Business Manager. Record the outcome here. Live campaigns only use approved templates; dry-run campaigns can use any non-rejected template.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-44">
          <label htmlFor="wa-status" className="mb-1 block text-[13px] font-medium">Status</label>
          <Select id="wa-status" value={value} onChange={(e) => setValue(e.target.value)}>
            {TEMPLATE_STATUSES.map((s) => <option key={s} value={s}>{TEMPLATE_STATUS_LABELS[s]}</option>)}
          </Select>
        </div>
        {value === "rejected" && (
          <div className="min-w-56 flex-1">
            <label htmlFor="wa-reason" className="mb-1 block text-[13px] font-medium">Reason given</label>
            <Input id="wa-reason" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
        )}
        <Button
          variant="primary" loading={pending} disabled={value === status && value !== "rejected"}
          onClick={() => start(async () => {
            const res = await setTemplateStatus(id, value, note);
            if (res.ok) { toast.success("Status updated"); router.refresh(); } else toast.error(res.error);
          })}
        >
          Save status
        </Button>
      </div>
    </div>
  );
}
