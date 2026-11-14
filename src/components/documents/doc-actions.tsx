"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban, Check, CopyPlus, Download, FileCheck2, FilePen, FileSymlink, FileX2, Pencil, ReceiptText, Send, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { EmailActions } from "@/components/documents/email-dialog";
import { ScheduleEmailButton } from "@/components/scheduled/schedule-dialog";
import {
  cancelInvoice, convertQuotationToInvoice, deleteDraft, duplicateInvoice, duplicateProposal, duplicateQuotation, issueInvoice, issueProposal, issueQuotation,
  recordPayment, reviseQuotation, setProposalStatus, setQuotationStatus, voidPayment,
} from "@/lib/actions/documents";
import { formatINR } from "@/lib/format";
import { formatDate } from "@/lib/datetime";
import type { DocumentEmailLog } from "@/lib/documents/repo";
import { cn } from "@/lib/utils";

type DocType = "quotation" | "invoice" | "proposal";
type EmailProps = { number: string | null; emails: DocumentEmailLog[] };
type Result = { ok: boolean; error?: string; fieldErrors?: Record<string, string>; code?: string };

const linkBtn = "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border-strong bg-surface px-3.5 text-xs font-semibold text-foreground hover:bg-surface-muted shadow-xs transition-colors cursor-pointer";

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // refresh=false for actions that navigate away (e.g. deleting a draft): refreshing would re-render a page whose record no longer exists.
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void, refresh = true) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); after?.(); if (refresh) router.refresh(); } else toast.error(r.error ?? "Something went wrong");
    });
  return { router, pending, run, startTransition };
}

function Downloads({ type, id }: { type: DocType; id: string }) {
  return (
    <>
      <a className={linkBtn} href={`/api/documents/${type}/${id}/pdf?download=1`}><Download className="h-4 w-4" aria-hidden />Download PDF</a>
      <a className={linkBtn} href={`/api/documents/${type}/${id}/pdf`} target="_blank" rel="noopener noreferrer"><FileCheck2 className="h-4 w-4" aria-hidden />Open PDF</a>
    </>
  );
}

// ---------------------------------------------------------------------------
// Quotation
// ---------------------------------------------------------------------------
export function QuotationActions({ id, status, effectiveStatus, invoiceCount, email }: { id: string; status: string; effectiveStatus: string; invoiceCount: number; email: EmailProps }) {
  const { router, pending, run } = useRunner();
  const [dlg, setDlg] = useState<null | "issue" | "delete" | "convert" | "convert2" | "reject">(null);
  const close = () => setDlg(null);
  const open = status !== "draft";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <Link href={`/quotations/${id}/edit`} className={linkBtn}><Pencil className="h-4 w-4" aria-hidden />Edit</Link>
            <Button variant="accent" onClick={() => setDlg("issue")}><Send className="h-4 w-4" aria-hidden />Issue &amp; mark as sent</Button>
          </>
        )}
        <Downloads type="quotation" id={id} />
        <EmailActions type="quotation" id={id} number={email.number} canSend={open} emails={email.emails} />
        {open && <ScheduleEmailButton type="quotation" id={id} />}
        {(status === "sent" || status === "expired") && (
          <>
            <Button onClick={() => run(() => setQuotationStatus(id, "accepted"), "Marked as accepted")} disabled={pending}><Check className="h-4 w-4" aria-hidden />Mark accepted</Button>
            <Button onClick={() => setDlg("reject")} disabled={pending}><X className="h-4 w-4" aria-hidden />Mark rejected</Button>
            {status === "sent" && effectiveStatus !== "expired" && <Button variant="ghost" onClick={() => run(() => setQuotationStatus(id, "expired"), "Marked as expired")} disabled={pending}><Ban className="h-4 w-4" aria-hidden />Mark expired</Button>}
          </>
        )}
        {status === "accepted" && <Button variant="accent" onClick={() => setDlg("convert")}><ReceiptText className="h-4 w-4" aria-hidden />Convert to invoice</Button>}
        {open && status !== "revised" && <Button onClick={() => run(async () => { const r = await reviseQuotation(id); if (r.ok && r.data) router.push(`/quotations/${r.data.id}/edit`); return r; }, "Revision draft created")} disabled={pending}><FilePen className="h-4 w-4" aria-hidden />Revise</Button>}
        <Button onClick={() => run(async () => { const r = await duplicateQuotation(id); if (r.ok && r.data) router.push(`/quotations/${r.data.id}/edit`); return r; }, "Duplicate draft created")} disabled={pending}><CopyPlus className="h-4 w-4" aria-hidden />Duplicate</Button>
        {status === "draft" && <Button variant="danger-outline" onClick={() => setDlg("delete")}><Trash2 className="h-4 w-4" aria-hidden />Delete draft</Button>}
      </div>

      <ConfirmDialog open={dlg === "issue"} onClose={close} pending={pending} destructive={false} confirmLabel="Issue quotation"
        title="Issue this quotation?" description="It will receive the next quotation number, be marked as sent, and be locked — issued quotations cannot be edited (you can create a revision instead). A snapshot of the rates, fees and tax settings is saved."
        onConfirm={() => run(() => issueQuotation(id), "Quotation issued", close)} />
      <ConfirmDialog open={dlg === "delete"} onClose={close} pending={pending} confirmLabel="Delete draft" title="Delete this draft?" description="Drafts have no number and can be deleted. This cannot be undone."
        onConfirm={() => run(async () => { const r = await deleteDraft("quotation", id); if (r.ok) router.replace("/quotations"); return r; }, "Draft deleted", close, false)} />
      <ConfirmDialog open={dlg === "reject"} onClose={close} pending={pending} confirmLabel="Mark rejected" title="Mark as rejected?" description="Use this when the client has declined. A rejected quotation cannot be converted to an invoice."
        onConfirm={() => run(() => setQuotationStatus(id, "rejected"), "Marked as rejected", close)} />
      <ConfirmDialog open={dlg === "convert"} onClose={close} pending={pending} destructive={false} confirmLabel="Create invoice draft"
        title="Convert to invoice?" description={invoiceCount > 0 ? `This quotation already has ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}. Continue to review that before creating another.` : "A draft invoice will be created with this quotation's client, items, prices, tax and discount settings. You can adjust it before issuing."}
        onConfirm={() => {
          if (invoiceCount > 0) { setDlg("convert2"); return; }
          run(async () => {
            const r = await convertQuotationToInvoice(id, false);
            if (!r.ok && r.code === "already_converted") { setDlg("convert2"); return { ok: true }; }
            if (r.ok && r.data) router.push(`/invoices/${r.data.id}/edit`);
            return r;
          }, "Invoice draft created", close);
        }} />
      <ConfirmDialog open={dlg === "convert2"} onClose={close} pending={pending} confirmLabel="Yes, create another invoice"
        title="This quotation was already converted" description="An invoice already exists for this quotation. Create an additional one only if you really need it (for example a separate invoice per milestone)."
        onConfirm={() => run(async () => { const r = await convertQuotationToInvoice(id, true); if (r.ok && r.data) router.push(`/invoices/${r.data.id}/edit`); return r; }, "Additional invoice draft created", close)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------
export function InvoiceActions({ id, state, balance, email }: { id: string; state: string; balance: number; email: EmailProps }) {
  const { router, pending, run } = useRunner();
  const [dlg, setDlg] = useState<null | "issue" | "delete" | "cancel" | "pay">(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const close = () => { setDlg(null); setErrors({}); };
  const [today] = useState(() => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));

  function submitForm<T extends Result>(action: (f: Record<string, string>) => Promise<T>, ok: string) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      run(async () => { const r = await action(f); if (!r.ok) setErrors(r.fieldErrors ?? {}); return r; }, ok, close);
    };
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {state === "draft" && (
          <>
            <Link href={`/invoices/${id}/edit`} className={linkBtn}><Pencil className="h-4 w-4" aria-hidden />Edit</Link>
            <Button variant="accent" onClick={() => setDlg("issue")}><Send className="h-4 w-4" aria-hidden />Issue invoice</Button>
          </>
        )}
        <Downloads type="invoice" id={id} />
        {state === "issued" && <Button variant="accent" onClick={() => setDlg("pay")} disabled={balance <= 0}><FileSymlink className="h-4 w-4" aria-hidden />Record payment</Button>}
        <EmailActions type="invoice" id={id} number={email.number} canSend={state === "issued"} emails={email.emails} />
        {state === "issued" && <ScheduleEmailButton type="invoice" id={id} />}
        {state === "issued" && balance > 0 && <ScheduleEmailButton type="invoice" id={id} kind="payment_reminder" />}
        {state === "issued" && <Button variant="danger-outline" onClick={() => setDlg("cancel")}><FileX2 className="h-4 w-4" aria-hidden />Cancel invoice</Button>}
        <Button onClick={() => run(async () => { const r = await duplicateInvoice(id); if (r.ok && r.data) router.push(`/invoices/${r.data.id}/edit`); return r; }, state === "cancelled" ? "Corrected draft created" : "Duplicate draft created")} disabled={pending}>
          <CopyPlus className="h-4 w-4" aria-hidden />{state === "issued" || state === "cancelled" ? "Create corrected draft" : "Duplicate"}
        </Button>
        {state === "draft" && <Button variant="danger-outline" onClick={() => setDlg("delete")}><Trash2 className="h-4 w-4" aria-hidden />Delete draft</Button>}
      </div>

      <ConfirmDialog open={dlg === "issue"} onClose={close} pending={pending} destructive={false} confirmLabel="Issue invoice" title="Issue this invoice?"
        description="It will receive the next invoice number and be locked. Issued invoices cannot be edited — to amend one you cancel it (with a reason) and create a corrected draft. Rates, tax settings and bank details are saved as a snapshot."
        onConfirm={() => run(() => issueInvoice(id), "Invoice issued", close)} />
      <ConfirmDialog open={dlg === "delete"} onClose={close} pending={pending} confirmLabel="Delete draft" title="Delete this draft?" description="Drafts have no number and can be deleted. This cannot be undone."
        onConfirm={() => run(async () => { const r = await deleteDraft("invoice", id); if (r.ok) router.replace("/invoices"); return r; }, "Draft deleted", close, false)} />

      <Modal open={dlg === "cancel"} onClose={close} title="Cancel this invoice" description="The invoice number is never reused. Cancelling is only possible when no payments are recorded (void them first).">
        <form className="space-y-4" onSubmit={submitForm((f) => cancelInvoice(id, f.reason), "Invoice cancelled")}>
          <Field label="Reason" required error={errors.reason}>{(p) => <Textarea {...p} name="reason" rows={3} maxLength={500} autoFocus />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={close} disabled={pending}>Keep invoice</Button><Button type="submit" variant="danger" loading={pending}>Cancel invoice</Button></div>
        </form>
      </Modal>

      <Modal open={dlg === "pay"} onClose={close} title="Record payment" description={`Balance due: ${formatINR(balance, { exact: true })}. Advance and part-payments are recorded as payments, never as discounts.`}>
        <form className="space-y-4" onSubmit={submitForm((f) => recordPayment(id, { paid_on: f.paid_on, amount: f.amount, method: f.method, reference: f.reference, notes: f.notes }), "Payment recorded")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} name="amount" inputMode="decimal" defaultValue={String(balance)} autoFocus />}</Field>
            <Field label="Payment date" required error={errors.paid_on}>{(p) => <Input {...p} name="paid_on" type="date" defaultValue={today} />}</Field>
            <Field label="Method" error={errors.method}>{(p) => (
              <Select {...p} name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option>
              </Select>)}
            </Field>
            <Field label="Transaction / reference no." error={errors.reference}>{(p) => <Input {...p} name="reference" maxLength={100} />}</Field>
          </div>
          <Field label="Notes" error={errors.notes}>{(p) => <Textarea {...p} name="notes" rows={2} maxLength={500} />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={close} disabled={pending}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>Record payment</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function PaymentsTable({
  payments, canVoid,
}: { payments: { id: string; paid_on: string; amount: number; method: string; reference: string | null; notes: string | null; voided_at: string | null; voided_reason: string | null }[]; canVoid: boolean }) {
  const { pending, run } = useRunner();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  if (!payments.length) return <p className="px-5 py-6 text-center text-sm text-muted">No payments recorded yet.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className={cn("min-w-0", p.voided_at && "text-muted line-through")}>
              <p className="text-sm font-medium tabular-nums">{formatINR(p.amount, { exact: true })} <span className="font-normal text-muted">· {p.method.replace("_", " ")}</span></p>
              <p className="text-xs text-muted">{formatDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
            </div>
            {p.voided_at ? <span className="text-xs text-muted">Voided: {p.voided_reason}</span> : canVoid && <Button size="sm" variant="ghost" onClick={() => setVoiding(p.id)}>Void</Button>}
          </li>
        ))}
      </ul>
      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Void this payment" description="Voided payments stay in the history but no longer count towards the balance.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason") ?? ""); run(async () => { const r = await voidPayment(voiding!, reason); if (!r.ok) setError(r.fieldErrors?.reason); return r; }, "Payment voided", () => setVoiding(null)); }}>
          <Field label="Reason" required error={error}>{(p) => <Textarea {...p} name="reason" rows={2} maxLength={300} autoFocus />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setVoiding(null)} disabled={pending}>Cancel</Button><Button type="submit" variant="danger" loading={pending}>Void payment</Button></div>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------
export function ProposalActions({ id, status, email }: { id: string; status: string; email: EmailProps }) {
  const { router, pending, run } = useRunner();
  const [dlg, setDlg] = useState<null | "issue" | "delete">(null);
  const close = () => setDlg(null);
  const open = status !== "draft";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <Link href={`/proposals/${id}/edit`} className={linkBtn}><Pencil className="h-4 w-4" aria-hidden />Edit</Link>
            <Button variant="accent" onClick={() => setDlg("issue")}><Send className="h-4 w-4" aria-hidden />Issue &amp; mark as sent</Button>
          </>
        )}
        <Downloads type="proposal" id={id} />
        <EmailActions type="proposal" id={id} number={email.number} canSend={open} emails={email.emails} />
        {status === "sent" && (
          <>
            <Button onClick={() => run(() => setProposalStatus(id, "accepted"), "Marked as accepted")} disabled={pending}><Check className="h-4 w-4" aria-hidden />Mark accepted</Button>
            <Button onClick={() => run(() => setProposalStatus(id, "rejected"), "Marked as rejected")} disabled={pending}><X className="h-4 w-4" aria-hidden />Mark rejected</Button>
          </>
        )}
        {open && status !== "revised" && <Button onClick={() => run(async () => { const r = await duplicateProposal(id, true); if (r.ok && r.data) router.push(`/proposals/${r.data.id}/edit`); return r; }, "Revision draft created")} disabled={pending}><FilePen className="h-4 w-4" aria-hidden />Revise</Button>}
        <Button onClick={() => run(async () => { const r = await duplicateProposal(id, false); if (r.ok && r.data) router.push(`/proposals/${r.data.id}/edit`); return r; }, "Duplicate draft created")} disabled={pending}><CopyPlus className="h-4 w-4" aria-hidden />Duplicate</Button>
        {status === "draft" && <Button variant="danger-outline" onClick={() => setDlg("delete")}><Trash2 className="h-4 w-4" aria-hidden />Delete draft</Button>}
      </div>
      <ConfirmDialog open={dlg === "issue"} onClose={close} pending={pending} destructive={false} confirmLabel="Issue proposal" title="Issue this proposal?"
        description="It will receive the next proposal number, be marked as sent and be locked. Create a revision to change it later."
        onConfirm={() => run(() => issueProposal(id), "Proposal issued", close)} />
      <ConfirmDialog open={dlg === "delete"} onClose={close} pending={pending} confirmLabel="Delete draft" title="Delete this draft?" description="Drafts can be deleted. This cannot be undone."
        onConfirm={() => run(async () => { const r = await deleteDraft("proposal", id); if (r.ok) router.replace("/proposals"); return r; }, "Draft deleted", close, false)} />
    </>
  );
}
