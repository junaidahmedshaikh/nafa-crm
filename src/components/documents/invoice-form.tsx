"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileCheck, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FormSection, Input, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { ClientSection, ConfigEditor, ItemsEditor, PreviewPane, SummaryPanel } from "@/components/documents/builder-parts";
import { issueInvoice, previewDocument, saveInvoice } from "@/lib/actions/documents";
import type { LeadOption, Product } from "@/lib/documents/repo";
import { invoiceInputSchema, type InvoiceFormValues, type InvoiceInput } from "@/lib/documents/schemas";
import type { BankDetails } from "@/lib/documents/types";
import { dmy } from "@/lib/documents/format";
import { cn } from "@/lib/utils";

const errText = (e: unknown): string | undefined => (e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") || undefined : undefined);

export function InvoiceForm({
  id,
  defaults,
  leads,
  catalogue,
  number,
  nextNumber,
  bank,
}: {
  id?: string;
  defaults: InvoiceFormValues;
  leads: LeadOption[];
  catalogue: Product[];
  number?: string | null;
  nextNumber?: string;
  bank: BankDetails;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"summary" | "preview">("summary");
  const form = useForm<InvoiceFormValues, unknown, InvoiceInput>({ resolver: zodResolver(invoiceInputSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, control, setValue, formState: { errors } } = form;
  const watched = useWatch({ control });

  function save() {
    startTransition(async () => {
      const res = await saveInvoice(form.getValues(), id);
      if (res.ok) {
        toast.success(id ? "Draft saved" : "Invoice draft created");
        router.push(`/invoices/${res.data?.id}`);
        return;
      }
      for (const [name, message] of Object.entries(res.fieldErrors ?? {})) form.setError(name as never, { type: "server", message });
      toast.error(res.error);
    });
  }

  function saveAndIssue() {
    handleSubmit(async () => {
      startTransition(async () => {
        const res = await saveInvoice(form.getValues(), id);
        if (!res.ok) {
          for (const [name, message] of Object.entries(res.fieldErrors ?? {})) {
            form.setError(name as never, { type: "server", message });
          }
          toast.error(res.error);
          return;
        }
        const invoiceId = res.data?.id || id;
        if (!invoiceId) return;

        const issueRes = await issueInvoice(invoiceId);
        if (issueRes.ok) {
          toast.success(`Invoice ${issueRes.data?.number} issued successfully`);
          router.push(`/invoices/${invoiceId}`);
        } else {
          toast.warning(`Draft saved, but could not issue: ${issueRes.error}`);
          router.push(`/invoices/${invoiceId}`);
        }
      });
    }, () => toast.error("Please fix the highlighted fields."))();
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <input type="hidden" {...register("quotation_id")} />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent-soft/30 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-surface font-semibold text-accent shadow-xs">
                <ReceiptText className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Invoice Reference</span>
                  <Badge tone={number ? "success" : "neutral"}>{number ? "Issued" : "Draft"}</Badge>
                </div>
                <p className="font-mono text-base font-bold text-foreground sm:text-lg">{number || nextNumber || "NAFA-INV-26-001"}</p>
              </div>
            </div>
            <div className="text-right text-xs text-muted">
              {number ? "Locked reference number" : "Sequential counter · Increments by 1 on issue"}
            </div>
          </div>

          <ClientSection
            requireNames
            leads={leads}
            onLead={(l) => {
              setValue("project_name", l.event_name || l.title);
              setValue("project_location", [l.venue, l.city].filter(Boolean).join(", "));
              setValue("project_date_text", l.event_date ? dmy(l.event_date) : "");
            }}
          />
          <FormSection title="Project details & dates">
            <Field label="Event / project name" error={errText(errors.project_name)}>{(p) => <Input {...p} {...register("project_name")} />}</Field>
            <Field label="Event location" error={errText(errors.project_location)}>{(p) => <Input {...p} {...register("project_location")} />}</Field>
            <Field label="Event date or project period" error={errText(errors.project_date_text)}>{(p) => <Input {...p} {...register("project_date_text")} />}</Field>
            <Field label="Reference quotation" hint={defaults.quotation_id ? "Linked to the source quotation" : "Optional"} error={errText(errors.quotation_number)}>{(p) => <Input {...p} {...register("quotation_number")} />}</Field>
            <Field label="Place of supply" hint="If applicable, e.g. Maharashtra (27)" error={errText(errors.place_of_supply)}>{(p) => <Input {...p} {...register("place_of_supply")} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice date" required error={errText(errors.invoice_date)}>{(p) => <Input {...p} {...register("invoice_date")} type="date" />}</Field>
              <Field label="Due date" error={errText(errors.due_date)} hint="Required to issue">{(p) => <Input {...p} {...register("due_date")} type="date" />}</Field>
            </div>
          </FormSection>

          <ItemsEditor catalogue={catalogue} showHsn />
          <ConfigEditor />

          <FormSection title="Payment details" description="Printed on the invoice so the client knows where to pay. Shared across all invoices: change them in Settings → Documents.">
            <div className="sm:col-span-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {([["Account holder", bank.account_holder], ["Bank", bank.bank_name], ["Account number", bank.account_number], ["IFSC", bank.ifsc], ["UPI ID", bank.upi_id]] as const).map(([k, v]) => (
                <div key={k}><span className="text-muted">{k}: </span><span className="font-medium">{v || "—"}</span></div>
              ))}
              <Link href="/settings/documents" className="text-sm font-medium text-primary underline sm:col-span-2">Edit payment details</Link>
            </div>
          </FormSection>

          <FormSection title="Payment terms & notes" description="Defaults come from Settings → Documents. The “GST has not been charged” declaration is added automatically only when no tax is charged.">
            <Field label="Payment terms" className="sm:col-span-2" error={errText(errors.payment_terms_text)}>{(p) => <Input {...p} {...register("payment_terms_text")} />}</Field>
            <Field label="Notes / declaration" className="sm:col-span-2" error={errText(errors.notes_text)}>{(p) => <Textarea {...p} {...register("notes_text")} rows={4} />}</Field>
          </FormSection>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Link href={id ? `/invoices/${id}` : "/invoices"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
            <Button type="submit" variant="outline" loading={pending}>Save as draft</Button>
            <Button type="button" variant="primary" loading={pending} onClick={saveAndIssue}>
              <FileCheck className="mr-1.5 h-4 w-4" aria-hidden />
              {number ? "Save invoice" : `Issue invoice (${nextNumber || "Next"})`}
            </Button>
          </div>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card className="p-4">
            <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
              {(["summary", "preview"] as const).map((t) => (
                <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={cn("-mb-px border-b-2 px-3 pb-2 text-sm font-medium", tab === t ? "border-nav" : "border-transparent text-muted hover:text-foreground")}>{t === "summary" ? "Totals" : "Preview"}</button>
              ))}
            </div>
            {tab === "summary" ? <SummaryPanel /> : <PreviewPane deps={watched} load={() => previewDocument("invoice", form.getValues(), { number: number ?? nextNumber })} />}
          </Card>
        </aside>
      </form>
    </FormProvider>
  );
}
