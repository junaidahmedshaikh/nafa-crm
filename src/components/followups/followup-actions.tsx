"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { cancelFollowUp, completeFollowUp, rescheduleFollowUp } from "@/lib/actions/followups";

export function FollowUpActions({ id, title, dueLocal }: { id: string; title: string; dueLocal: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | "reschedule" | "cancel">(null);
  const [error, setError] = useState<string>();

  function run(action: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> }>, success: string) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        setDialog(null);
        setError(undefined);
        router.refresh();
      } else {
        setError(res.fieldErrors?.due_at);
        toast.error(res.error ?? "Something went wrong");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" onClick={() => run(() => completeFollowUp(id), "Follow-up completed")} disabled={pending} aria-label={`Mark “${title}” complete`}>
        <Check className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Done</span>
      </Button>
      <Button size="icon" variant="ghost" onClick={() => setDialog("reschedule")} aria-label={`Reschedule “${title}”`} title="Reschedule">
        <CalendarClock className="h-4 w-4" aria-hidden />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => setDialog("cancel")} aria-label={`Cancel “${title}”`} title="Cancel task">
        <X className="h-4 w-4" aria-hidden />
      </Button>

      <Modal open={dialog === "reschedule"} onClose={() => setDialog(null)} title="Reschedule follow-up" description={title}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const due = String(new FormData(e.currentTarget).get("due_at") ?? "");
            run(() => rescheduleFollowUp(id, { due_at: due }), "Follow-up rescheduled");
          }}
        >
          <Field label="New due date & time (IST)" required error={error}>
            {(p) => <Input {...p} name="due_at" type="datetime-local" defaultValue={dueLocal} autoFocus />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Reschedule</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        onConfirm={() => run(() => cancelFollowUp(id), "Follow-up cancelled")}
        pending={pending}
        title="Cancel this follow-up?"
        description={`“${title}” will be marked as cancelled and removed from your pending list.`}
        confirmLabel="Cancel follow-up"
      />
    </div>
  );
}
