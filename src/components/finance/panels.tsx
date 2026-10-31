"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { ApprovalBadge, BudgetAlertBadge, Meter } from "@/components/finance/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { DataTable, Td, Th } from "@/components/ui/layout";
import { deleteRecord, linkInvoice, restoreRecord, saveBudget, saveRevenueItem, setReimbursementStatus, submitReimbursement, unlinkInvoice, type SoftKind } from "@/lib/actions/finance";
import { budgetAlert } from "@/lib/finance/calc";
import type { BudgetRow, Category, LinkedInvoice, ReimbursementRow, RevenueItem } from "@/lib/finance/repo";
import { formatDate } from "@/lib/datetime";
import { formatINR } from "@/lib/format";

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else toast.error(r.error ?? "Something went wrong"); });
  return { pending, run, router, startTransition };
}

// ---------------------------------------------------------------------------
// Delete / restore any soft-deletable record
// ---------------------------------------------------------------------------
export function DeleteRestoreButton({ kind, id, deleted, isAdmin, label }: { kind: SoftKind; id: string; deleted: boolean; isAdmin: boolean; label: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  if (deleted) return isAdmin ? <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => restoreRecord(kind, id), `${label} restored`)}><Undo2 className="h-4 w-4" aria-hidden />Restore</Button> : null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4 text-danger" aria-hidden />Delete</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} pending={pending} title={`Delete this ${label.toLowerCase()}?`} confirmLabel="Delete"
        description="It is hidden from totals and recorded in the audit log. An administrator can restore it."
        onConfirm={() => run(() => deleteRecord(kind, id), `${label} deleted`, () => setOpen(false))} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Budget allocation: estimated per category, with live utilisation
// ---------------------------------------------------------------------------
export function BudgetEditor({ projectId, categories, rows, canEdit }: { projectId: string; categories: Category[]; rows: BudgetRow[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const byCat = new Map(rows.map((r) => [r.category_id, r]));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.id, byCat.get(c.id) && Number(byCat.get(c.id)!.budget) > 0 ? String(byCat.get(c.id)!.budget) : ""])));
  const total = categories.reduce((a, c) => a + (Number(values[c.id]) || 0), 0);
  const actualTotal = rows.reduce((a, r) => a + Number(r.actual), 0);

  return (
    <div>
      <DataTable>
        <thead><tr><Th>Category</Th><Th className="text-right">Estimated budget</Th><Th className="text-right">Actual expense</Th><Th className="text-right">Remaining</Th><Th className="w-40">Utilisation</Th><Th>Status</Th></tr></thead>
        <tbody>
          {categories.map((c) => {
            const r = byCat.get(c.id);
            const budget = Number(values[c.id]) || 0;
            const actual = Number(r?.actual ?? 0);
            if (!canEdit && !budget && !actual) return null;
            const alert = budgetAlert(budget, actual);
            const pct = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
            return (
              <tr key={c.id} className={alert === "over" ? "bg-danger-soft/40" : ""}>
                <Td>{c.name}</Td>
                <Td className="text-right">{canEdit ? <Input aria-label={`${c.name} budget`} inputMode="decimal" className="ml-auto w-32 text-right" value={values[c.id]} placeholder="0" onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))} /> : <span className="tabular-nums">{formatINR(budget)}</span>}</Td>
                <Td className="text-right tabular-nums">{formatINR(actual)}</Td>
                <Td className={`text-right tabular-nums ${budget - actual < 0 ? "text-danger" : ""}`}>{formatINR(budget - actual)}</Td>
                <Td><div className="flex items-center gap-2"><Meter pct={pct} alert={alert} /><span className="w-14 text-right text-xs tabular-nums text-muted">{pct == null ? "—" : `${pct}%`}</span></div></Td>
                <Td>{budget || actual ? <BudgetAlertBadge alert={alert} /> : null}{alert === "over" && budget > 0 && <span className="ml-1 text-xs text-danger">+{(((actual - budget) / budget) * 100).toFixed(1)}%</span>}</Td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <Td>Total</Td><Td className="text-right tabular-nums">{formatINR(total)}</Td><Td className="text-right tabular-nums">{formatINR(actualTotal)}</Td>
            <Td className={`text-right tabular-nums ${total - actualTotal < 0 ? "text-danger" : ""}`}>{formatINR(total - actualTotal)}</Td><Td colSpan={2}>{total > 0 ? `${((actualTotal / total) * 100).toFixed(1)}% used` : ""}</Td>
          </tr>
        </tbody>
      </DataTable>
      {canEdit && (
        <div className="flex justify-end gap-2 border-t border-border p-3">
          <Button variant="primary" loading={pending} onClick={() => run(() => saveBudget(projectId, categories.map((c) => ({ category_id: c.id, amount: values[c.id] || "0" }))), "Budget saved")}>Save budget</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client revenue: linked invoices (+ their payments) and approved extra revenue
// ---------------------------------------------------------------------------
export function RevenuePanel({ projectId, items, invoices, linkable, canEdit }: {
  projectId: string; items: RevenueItem[]; invoices: LinkedInvoice[]; linkable: { id: string; number: string; client_company: string; grand_total: number | string }[]; canEdit: boolean;
}) {
  const { pending, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pick, setPick] = useState("");

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2">
          <h3 className="text-sm font-semibold">Invoices &amp; client payments</h3>
          {canEdit && linkable.length > 0 && (
            <div className="flex items-center gap-2">
              <Select aria-label="Invoice to link" value={pick} onChange={(e) => setPick(e.target.value)} className="w-64"><option value="">Link an issued invoice…</option>{linkable.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.client_company} · {formatINR(i.grand_total)}</option>)}</Select>
              <Button size="sm" disabled={!pick} loading={pending} onClick={() => run(() => linkInvoice(projectId, pick), "Invoice linked", () => setPick(""))}>Link</Button>
            </div>
          )}
        </div>
        {invoices.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">No invoices linked. Link issued invoices to track what the client has paid. Record client payments on the invoice itself.</p> : (
          <DataTable>
            <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th className="text-right">Amount (ex-GST)</Th><Th className="text-right">GST</Th><Th className="text-right">Total</Th><Th className="text-right">Received</Th><Th className="text-right">Outstanding</Th><Th>Status</Th>{canEdit && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
            <tbody>
              {invoices.map((i) => {
                const out = Math.max(0, i.grand_total - i.received);
                const overdue = i.state === "issued" && out > 0 && i.due_date != null && i.due_date < today();
                const status = i.state === "cancelled" ? "Cancelled" : out <= 0 ? "Paid" : overdue ? "Overdue" : i.received > 0 ? "Partially paid" : "Pending";
                return (
                  <tr key={i.id}>
                    <Td><Link href={`/invoices/${i.invoice_id}`} className="font-medium hover:underline">{i.number ?? "Draft"}</Link></Td>
                    <Td>{formatDate(i.invoice_date)}</Td><Td>{i.due_date ? formatDate(i.due_date) : "—"}</Td>
                    <Td className="text-right tabular-nums">{formatINR(i.subtotal, { exact: true })}</Td><Td className="text-right tabular-nums">{formatINR(i.gst, { exact: true })}</Td>
                    <Td className="text-right tabular-nums">{formatINR(i.grand_total, { exact: true })}</Td><Td className="text-right tabular-nums">{formatINR(i.received, { exact: true })}</Td>
                    <Td className={`text-right tabular-nums ${out > 0 ? "text-danger" : ""}`}>{formatINR(out, { exact: true })}</Td>
                    <Td><span className={overdue ? "text-danger" : status === "Paid" ? "text-success" : ""}>{status}</span></Td>
                    {canEdit && <Td className="text-right"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlinkInvoice(projectId, i.id), "Invoice unlinked")}>Unlink</Button></Td>}
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between px-5 pb-2">
          <h3 className="text-sm font-semibold">Additional charges &amp; change orders</h3>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden />Add</Button>}
        </div>
        {items.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">None. Only approved items count toward project revenue.</p> : (
          <DataTable>
            <thead><tr><Th>Date</Th><Th>Type</Th><Th>Description</Th><Th className="text-right">Amount (ex-GST)</Th><Th>Approved</Th>{canEdit && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <Td>{formatDate(i.item_date)}</Td><Td>{i.kind === "change_order" ? "Change order" : "Additional charge"}</Td><Td>{i.description}</Td>
                  <Td className={`text-right tabular-nums ${Number(i.amount) < 0 ? "text-danger" : ""}`}>{formatINR(i.amount, { exact: true })}</Td>
                  <Td>{i.approved ? <ApprovalBadge status="approved" /> : <ApprovalBadge status="submitted" />}</Td>
                  {canEdit && (
                    <Td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => saveRevenueItem(projectId, { kind: i.kind, description: i.description, amount: String(i.amount), approved: !i.approved, item_date: i.item_date }, i.id), i.approved ? "Approval removed" : "Approved")}>{i.approved ? "Unapprove" : "Approve"}</Button>
                      <DeleteRestoreButton kind="revenue" id={i.id} deleted={false} isAdmin={false} label="Item" />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <Modal open={adding} onClose={() => { setAdding(false); setErrors({}); }} title="Add revenue item" description="Amounts exclude GST. Use a negative amount for a change order that reduces the project value.">
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = Object.fromEntries(f) as Record<string, string>;
          run(async () => { const r = await saveRevenueItem(projectId, { ...v, approved: f.get("approved") === "on" } as never); if (!r.ok) setErrors(r.fieldErrors ?? {}); return r; }, "Added", () => setAdding(false));
        }}>
          <Field label="Type" required>{(p) => <Select {...p} name="kind" defaultValue="additional_charge"><option value="additional_charge">Additional client charge</option><option value="change_order">Change order</option></Select>}</Field>
          <Field label="Description" required error={errors.description}>{(p) => <Input {...p} name="description" autoFocus />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} name="amount" inputMode="decimal" />}</Field>
            <Field label="Date" required error={errors.item_date}>{(p) => <Input {...p} type="date" name="item_date" defaultValue={today()} />}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="approved" className="h-4 w-4" />Client has approved this</label>
          <div className="flex justify-end gap-2"><Button onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>Add</Button></div>
        </form>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reimbursements: submit and review
// ---------------------------------------------------------------------------
export function ReimbursementForm({ projects, categories, defaultName, fixedProject }: { projects: { id: string; name: string }[]; categories: Category[]; defaultName: string; fixedProject?: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />New reimbursement</Button>
      <Modal open={open} onClose={() => { setOpen(false); setErrors({}); }} title="Submit a reimbursement" description="For money you paid personally for a project. Once approved it is counted in the project's expenses — do not also enter it as an expense.">
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          run(async () => { const r = await submitReimbursement({ ...v, expense_id: "" } as never); if (!r.ok) setErrors(r.fieldErrors ?? {}); return r; }, "Submitted", () => setOpen(false));
        }}>
          <Field label="Person" required error={errors.person_name}>{(p) => <Input {...p} name="person_name" defaultValue={defaultName} />}</Field>
          <Field label="Project" required error={errors.project_id}>{(p) => <Select {...p} name="project_id" defaultValue={fixedProject ?? ""}><option value="">Choose…</option>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expense date" required error={errors.expense_date}>{(p) => <Input {...p} type="date" name="expense_date" defaultValue={today()} />}</Field>
            <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} name="amount" inputMode="decimal" />}</Field>
          </div>
          <Field label="Category" required error={errors.category_id}>{(p) => <Select {...p} name="category_id" defaultValue=""><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Description" required error={errors.description}>{(p) => <Input {...p} name="description" />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>Submit</Button></div>
        </form>
      </Modal>
    </>
  );
}

export function ReimbursementTable({ rows, manage, showProject = true }: { rows: ReimbursementRow[]; manage: boolean; showProject?: boolean }) {
  const { pending, run } = useRun();
  const [paying, setPaying] = useState<ReimbursementRow | null>(null);
  const [date, setDate] = useState(today());
  return (
    <>
      <DataTable>
        <thead><tr><Th>Date</Th><Th>Person</Th>{showProject && <Th>Project</Th>}<Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th>Status</Th>{manage && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap">{formatDate(r.expense_date)}</Td><Td>{r.person_name}</Td>
              {showProject && <Td><Link href={`/projects/${r.project_id}`} className="hover:underline">{r.project?.name ?? "—"}</Link></Td>}
              <Td>{r.category?.name ?? "—"}</Td><Td>{r.description}</Td>
              <Td className="text-right tabular-nums">{formatINR(r.amount, { exact: true })}</Td>
              <Td><ApprovalBadge status={r.status} />{r.reimbursed_on && <p className="mt-0.5 text-xs text-muted">{formatDate(r.reimbursed_on)}</p>}{r.expense_id && <p className="mt-0.5 text-xs text-muted">Linked to an expense</p>}</Td>
              {manage && (
                <Td className="whitespace-nowrap text-right">
                  {r.status === "submitted" && <>
                    <Button size="icon" variant="ghost" aria-label="Approve" disabled={pending} onClick={() => run(() => setReimbursementStatus(r.id, "approved"), "Approved")}><Check className="h-4 w-4 text-success" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Reject" disabled={pending} onClick={() => run(() => setReimbursementStatus(r.id, "rejected"), "Rejected")}><X className="h-4 w-4 text-danger" /></Button>
                  </>}
                  {r.status === "approved" && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setPaying(r); setDate(today()); }}>Mark reimbursed</Button>}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Mark as reimbursed" description={paying ? `${paying.person_name} · ${formatINR(paying.amount, { exact: true })}` : undefined} className="max-w-sm">
        <div className="space-y-4">
          <Field label="Date reimbursed" required>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setPaying(null)}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => paying && run(() => setReimbursementStatus(paying.id, "reimbursed", date), "Marked reimbursed", () => setPaying(null))}>Confirm</Button></div>
        </div>
      </Modal>
    </>
  );
}
