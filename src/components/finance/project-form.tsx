"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { fetchInvoiceEvent, saveProject } from "@/lib/actions/finance";
import type { ProjectPrefill } from "@/lib/finance/event";
import type { LinkableInvoice } from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/finance/schemas";

export type ProjectFormValues = {
  name: string; company_id: string; lead_id: string; quotation_id: string; category: string; location: string; start_date: string; end_date: string;
  manager_id: string; status: string; approved_value: string; final_billing_amount: string; notes: string; team: string[];
};
type Opt = { id: string; label: string };

export function ProjectForm({ id, defaults, companies, people, leads, invoices = [] }: { id?: string; defaults: ProjectFormValues; companies: Opt[]; people: Opt[]; leads: Opt[]; invoices?: LinkableInvoice[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fetching, startFetch] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [team, setTeam] = useState<string[]>(defaults.team);
  const [picked, setPicked] = useState<string[]>([]);
  const [filledFrom, setFilledFrom] = useState("");

  // Event fields are controlled so an invoice can fill them in.
  const [f, setF] = useState({
    name: defaults.name, company_id: defaults.company_id, lead_id: defaults.lead_id, quotation_id: defaults.quotation_id, category: defaults.category,
    location: defaults.location, start_date: defaults.start_date, end_date: defaults.end_date, approved_value: defaults.approved_value,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Fills blank fields only; anything already typed is left alone.
  function applyPrefill(p: ProjectPrefill) {
    setF((x) => ({
      name: x.name.trim() ? x.name : p.name,
      company_id: x.company_id || p.company_id,
      lead_id: x.lead_id || p.lead_id,
      quotation_id: x.quotation_id || p.quotation_id,
      category: x.category.trim() ? x.category : p.category,
      location: x.location.trim() ? x.location : p.location,
      start_date: x.start_date || p.start_date,
      end_date: x.end_date || p.end_date,
      approved_value: Number(x.approved_value) ? x.approved_value : p.approved_value || x.approved_value,
    }));
    setFilledFrom(p.source);
  }

  function addInvoice(invoiceId: string) {
    if (!invoiceId || picked.includes(invoiceId)) return;
    const first = picked.length === 0;
    setPicked((p) => [...p, invoiceId]);
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!first) {
      // A further invoice adds to the approved value (when it was filled from invoices) but does not change event details.
      if (inv && f.approved_value === sumExGst(picked)) setF((x) => ({ ...x, approved_value: sumExGst([...picked, invoiceId]) }));
      return;
    }
    startFetch(async () => {
      const r = await fetchInvoiceEvent(invoiceId);
      if (r.ok) applyPrefill(r.data.prefill);
      else toast.error(r.error);
    });
  }
  const sumExGst = (ids: string[]) => String(Math.round(invoices.filter((i) => ids.includes(i.id)).reduce((a, i) => a + i.ex_gst, 0) * 100) / 100);
  const available = invoices.filter((i) => !picked.includes(i.id));

  return (
    <form
      className="mx-auto max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        startTransition(async () => {
          const res = await saveProject({ ...v, ...f, team, invoice_ids: picked } as never, id);
          if (res.ok) { if (res.data.warning) toast.warning(res.data.warning); else toast.success(id ? "Project saved" : "Project created"); router.push(`/projects/${res.data.id}`); return; }
          setErrors(res.fieldErrors ?? {});
          toast.error(res.error);
        });
      }}
    >
      {!id && (
        <FormSection title="Start from an invoice" description="Optional. Choose an issued invoice and the project's name, client, event location, dates, category and value are filled in for you. You can still change anything.">
          <div className="sm:col-span-2 space-y-3">
            {invoices.length === 0 ? (
              <p className="text-sm text-muted">No issued, unlinked invoices are available. You can link invoices later from the project&apos;s Client revenue tab.</p>
            ) : (
              <Field label={picked.length ? "Link another invoice" : "Invoice"} hint={fetching ? "Fetching event details…" : undefined}>
                {(p) => (
                  <Select {...p} value="" onChange={(e) => addInvoice(e.target.value)} disabled={available.length === 0 || fetching}>
                    <option value="">{available.length ? "Select an invoice…" : "No more invoices"}</option>
                    {available.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.client_company || "—"}{i.project_name ? ` · ${i.project_name}` : ""} · {formatINR(i.grand_total)}</option>)}
                  </Select>
                )}
              </Field>
            )}
            {picked.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {picked.map((pid) => {
                  const i = invoices.find((x) => x.id === pid);
                  return (
                    <li key={pid} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted py-1 pl-3 pr-1.5 text-xs">
                      <span className="font-medium">{i?.number}</span><span className="text-muted">{formatINR(i?.grand_total)}</span>
                      <button type="button" aria-label={`Remove invoice ${i?.number}`} className="rounded-full p-0.5 hover:bg-black/10" onClick={() => setPicked((p) => p.filter((x) => x !== pid))}><X className="h-3 w-3" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
            {filledFrom && <p className="text-xs text-success">Event details filled from {filledFrom}. Check them below.</p>}
          </div>
        </FormSection>
      )}

      <FormSection title="Project">
        <Field label="Project name" required className="sm:col-span-2" error={errors.name}>{(p) => <Input {...p} name="name" value={f.name} onChange={set("name")} />}</Field>
        <Field label="Client (company)" error={errors.company_id}>{(p) => <Select {...p} name="company_id" value={f.company_id} onChange={set("company_id")}><option value="">— None —</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
        <Field label="CRM lead" hint="Optional link to the lead this project came from" error={errors.lead_id}>{(p) => <Select {...p} name="lead_id" value={f.lead_id} onChange={set("lead_id")}><option value="">— None —</option>{leads.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
        <input type="hidden" name="quotation_id" value={f.quotation_id} readOnly />
        <Field label="Category" error={errors.category}>{(p) => <Input {...p} name="category" value={f.category} onChange={set("category")} placeholder="e.g. Exhibition, Roadshow, Launch" />}</Field>
        <Field label="Event location" error={errors.location}>{(p) => <Input {...p} name="location" value={f.location} onChange={set("location")} />}</Field>
        <Field label="Start date" error={errors.start_date}>{(p) => <Input {...p} type="date" name="start_date" value={f.start_date} onChange={set("start_date")} />}</Field>
        <Field label="End date" error={errors.end_date}>{(p) => <Input {...p} type="date" name="end_date" value={f.end_date} onChange={set("end_date")} />}</Field>
        <Field label="Project manager" error={errors.manager_id}>{(p) => <Select {...p} name="manager_id" defaultValue={defaults.manager_id}><option value="">— Not assigned —</option>{people.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
        <Field label="Status" required error={errors.status}>{(p) => <Select {...p} name="status" defaultValue={defaults.status}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}</Select>}</Field>
      </FormSection>

      <FormSection title="Client value" description="Both amounts exclude GST. Revenue for profit is the approved value plus approved additional charges and change orders.">
        <Field label="Approved client budget / project value (₹)" required error={errors.approved_value}>{(p) => <Input {...p} name="approved_value" inputMode="decimal" value={f.approved_value} onChange={set("approved_value")} />}</Field>
        <Field label="Final client billing amount (₹)" hint="Optional, once known" error={errors.final_billing_amount}>{(p) => <Input {...p} name="final_billing_amount" inputMode="decimal" defaultValue={defaults.final_billing_amount} />}</Field>
      </FormSection>

      <FormSection title="Team access" description="People below can see this project's budget and expenses and add expenses, subject to their finance role. They never see revenue or profit.">
        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={team.includes(p.id)} onChange={(e) => setTeam((t) => (e.target.checked ? [...t, p.id] : t.filter((x) => x !== p.id)))} />
              {p.label}
            </label>
          ))}
        </div>
      </FormSection>

      <Field label="Notes" error={errors.notes}>{(p) => <Textarea {...p} name="notes" rows={3} defaultValue={defaults.notes} />}</Field>

      <div className="flex justify-end gap-2">
        <Link href={id ? `/projects/${id}` : "/projects"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
        <Button type="submit" variant="primary" loading={pending}>{id ? "Save project" : "Create project"}</Button>
      </div>
    </form>
  );
}
