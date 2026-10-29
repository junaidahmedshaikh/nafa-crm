"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, CalendarPlus, CheckCircle2, MessageSquarePlus, Pencil, Repeat, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { addLeadNote, changeLeadStatus, setLeadArchived } from "@/lib/actions/leads";
import { createFollowUp } from "@/lib/actions/followups";
import { FOLLOW_UP_TYPE_OPTIONS, LEAD_STATUS_OPTIONS, type FollowUpType, type LeadStatus } from "@/lib/constants";

type Dialog = null | "status" | "lost" | "note" | "followup" | "archive";

export function LeadActions({
  lead, followUpDefaults,
}: {
  lead: { id: string; title: string; status: LeadStatus; archived: boolean; contactName: string | null };
  followUpDefaults: { due: string; type: FollowUpType };
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const close = () => { setDialog(null); setErrors({}); };
  const closed = lead.status === "won" || lead.status === "lost";

  function run<T extends { ok: boolean; error?: string; fieldErrors?: Record<string, string> }>(
    action: () => Promise<T>, success: string,
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        close();
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error ?? "Something went wrong");
      }
    });
  }

  const formData = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };

  if (lead.archived) {
    return (
      <>
        <Button onClick={() => run(() => setLeadArchived(lead.id, false), "Lead restored")} loading={pending}>
          <ArchiveRestore className="h-4 w-4" aria-hidden />Restore lead
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Link href={`/leads/${lead.id}/edit`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
          <Pencil className="h-4 w-4" aria-hidden />Edit
        </Link>
        <Button onClick={() => setDialog("status")}><Repeat className="h-4 w-4" aria-hidden />Change status</Button>
        <Button onClick={() => setDialog("note")}><MessageSquarePlus className="h-4 w-4" aria-hidden />Add note</Button>
        {!closed && <Button onClick={() => setDialog("followup")}><CalendarPlus className="h-4 w-4" aria-hidden />Schedule follow-up</Button>}
        {lead.status !== "won" && (
          <Button variant="accent" onClick={() => run(() => changeLeadStatus(lead.id, { status: "won" }), "Marked as won 🎉")} loading={pending}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />Mark won
          </Button>
        )}
        {lead.status !== "lost" && <Button variant="danger-outline" onClick={() => setDialog("lost")}><XCircle className="h-4 w-4" aria-hidden />Mark lost</Button>}
        <Button variant="ghost" onClick={() => setDialog("archive")}><Archive className="h-4 w-4" aria-hidden />Archive</Button>
      </div>

      <Modal open={dialog === "status"} onClose={close} title="Change status">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            const d = formData(e);
            if (d.status === "lost") { setDialog("lost"); return; }
            run(() => changeLeadStatus(lead.id, { status: d.status }), "Status updated");
          }}
        >
          <Field label="New status">
            {(p) => (
              <Select {...p} name="status" defaultValue={lead.status}>
                {LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Update status</Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "lost"} onClose={close} title="Mark lead as lost" description="Record why this opportunity was lost. It is saved to the activity history.">
        <form className="space-y-4" onSubmit={(e) => { const d = formData(e); run(() => changeLeadStatus(lead.id, { status: "lost", lost_reason: d.lost_reason }), "Marked as lost"); }}>
          <Field label="Lost reason" required error={errors.lost_reason}>
            {(p) => <Textarea {...p} name="lost_reason" rows={3} maxLength={500} placeholder="e.g. Budget too low, chose another agency, event cancelled" autoFocus />}
          </Field>
          <p className="text-xs text-muted">Any pending follow-ups for this lead will be cancelled.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="danger" loading={pending}>Mark as lost</Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "note"} onClose={close} title="Add note">
        <form className="space-y-4" onSubmit={(e) => { const d = formData(e); run(() => addLeadNote(lead.id, { note: d.note }), "Note added"); }}>
          <Field label="Note" required error={errors.note}>
            {(p) => <Textarea {...p} name="note" rows={5} maxLength={5000} autoFocus />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Save note</Button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "followup"} onClose={close} title="Schedule follow-up">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            const d = formData(e);
            run(() => createFollowUp(lead.id, { title: d.title, due_at: d.due_at, type: d.type as FollowUpType, notes: d.notes }), "Follow-up scheduled");
          }}
        >
          <Field label="Task" required error={errors.title}>
            {(p) => <Input {...p} name="title" defaultValue={`Follow up: ${lead.contactName ?? lead.title}`} maxLength={200} autoFocus />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due (IST)" required error={errors.due_at}>
              {(p) => <Input {...p} name="due_at" type="datetime-local" defaultValue={followUpDefaults.due} />}
            </Field>
            <Field label="Type" error={errors.type}>
              {(p) => (
                <Select {...p} name="type" defaultValue={followUpDefaults.type}>
                  {FOLLOW_UP_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Notes" error={errors.notes}>
            {(p) => <Textarea {...p} name="notes" rows={3} maxLength={2000} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Schedule</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={dialog === "archive"}
        onClose={close}
        onConfirm={() => run(() => setLeadArchived(lead.id, true), "Lead archived")}
        pending={pending}
        title="Archive this lead?"
        description={`“${lead.title}” will be hidden from lists and the dashboard. Its history is kept and you can restore it any time from Leads → Show archived.`}
        confirmLabel="Archive lead"
      />
    </>
  );
}
