"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CalendarClock, Loader2, Paperclip, Pencil, Save, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { cancelScheduledEmail, getScheduleContext, saveScheduledEmail, sendScheduledNow, setInvoiceAutoReminder, type SaveMode } from "@/lib/actions/scheduled";
import { DEFAULT_TIMEZONE, isoToZoned, TIMEZONES, type RelatedType } from "@/lib/scheduled/core";

type Kind = "follow_up" | "payment_reminder";
/** The fields of an existing row that the composer needs when editing it. */
export type EditableEmail = {
  id: string; kind: Kind; related_type: string | null; related_id: string | null; related_label: string; to_email: string; cc_emails: string[];
  subject: string; body: string; attach_document: boolean; scheduled_at: string | null; timezone: string;
};
type Draft = {
  relatedType: RelatedType | null; relatedId: string | null; label: string; to: string; cc: string; subject: string; body: string; canAttach: boolean; attach: boolean;
  date: string; time: string; timezone: string;
};

const modalSize = "max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto";
/** Tomorrow 10:00 in the chosen zone: a sensible default that is never in the past. */
function defaultWhen(tz: string) {
  const z = isoToZoned(new Date(Date.now() + 86400000).toISOString(), tz);
  return { date: z.date, time: "10:00" };
}

/** Composer for a follow-up or payment-reminder email. Mount it only while open so each opening starts fresh. */
export function ScheduleEmailDialog({ type, id, kind = "follow_up", edit, onClose }: { type?: RelatedType | null; id?: string | null; kind?: Kind; edit?: EditableEmail; onClose: () => void }) {
  const [state, setState] = useState<{ draft?: Draft; error?: string }>(() => {
    if (!edit) return {};
    const tz = (TIMEZONES as readonly string[]).includes(edit.timezone) ? edit.timezone : DEFAULT_TIMEZONE;
    const when = edit.scheduled_at ? isoToZoned(edit.scheduled_at, tz) : defaultWhen(tz);
    return {
      draft: {
        relatedType: (edit.related_type as RelatedType | null) ?? null, relatedId: edit.related_id, label: edit.related_label, to: edit.to_email, cc: edit.cc_emails.join(", "),
        subject: edit.subject, body: edit.body, canAttach: edit.related_type === "quotation" || edit.related_type === "invoice", attach: edit.attach_document, ...when, timezone: tz,
      },
    };
  });
  const k: Kind = edit?.kind ?? kind;

  useEffect(() => {
    if (edit) return;
    let live = true;
    getScheduleContext(type ?? null, id ?? null, k)
      .then((r) => {
        if (!live) return;
        if (!r.ok) return setState({ error: r.error });
        const c = r.data;
        setState({ draft: { relatedType: c.relatedType, relatedId: c.relatedId, label: c.label, to: c.to, cc: "", subject: c.subject, body: c.body, canAttach: c.canAttach, attach: c.canAttach && k === "payment_reminder", ...defaultWhen(DEFAULT_TIMEZONE), timezone: DEFAULT_TIMEZONE } });
      })
      .catch(() => { if (live) setState({ error: "Could not load the details. Please try again." }); });
    return () => { live = false; };
  }, [type, id, k, edit]);

  const title = `${edit ? "Edit" : "New"} ${k === "payment_reminder" ? "payment reminder" : "follow-up email"}${state.draft?.label ? ` · ${state.draft.label}` : ""}`;
  return (
    <Modal open onClose={onClose} title={title} description="Send it now, schedule it for later, or keep it as a draft. Nothing is sent without your choice." className={modalSize}>
      {state.error ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-danger-soft px-3 py-2 text-danger" role="alert">{state.error}</p>
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : !state.draft ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading client details…</p>
      ) : (
        <Composer draft={state.draft} kind={k} editId={edit?.id} onClose={onClose} />
      )}
    </Modal>
  );
}

function Composer({ draft, kind, editId, onClose }: { draft: Draft; kind: Kind; editId?: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<SaveMode | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmNow, setConfirmNow] = useState(false);

  function submit(form: HTMLFormElement, mode: SaveMode) {
    if (pending) return;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setBusy(mode);
    startTransition(async () => {
      const r = await saveScheduledEmail({
        kind, related_type: draft.relatedType, related_id: draft.relatedId, to: f.to, cc: f.cc, subject: f.subject, body: f.body,
        attach_document: f.attach === "on", date: f.date, time: f.time, timezone: f.timezone as (typeof TIMEZONES)[number],
      }, mode, editId);
      setBusy(null);
      setConfirmNow(false);
      if (r.ok) { toast.success(r.data.message); onClose(); router.refresh(); }
      else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); router.refresh(); }
    });
  }

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget, "schedule"); }}>
      {!draft.to && (
        <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>No email address is saved for this client. Enter the recipient below — the client record is not changed.</span>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="To" required error={errors.to}>{(p) => <Input {...p} name="to" type="email" defaultValue={draft.to} placeholder="client@example.com" autoComplete="off" disabled={pending} />}</Field>
        <Field label="CC" error={errors.cc} hint="Optional. Separate addresses with commas.">{(p) => <Input {...p} name="cc" defaultValue={draft.cc} autoComplete="off" disabled={pending} />}</Field>
      </div>
      <Field label="Subject" required error={errors.subject}>{(p) => <Input {...p} name="subject" defaultValue={draft.subject} maxLength={200} disabled={pending} />}</Field>
      <Field label="Message" required error={errors.body}>{(p) => <Textarea {...p} name="body" rows={10} defaultValue={draft.body} maxLength={5000} disabled={pending} />}</Field>
      {draft.canAttach && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="attach" className="h-4 w-4" defaultChecked={draft.attach} disabled={pending} />
          <Paperclip className="h-4 w-4 text-muted" aria-hidden />Attach the PDF of {draft.label}
          {draft.relatedType && draft.relatedId && <a className="text-accent underline" href={`/api/documents/${draft.relatedType}/${draft.relatedId}/pdf`} target="_blank" rel="noopener noreferrer">preview</a>}
        </label>
      )}
      <fieldset className="rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-muted">Schedule for later</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" error={errors.date}>{(p) => <Input {...p} name="date" type="date" defaultValue={draft.date} disabled={pending} />}</Field>
          <Field label="Time" error={errors.time}>{(p) => <Input {...p} name="time" type="time" defaultValue={draft.time} disabled={pending} />}</Field>
          <Field label="Time zone">{(p) => <Select {...p} name="timezone" defaultValue={draft.timezone} disabled={pending}>{TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select>}</Field>
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        <Button onClick={(e) => submit(e.currentTarget.form!, "draft")} loading={busy === "draft"} disabled={pending}>{busy !== "draft" && <Save className="h-4 w-4" aria-hidden />}Save as draft</Button>
        {confirmNow ? (
          <Button variant="accent" onClick={(e) => submit(e.currentTarget.form!, "now")} loading={busy === "now"} disabled={pending}>{busy === "now" ? "Sending…" : "Yes, send it now"}</Button>
        ) : (
          <Button onClick={() => setConfirmNow(true)} disabled={pending}><Send className="h-4 w-4" aria-hidden />Send now</Button>
        )}
        <Button type="submit" variant="primary" loading={busy === "schedule"} disabled={pending}>{busy !== "schedule" && <CalendarClock className="h-4 w-4" aria-hidden />}Schedule</Button>
      </div>
    </form>
  );
}

/** Button that opens the composer for a record (contact, lead, quotation, invoice, project) or a blank email. */
export function ScheduleEmailButton({
  type, id, kind = "follow_up", label, variant = "secondary", size,
}: { type?: RelatedType; id?: string; kind?: Kind; label?: string; variant?: "primary" | "secondary" | "accent" | "ghost"; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const Icon = kind === "payment_reminder" ? BellRing : CalendarClock;
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}><Icon className="h-4 w-4" aria-hidden />{label ?? (kind === "payment_reminder" ? "Payment reminder" : "Schedule follow-up")}</Button>
      {open && <ScheduleEmailDialog type={type} id={id} kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Edit / send now / cancel for one row of the scheduled-emails list. */
export function ScheduledRowActions({ row, status }: { row: EditableEmail; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dlg, setDlg] = useState<null | "edit" | "send" | "cancel">(null);
  if (!["draft", "scheduled", "failed"].includes(status)) return null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: { message: string } }>, ok: string) =>
    startTransition(async () => {
      const r = await fn();
      setDlg(null);
      if (r.ok) toast.success(r.data?.message ?? ok); else toast.error(r.error ?? "Something went wrong");
      router.refresh();
    });
  return (
    <div className="flex justify-end gap-1">
      <Button size="icon" variant="ghost" onClick={() => setDlg("edit")} aria-label="Edit or reschedule" title="Edit / reschedule"><Pencil className="h-4 w-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" onClick={() => setDlg("send")} aria-label="Send now" title="Send now"><Send className="h-4 w-4" aria-hidden /></Button>
      <Button size="icon" variant="ghost" onClick={() => setDlg("cancel")} aria-label="Cancel email" title="Cancel"><XCircle className="h-4 w-4 text-danger" aria-hidden /></Button>
      {dlg === "edit" && <ScheduleEmailDialog edit={row} onClose={() => setDlg(null)} />}
      <ConfirmDialog open={dlg === "send"} onClose={() => setDlg(null)} pending={pending} destructive={false} confirmLabel="Send now" title="Send this email now?"
        description={`It will be sent immediately to ${row.to_email}, exactly as written.`} onConfirm={() => run(() => sendScheduledNow(row.id), "Email sent")} />
      <ConfirmDialog open={dlg === "cancel"} onClose={() => setDlg(null)} pending={pending} confirmLabel="Cancel email" title="Cancel this email?"
        description="It will not be sent. It stays in the list as Cancelled." onConfirm={() => run(() => cancelScheduledEmail(row.id), "Email cancelled")} />
    </div>
  );
}

/** Per-invoice switch for automatic payment reminders. */
export function AutoReminderToggle({ invoiceId, enabled }: { invoiceId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" className="h-4 w-4" checked={enabled} disabled={pending}
        onChange={(e) => { const on = e.target.checked; startTransition(async () => { const r = await setInvoiceAutoReminder(invoiceId, on); if (r.ok) toast.success(on ? "Automatic reminders on for this invoice" : "Automatic reminders off for this invoice"); else toast.error(r.error); router.refresh(); }); }} />
      Auto
    </label>
  );
}
