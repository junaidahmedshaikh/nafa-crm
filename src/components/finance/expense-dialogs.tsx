"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, Undo2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { ApprovalBadge, PaymentStatusBadge } from "@/components/finance/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { addCategory, deleteRecord, recordExpensePayment, restoreRecord, saveExpense, setExpenseApproval, voidExpensePayment } from "@/lib/actions/finance";
import { expenseTotals } from "@/lib/finance/calc";
import type { Category, ExpenseRow, PaymentRow, Vendor } from "@/lib/finance/repo";
import { MODE_LABELS, PAYMENT_MODES } from "@/lib/finance/schemas";
import { formatDate } from "@/lib/datetime";
import { formatINR } from "@/lib/format";

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Add / edit expense
// ---------------------------------------------------------------------------
export function ExpenseDialog({
  projectId, categories, vendors, expense, open, onClose, canAddCategory,
}: {
  projectId: string; categories: Category[]; vendors: Vendor[]; expense?: ExpenseRow | null; open: boolean; onClose: () => void; canAddCategory: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cats, setCats] = useState(categories);
  const [qty, setQty] = useState(expense ? String(expense.qty) : "1");
  const [rate, setRate] = useState(expense ? String(expense.rate) : "");
  const [gst, setGst] = useState(expense ? String(expense.gst_amount) : "0");
  const totals = useMemo(() => expenseTotals(qty, rate, gst), [qty, rate, gst]);
  const vendorName = expense?.vendor_name ?? "";
  const close = () => { setErrors({}); onClose(); };

  function newCategory() {
    const name = window.prompt("New expense category name");
    if (!name?.trim()) return;
    startTransition(async () => {
      const r = await addCategory(name.trim());
      if (r.ok) { setCats((c) => [...c, { id: r.data.id, name: name.trim(), sort_order: 200, is_active: true }]); toast.success("Category added"); router.refresh(); } else toast.error(r.error);
    });
  }

  return (
    <Modal open={open} onClose={close} title={expense ? `Edit expense ${expense.expense_code}` : "Add expense"} description="Amounts exclude GST; enter GST separately. Recoverable input GST is not counted as a project cost." className="max-w-2xl">
      <form
        key={expense?.id ?? "new"}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = Object.fromEntries(f) as Record<string, string>;
          const known = vendors.find((x) => x.name.toLowerCase() === v.vendor_name.trim().toLowerCase());
          startTransition(async () => {
            const r = await saveExpense({ ...v, project_id: projectId, vendor_id: known?.id ?? "", vendor_name: known ? "" : v.vendor_name, gst_recoverable: f.get("gst_recoverable") === "on" } as never, expense?.id);
            if (r.ok) { toast.success(expense ? "Expense saved" : "Expense added"); close(); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expense date" required error={errors.expense_date}>{(p) => <Input {...p} type="date" name="expense_date" defaultValue={expense?.expense_date ?? today()} />}</Field>
          <Field label="Category" required error={errors.category_id}>
            {(p) => (
              <div className="flex gap-2">
                <Select {...p} name="category_id" defaultValue={expense?.category_id ?? ""}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                {canAddCategory && <Button onClick={newCategory} aria-label="Add a custom category" size="icon" variant="outline"><Plus className="h-4 w-4" /></Button>}
              </div>
            )}
          </Field>
          <Field label="Title" required className="sm:col-span-2" hint="A short name shown in the expense list and the Profit &amp; Loss, e.g. “LED wall 12x8”" error={errors.title}>{(p) => <Input {...p} name="title" defaultValue={expense?.title} autoFocus />}</Field>
          <Field label="Details" className="sm:col-span-2" hint="Optional: what exactly was bought or done" error={errors.description}>{(p) => <Input {...p} name="description" defaultValue={expense?.description} />}</Field>
          <Field label="Vendor / supplier" hint="Pick an existing vendor or type a new name" error={errors.vendor_name}>
            {(p) => <><Input {...p} name="vendor_name" list="vendor-options" defaultValue={vendorName} autoComplete="off" /><datalist id="vendor-options">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist></>}
          </Field>
          <Field label="Invoice / bill number" error={errors.bill_number}>{(p) => <Input {...p} name="bill_number" defaultValue={expense?.bill_number ?? ""} />}</Field>
          <Field label="Quantity" required error={errors.qty}>{(p) => <Input {...p} name="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label="Unit" required error={errors.unit}>{(p) => <Input {...p} name="unit" defaultValue={expense?.unit ?? "nos"} />}</Field>
          <Field label="Rate (₹)" required error={errors.rate}>{(p) => <Input {...p} name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
          <Field label="GST amount (₹)" hint="If applicable" error={errors.gst_amount}>{(p) => <Input {...p} name="gst_amount" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} />}</Field>
          <div className="sm:col-span-2 rounded-md bg-surface-muted p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular-nums">{formatINR(totals.subtotal, { exact: true })}</span></div>
            <div className="flex justify-between font-semibold"><span>Total expense amount</span><span className="tabular-nums">{formatINR(totals.total, { exact: true })}</span></div>
          </div>
          <label className="sm:col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="gst_recoverable" className="mt-0.5 h-4 w-4" defaultChecked={expense ? expense.gst_recoverable : true} />
            <span>GST on this bill is recoverable input credit <span className="block text-xs text-muted">Untick if it cannot be claimed — it will then count as a project cost.</span></span>
          </label>
          <Field label="Estimated amount (₹)" hint="Optional, for estimated vs actual" error={errors.estimated_amount}>{(p) => <Input {...p} name="estimated_amount" inputMode="decimal" defaultValue={expense?.estimated_amount == null ? "" : String(expense.estimated_amount)} />}</Field>
          <Field label="Payment due date" error={errors.due_date}>{(p) => <Input {...p} type="date" name="due_date" defaultValue={expense?.due_date ?? ""} />}</Field>
          <Field label="Notes" className="sm:col-span-2" error={errors.notes}>{(p) => <Textarea {...p} name="notes" rows={2} defaultValue={expense?.notes} />}</Field>
        </div>
        <div className="flex justify-end gap-2"><Button onClick={close} disabled={pending}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>{expense ? "Save expense" : "Add expense"}</Button></div>
      </form>
    </Modal>
  );
}

export function AddExpenseButton(props: Omit<React.ComponentProps<typeof ExpenseDialog>, "open" | "onClose" | "expense">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Quick add expense</Button>
      <ExpenseDialog {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Row actions: edit, payments, approve/reject, delete / restore
// ---------------------------------------------------------------------------
export function ExpenseRowActions({
  expense, payments, categories, vendors, manage, canEdit, isAdmin, trash,
}: {
  expense: ExpenseRow; payments: PaymentRow[]; categories: Category[]; vendors: Vendor[]; manage: boolean; canEdit: boolean; isAdmin: boolean; trash?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Failed"); });

  if (trash) {
    return isAdmin ? <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => restoreRecord("expense", expense.id), "Expense restored")}><Undo2 className="h-4 w-4" aria-hidden />Restore</Button> : null;
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {manage && expense.approval_status === "submitted" && (
        <>
          <Button size="icon" variant="ghost" aria-label="Approve expense" title="Approve" loading={pending} onClick={() => run(() => setExpenseApproval(expense.id, "approved"), "Expense approved")}><Check className="h-4 w-4 text-success" /></Button>
          <Button size="icon" variant="ghost" aria-label="Reject expense" title="Reject" disabled={pending} onClick={() => run(() => setExpenseApproval(expense.id, "rejected"), "Expense rejected")}><X className="h-4 w-4 text-danger" /></Button>
        </>
      )}
      {manage && expense.approval_status === "approved" && <Button size="icon" variant="ghost" aria-label="Payments" title="Payments" onClick={() => setPay(true)}><Wallet className="h-4 w-4" /></Button>}
      {canEdit && <Button size="icon" variant="ghost" aria-label={`Edit ${expense.expense_code}`} title="Edit" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /></Button>}
      {manage && <Button size="icon" variant="ghost" aria-label={`Delete ${expense.expense_code}`} title="Delete" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 text-danger" /></Button>}

      {edit && <ExpenseDialog projectId={expense.project_id} categories={categories} vendors={vendors} expense={expense} open onClose={() => setEdit(false)} canAddCategory={manage} />}
      {pay && <PaymentsDialog expense={expense} payments={payments} onClose={() => setPay(false)} />}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} pending={pending} title="Delete this expense?" confirmLabel="Delete"
        description="It is removed from totals and the project's profit, and recorded in the audit log. An administrator can restore it later."
        onConfirm={() => run(async () => { const r = await deleteRecord("expense", expense.id); setConfirmDelete(false); return r; }, "Expense deleted")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments against one bill (partial payments allowed; voided, never deleted)
// ---------------------------------------------------------------------------
function PaymentsDialog({ expense, payments, onClose }: { expense: ExpenseRow; payments: PaymentRow[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const outstanding = Number(expense.outstanding_amount);
  const mine = payments.filter((p) => p.expense_id === expense.id);

  return (
    <Modal open onClose={onClose} title={`Payments · ${expense.expense_code}`} description={`${expense.vendor_name ?? "No vendor"} · ${expense.title}`} className="max-w-2xl">
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs text-muted">Bill total</p><p className="font-semibold tabular-nums">{formatINR(expense.total_amount, { exact: true })}</p></div>
        <div><p className="text-xs text-muted">Paid</p><p className="font-semibold tabular-nums">{formatINR(expense.paid_amount, { exact: true })}</p></div>
        <div><p className="text-xs text-muted">Outstanding</p><p className="font-semibold tabular-nums text-danger">{formatINR(outstanding, { exact: true })}</p></div>
      </div>
      <ul className="mb-4 divide-y divide-border rounded-md border border-border text-sm">
        {mine.length === 0 && <li className="px-3 py-3 text-muted">No payments recorded yet.</li>}
        {mine.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className={p.voided_at ? "text-muted line-through" : ""}>
              <p className="tabular-nums">{formatINR(p.amount, { exact: true })} · {MODE_LABELS[p.method as keyof typeof MODE_LABELS] ?? p.method}</p>
              <p className="text-xs text-muted">{formatDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}{p.voided_at ? ` · voided: ${p.voided_reason}` : ""}</p>
            </div>
            {!p.voided_at && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
                const reason = window.prompt("Reason for voiding this payment");
                if (!reason) return;
                startTransition(async () => { const r = await voidExpensePayment(p.id, reason); if (r.ok) { toast.success("Payment voided"); router.refresh(); } else toast.error(r.error); });
              }}>Void</Button>
            )}
          </li>
        ))}
      </ul>
      {outstanding > 0 && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
            startTransition(async () => {
              const r = await recordExpensePayment(expense.id, v as never);
              if (r.ok) { toast.success("Payment recorded"); onClose(); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
            });
          }}
        >
          <Field label="Payment date" required error={errors.paid_on}>{(p) => <Input {...p} type="date" name="paid_on" defaultValue={today()} />}</Field>
          <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} name="amount" inputMode="decimal" defaultValue={String(outstanding)} />}</Field>
          <Field label="Payment mode" error={errors.method}>{(p) => <Select {...p} name="method" defaultValue="bank_transfer">{PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}</Select>}</Field>
          <Field label="Transaction reference" error={errors.reference}>{(p) => <Input {...p} name="reference" placeholder="UTR / cheque no." />}</Field>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" loading={pending}>Record payment</Button></div>
        </form>
      )}
    </Modal>
  );
}

export function ExpenseStatusCell({ e }: { e: ExpenseRow }) {
  return <div className="flex flex-wrap items-center gap-1">{e.approval_status === "approved" ? <PaymentStatusBadge status={e.payment_status} /> : <ApprovalBadge status={e.approval_status} />}</div>;
}
