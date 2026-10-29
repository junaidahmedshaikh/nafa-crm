"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { saveDocumentSettings, saveSequence } from "@/lib/actions/documents";
import { documentSettingsSchema, type DocumentSettingsValues } from "@/lib/documents/schemas";

const errText = (e: unknown): string | undefined => (e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") || undefined : undefined);

export function DocumentSettingsForm({ defaults, canEdit }: { defaults: DocumentSettingsValues; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<DocumentSettingsValues, unknown, never>({ resolver: zodResolver(documentSettingsSchema) as never, defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, control, formState: { errors } } = form;
  const terms = useFieldArray({ control, name: "quotation_terms" as never });
  const ms = useFieldArray({ control, name: "quotation_milestones" });
  const dis = !canEdit;
  const gstOn = useWatch({ control, name: "gst_declaration_enabled" });

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit(() =>
        startTransition(async () => {
          const r = await saveDocumentSettings(form.getValues());
          if (r.ok) { toast.success("Document settings saved"); router.refresh(); return; }
          for (const [k, m] of Object.entries(r.fieldErrors ?? {})) form.setError(k as never, { type: "server", message: m });
          toast.error(r.error);
        }),
        () => toast.error("Please fix the highlighted fields."),
      )}
    >
      {!canEdit && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Only an administrator can change these settings (they include bank details).</p>}

      <FormSection title="Company details on documents">
        <Field label="Company name" required error={errText(errors.company_name)}>{(p) => <Input {...p} {...register("company_name")} disabled={dis} />}</Field>
        <Field label="Signatory line" required error={errText(errors.signatory_label)} hint="Printed above “Authorised Signatory”">{(p) => <Input {...p} {...register("signatory_label")} disabled={dis} />}</Field>
        <Field label="Email" error={errText(errors.company_email)}>{(p) => <Input {...p} {...register("company_email")} type="email" disabled={dis} />}</Field>
        <Field label="Phone" error={errText(errors.company_phone)}>{(p) => <Input {...p} {...register("company_phone")} disabled={dis} />}</Field>
        <Field label="Website" error={errText(errors.company_website)}>{(p) => <Input {...p} {...register("company_website")} disabled={dis} />}</Field>
        <Field label="Company GSTIN" hint="Leave blank if not GST-registered" error={errText(errors.company_gstin)}>{(p) => <Input {...p} {...register("company_gstin")} disabled={dis} className="uppercase" />}</Field>
        <Field label="Location line" className="sm:col-span-2" error={errText(errors.company_location)}>{(p) => <Input {...p} {...register("company_location")} disabled={dis} />}</Field>
      </FormSection>

      <FormSection title="Bank & UPI details" description="Printed on invoices. Visible only to signed-in team members; never exposed on public pages or unauthenticated APIs.">
        <Field label="Account holder" error={errText(errors.bank_account_holder)}>{(p) => <Input {...p} {...register("bank_account_holder")} disabled={dis} autoComplete="off" />}</Field>
        <Field label="Bank" error={errText(errors.bank_name)}>{(p) => <Input {...p} {...register("bank_name")} disabled={dis} autoComplete="off" />}</Field>
        <Field label="Account number" error={errText(errors.bank_account_number)}>{(p) => <Input {...p} {...register("bank_account_number")} disabled={dis} autoComplete="off" />}</Field>
        <Field label="IFSC" error={errText(errors.bank_ifsc)}>{(p) => <Input {...p} {...register("bank_ifsc")} disabled={dis} className="uppercase" autoComplete="off" />}</Field>
        <Field label="UPI ID" error={errText(errors.bank_upi_id)}>{(p) => <Input {...p} {...register("bank_upi_id")} disabled={dis} autoComplete="off" />}</Field>
      </FormSection>

      <FormSection title="Defaults for new documents" description="Only defaults — each document can change or switch them off.">
        <label className="flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" className="h-4 w-4" disabled={dis} {...register("default_agency_fee_enabled")} />Agency / management fee on by default</label>
        <Field label="Agency fee (%)" error={errText(errors.default_agency_fee_rate)}>{(p) => <Input {...p} {...register("default_agency_fee_rate")} inputMode="decimal" disabled={dis} />}</Field>
        <Field label="Quotation tax default">{(p) => <Select {...p} {...register("default_quotation_tax_mode")} disabled={dis}><option value="none">No tax</option><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option></Select>}</Field>
        <Field label="Invoice tax default">{(p) => <Select {...p} {...register("default_invoice_tax_mode")} disabled={dis}><option value="none">No tax</option><option value="cgst_sgst">CGST + SGST</option><option value="igst">IGST</option></Select>}</Field>
        <Field label="GST rate (%)" error={errText(errors.default_tax_rate)}>{(p) => <Input {...p} {...register("default_tax_rate")} inputMode="decimal" disabled={dis} />}</Field>
        <Field label="Quotation valid for (days)" error={errText(errors.default_quotation_validity_days)}>{(p) => <Input {...p} {...register("default_quotation_validity_days")} inputMode="numeric" disabled={dis} />}</Field>
        <Field label="Invoice due after (days)" error={errText(errors.default_invoice_due_days)}>{(p) => <Input {...p} {...register("default_invoice_due_days")} inputMode="numeric" disabled={dis} />}</Field>
      </FormSection>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Default quotation terms</h2><p className="text-xs text-muted">Copied into each new quotation, where they can be overridden.</p></div>
          {canEdit && <Button size="sm" onClick={() => terms.append("" as never)}><Plus className="h-4 w-4" aria-hidden />Add term</Button>}</div>
        <div className="space-y-2">{terms.fields.map((f, i) => (
          <div key={f.id} className="flex gap-2"><span className="w-6 pt-2 text-right text-sm text-muted">{i + 1}.</span><Textarea aria-label={`Term ${i + 1}`} rows={2} disabled={dis} {...register(`quotation_terms.${i}` as never)} />
            {canEdit && <Button size="icon" variant="ghost" onClick={() => terms.remove(i)} aria-label={`Remove term ${i + 1}`}><Trash2 className="h-4 w-4 text-danger" /></Button>}</div>
        ))}</div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Default payment milestones</h2><p className="text-xs text-muted">The 50 / 30 / 20 schedule from the original template — edit freely. Dates are chosen per quotation.</p></div>
          {canEdit && <Button size="sm" onClick={() => ms.append({ label: "", kind: "percent", value: "", due_text: "" })}><Plus className="h-4 w-4" aria-hidden />Add milestone</Button>}</div>
        <div className="space-y-2">{ms.fields.map((f, i) => (
          <div key={f.id} className="grid items-end gap-2 sm:grid-cols-12">
            <div className="sm:col-span-5"><Input aria-label={`Milestone ${i + 1} label`} disabled={dis} {...register(`quotation_milestones.${i}.label`)} /></div>
            <div className="sm:col-span-2"><Select aria-label="Type" disabled={dis} {...register(`quotation_milestones.${i}.kind`)}><option value="percent">%</option><option value="fixed">₹</option></Select></div>
            <div className="sm:col-span-2"><Input aria-label="Value" inputMode="decimal" disabled={dis} {...register(`quotation_milestones.${i}.value`)} /></div>
            <div className="sm:col-span-2"><Input aria-label="Due text" placeholder="On confirmation" disabled={dis} {...register(`quotation_milestones.${i}.due_text`)} /></div>
            {canEdit && <Button size="icon" variant="ghost" onClick={() => ms.remove(i)} aria-label={`Remove milestone ${i + 1}`}><Trash2 className="h-4 w-4 text-danger" /></Button>}
          </div>
        ))}</div>
      </section>

      <FormSection title="Invoice wording">
        <Field label="Payment terms line" className="sm:col-span-2" error={errText(errors.invoice_payment_terms)}>{(p) => <Input {...p} {...register("invoice_payment_terms")} disabled={dis} />}</Field>
        <Field label="Notes / declaration" className="sm:col-span-2" error={errText(errors.invoice_notes)}>{(p) => <Textarea {...p} {...register("invoice_notes")} rows={4} disabled={dis} />}</Field>
        <label className="flex items-center gap-2 text-[13px] font-medium sm:col-span-2"><input type="checkbox" className="h-4 w-4" disabled={dis} {...register("gst_declaration_enabled")} />Print a “no GST charged” declaration on invoices that charge no tax</label>
        <Field label="Declaration wording" className="sm:col-span-2" hint="Never printed on an invoice that charges GST." error={errText(errors.gst_declaration)}>{(p) => <Input {...p} {...register("gst_declaration")} disabled={dis || !gstOn} />}</Field>
      </FormSection>

      {canEdit && <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save document settings</Button></div>}
    </form>
  );
}

export type SequenceRow = { doc_type: "quotation" | "proposal" | "invoice"; prefix: string; padding: number; next_number: number };

export function NumberingForm({ rows, canEdit }: { rows: SequenceRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const preview = (r: { prefix: string; padding: string | number; next: string | number }) => `${r.prefix}${String(r.next).padStart(Number(r.padding) || 1, "0")}`;

  return (
    <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="num-h">
      <h2 id="num-h" className="text-sm font-semibold">Document numbering</h2>
      <p className="mb-4 text-xs text-muted">Numbers are allocated atomically when a document is issued — drafts have none. A number is never reused, so the next number can only go up.</p>
      <div className="space-y-4">
        {rows.map((r) => (
          <form key={r.doc_type} className="grid items-end gap-3 sm:grid-cols-12"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget)) as { prefix: string; padding: string; next_number: string };
              startTransition(async () => {
                const res = await saveSequence(r.doc_type, f);
                if (res.ok) { toast.success("Numbering saved"); setErrors((s) => ({ ...s, [r.doc_type]: {} })); router.refresh(); }
                else { setErrors((s) => ({ ...s, [r.doc_type]: res.fieldErrors ?? {} })); toast.error(res.error); }
              });
            }}>
            <p className="text-sm font-medium capitalize sm:col-span-2">{r.doc_type}s</p>
            <Field label="Prefix" className="sm:col-span-3" error={errors[r.doc_type]?.prefix}>{(p) => <Input {...p} name="prefix" defaultValue={r.prefix} disabled={!canEdit} />}</Field>
            <Field label="Digits" className="sm:col-span-2" error={errors[r.doc_type]?.padding}>{(p) => <Input {...p} name="padding" defaultValue={String(r.padding)} inputMode="numeric" disabled={!canEdit} />}</Field>
            <Field label="Next number" className="sm:col-span-2" error={errors[r.doc_type]?.next_number} hint={`Next: ${preview({ prefix: r.prefix, padding: r.padding, next: r.next_number })}`}>{(p) => <Input {...p} name="next_number" defaultValue={String(r.next_number)} inputMode="numeric" disabled={!canEdit} />}</Field>
            {canEdit && <Button type="submit" size="sm" className="sm:col-span-2" loading={pending}>Save</Button>}
          </form>
        ))}
      </div>
    </section>
  );
}
