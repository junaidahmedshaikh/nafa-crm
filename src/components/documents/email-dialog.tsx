"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Eye, EyeOff, History, Loader2, Mail, Paperclip, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { getDocumentEmailDraft, sendDocumentEmail, type DocumentEmailDraft } from "@/lib/actions/documents";
import { formatDateTime } from "@/lib/datetime";
import type { DocumentEmailLog } from "@/lib/documents/repo";

type DocType = "quotation" | "invoice" | "proposal";
const LABEL: Record<DocType, string> = { quotation: "quotation", invoice: "invoice", proposal: "proposal" };
const SOURCE_HINT = { document: "From the client details on this document.", contact: "From the linked contact record.", company: "From a contact of the linked company." } as const;
const modalSize = "max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto";

// ---------------------------------------------------------------------------
// Composer. Mount it only while open (`{open && <EmailDialog … />}`) so every opening starts from a fresh draft.
// ---------------------------------------------------------------------------
export function EmailDialog({ type, id, onClose }: { type: DocType; id: string; onClose: () => void }) {
  const [state, setState] = useState<{ draft?: DocumentEmailDraft; error?: string }>({});

  useEffect(() => {
    let live = true;
    getDocumentEmailDraft(type, id)
      .then((r) => { if (live) setState(r.ok ? { draft: r.data } : { error: r.error }); })
      .catch(() => { if (live) setState({ error: "Could not load the email details. Please try again." }); });
    return () => { live = false; };
  }, [type, id]);

  const { draft, error } = state;
  return (
    <Modal open onClose={onClose} title={draft ? `Send ${draft.number} by email` : "Send by email"} description="Review everything below. Nothing is sent until you confirm." className={modalSize}>
      {error ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-danger-soft px-3 py-2 text-danger" role="alert">{error}</p>
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : !draft ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading client and document details…</p>
      ) : !draft.enabled ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">Email sending is not configured on this server yet, so it is switched off — nothing can be sent from here.</p>
          <p className="text-muted">Set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> in the server environment (see README → Email), then restart. Meanwhile, download the PDF and send it from your own mailbox.</p>
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      ) : (
        <Composer type={type} id={id} draft={draft} onClose={onClose} />
      )}
    </Modal>
  );
}

function Composer({ type, id, draft, onClose }: { type: DocType; id: string; draft: DocumentEmailDraft; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copies, setCopies] = useState(false);
  const [preview, setPreview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  // One key per opened composer: if the same send is submitted twice, the provider delivers it only once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const pdfUrl = `/api/documents/${type}/${id}/pdf`;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !reviewed) return;
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    startTransition(async () => {
      const r = await sendDocumentEmail(type, id, { to: f.to, cc: f.cc, bcc: f.bcc, subject: f.subject, message: f.message, idempotencyKey });
      if (r.ok) {
        toast.success(`Email accepted by the provider and sent to ${f.to.trim()}`);
        if (!r.data.logged) toast.warning("The email was sent, but it could not be saved to the email history.");
        onClose();
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {!draft.to && (
        <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>No email address is saved for this client. Enter the recipient below — it is used for this email only and the client record is not changed.</span>
        </p>
      )}
      <Field label="To" required error={errors.to} hint={draft.toSource ? SOURCE_HINT[draft.toSource] : undefined}>
        {(p) => <Input {...p} name="to" type="email" defaultValue={draft.to} placeholder="client@example.com" autoComplete="off" disabled={pending} />}
      </Field>
      {copies ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CC" error={errors.cc} hint="Optional. Separate addresses with commas.">{(p) => <Input {...p} name="cc" autoComplete="off" disabled={pending} />}</Field>
          <Field label="BCC" error={errors.bcc} hint="Optional. Separate addresses with commas.">{(p) => <Input {...p} name="bcc" autoComplete="off" disabled={pending} />}</Field>
        </div>
      ) : (
        <button type="button" className="-mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setCopies(true)}>Add CC / BCC</button>
      )}
      <Field label="Subject" required error={errors.subject}>{(p) => <Input {...p} name="subject" defaultValue={draft.subject} maxLength={200} disabled={pending} />}</Field>
      <Field label="Message" required error={errors.message}>{(p) => <Textarea {...p} name="message" rows={12} defaultValue={draft.message} maxLength={5000} disabled={pending} />}</Field>

      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="flex min-w-0 items-center gap-2 text-sm"><Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="truncate font-medium">{draft.filename}</span></p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPreview((v) => !v)} aria-expanded={preview}>
              {preview ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}{preview ? "Hide preview" : "Preview PDF"}
            </Button>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium hover:bg-foreground/5" href={pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden />Open</a>
          </div>
        </div>
        {preview && <iframe title={`${draft.number} PDF preview`} src={`${pdfUrl}#toolbar=0&navpanes=0`} className="h-[480px] w-full border-t border-border bg-surface-muted" />}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={reviewed} disabled={pending} onChange={(e) => setReviewed(e.target.checked)} />
        I have reviewed the recipient, message and attached PDF, and want to send this {LABEL[type]} now
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending} disabled={!reviewed}>{!pending && <Send className="h-4 w-4" aria-hidden />}{pending ? "Sending…" : "Confirm & send"}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Email history
// ---------------------------------------------------------------------------
export function EmailHistoryDialog({ number, emails, open, onClose }: { number: string | null; emails: DocumentEmailLog[]; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Email history" description={number ? `Every email sent, or attempted, for ${number}.` : undefined} className={modalSize}>
      {emails.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No emails have been sent for this document yet.</p>
      ) : (
        <ul className="space-y-3">
          {emails.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={e.status === "sent" ? "success" : "danger"}>{e.status === "sent" ? "Sent" : "Failed"}</Badge>
                <span className="text-xs text-muted">{formatDateTime(e.sent_at)}</span>
              </div>
              <p className="mt-2 font-medium">{e.subject}</p>
              <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">To</dt><dd className="break-all">{e.to_email}</dd>
                {e.cc_emails.length > 0 && <><dt className="text-muted">CC</dt><dd className="break-all">{e.cc_emails.join(", ")}</dd></>}
                {e.bcc_emails.length > 0 && <><dt className="text-muted">BCC</dt><dd className="break-all">{e.bcc_emails.join(", ")}</dd></>}
                <dt className="text-muted">Sent by</dt><dd>{e.sender?.full_name ?? "—"}</dd>
                <dt className="text-muted">Attachment</dt><dd className="break-all">{e.attachment_name ?? (number ? `${number} (PDF)` : "Document PDF")}</dd>
                {e.error && <><dt className="text-danger">Error</dt><dd className="text-danger">{e.error}</dd></>}
              </dl>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-accent">Email body</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-xs">{e.body}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

/** "Send by Email" + "View email history" for a detail page's action bar. */
export function EmailActions({ type, id, number, canSend, emails }: { type: DocType; id: string; number: string | null; canSend: boolean; emails: DocumentEmailLog[] }) {
  const [dlg, setDlg] = useState<null | "send" | "history">(null);
  if (!number) return null;
  return (
    <>
      {canSend && <Button onClick={() => setDlg("send")}><Mail className="h-4 w-4" aria-hidden />Send by Email</Button>}
      <Button onClick={() => setDlg("history")}><History className="h-4 w-4" aria-hidden />View Email History{emails.length > 0 ? ` (${emails.length})` : ""}</Button>
      {dlg === "send" && <EmailDialog type={type} id={id} onClose={() => setDlg(null)} />}
      <EmailHistoryDialog number={number} emails={emails} open={dlg === "history"} onClose={() => setDlg(null)} />
    </>
  );
}

/** Row action for the list pages. */
export function EmailRowAction({ type, id, number }: { type: DocType; id: string; number: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label={`Send ${number} by email`} title="Send by Email"><Mail className="h-4 w-4" aria-hidden /></Button>
      {open && <EmailDialog type={type} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
