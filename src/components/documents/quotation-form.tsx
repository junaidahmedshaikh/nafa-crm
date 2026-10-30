"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormProvider,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileCheck, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FormSection,
  Input,
  Select,
  Textarea,
} from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import {
  ClientSection,
  ConfigEditor,
  ItemsEditor,
  PreviewPane,
  SummaryPanel,
} from "@/components/documents/builder-parts";
import { issueQuotation, previewDocument, saveQuotation } from "@/lib/actions/documents";
import type { LeadOption, Product } from "@/lib/documents/repo";
import {
  quotationInputSchema,
  type QuotationFormValues,
  type QuotationInput,
} from "@/lib/documents/schemas";
import { dmy } from "@/lib/documents/format";
import { cn } from "@/lib/utils";

const errText = (e: unknown): string | undefined =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message ?? "") || undefined
    : undefined;

export function QuotationForm({
  id,
  defaults,
  leads,
  catalogue,
  number,
  nextNumber,
}: {
  id?: string;
  defaults: QuotationFormValues;
  leads: LeadOption[];
  catalogue: Product[];
  number?: string | null;
  nextNumber?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"summary" | "preview">("summary");
  const form = useForm<QuotationFormValues, unknown, QuotationInput>({
    resolver: zodResolver(quotationInputSchema),
    defaultValues: defaults,
    mode: "onBlur",
  });
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = form;
  const terms = useFieldArray({ control, name: "terms" as never });
  const milestones = useFieldArray({ control, name: "milestones" });
  const watched = useWatch({ control });
  const msWatch = (useWatch({ control, name: "milestones" }) ?? []) as {
    kind: "percent" | "fixed";
    value: string;
    label: string;
  }[];

  function save() {
    startTransition(async () => {
      const res = await saveQuotation(form.getValues(), id);
      if (res.ok) {
        toast.success(id ? "Draft saved" : "Quotation draft created");
        router.push(`/quotations/${res.data?.id}`);
        return;
      }
      for (const [name, message] of Object.entries(res.fieldErrors ?? {}))
        form.setError(name as never, { type: "server", message });
      toast.error(res.error);
    });
  }

  function saveAndIssue() {
    handleSubmit(async () => {
      startTransition(async () => {
        const res = await saveQuotation(form.getValues(), id);
        if (!res.ok) {
          for (const [name, message] of Object.entries(res.fieldErrors ?? {})) {
            form.setError(name as never, { type: "server", message });
          }
          toast.error(res.error);
          return;
        }
        const quoteId = res.data?.id || id;
        if (!quoteId) return;

        const issueRes = await issueQuotation(quoteId);
        if (issueRes.ok) {
          toast.success(`Quotation ${issueRes.data?.number} issued successfully`);
          router.push(`/quotations/${quoteId}`);
        } else {
          toast.warning(`Draft saved, but could not issue: ${issueRes.error}`);
          router.push(`/quotations/${quoteId}`);
        }
      });
    }, () => toast.error("Please fix the highlighted fields."))();
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={handleSubmit(save, () =>
          toast.error("Please fix the highlighted fields."),
        )}
        noValidate
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent-soft/30 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-surface font-semibold text-accent shadow-xs">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Quotation Reference</span>
                  <Badge tone={number ? "success" : "neutral"}>{number ? "Issued" : "Draft"}</Badge>
                </div>
                <p className="font-mono text-base font-bold text-foreground sm:text-lg">{number || nextNumber || "NAFA-QUO-26-001"}</p>
              </div>
            </div>
            <div className="text-right text-xs text-muted">
              {number ? "Locked reference number" : "Sequential counter · Increments by 1 on issue"}
            </div>
          </div>

          <ClientSection
            leads={leads}
            onLead={(l) => {
              setValue("event_name", l.event_name || l.title);
              setValue(
                "event_location",
                [l.venue, l.city].filter(Boolean).join(", "),
              );
              setValue(
                "event_date_text",
                l.event_date ? dmy(l.event_date) : "",
              );
              setValue(
                "reference_text",
                `Lead L-${String(l.lead_number).padStart(4, "0")}`,
              );
            }}
          />
          <FormSection title="Event details & dates">
            <Field label="Event type" error={errText(errors.event_type)}>
              {(p) => (
                <Input
                  {...p}
                  {...register("event_type")}
                  placeholder="e.g. Corporate Event"
                />
              )}
            </Field>
            <Field
              label="Event / project name"
              error={errText(errors.event_name)}
            >
              {(p) => <Input {...p} {...register("event_name")} />}
            </Field>
            <Field
              label="Event date or period"
              error={errText(errors.event_date_text)}
              hint="Free text, e.g. 15/02/2027 or 15–17 Feb 2027"
            >
              {(p) => <Input {...p} {...register("event_date_text")} />}
            </Field>
            <Field label="Location" error={errText(errors.event_location)}>
              {(p) => <Input {...p} {...register("event_location")} />}
            </Field>
            <Field
              label="Reference"
              error={errText(errors.reference_text)}
              hint="Lead, project or client reference"
            >
              {(p) => <Input {...p} {...register("reference_text")} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Quotation date"
                required
                error={errText(errors.quotation_date)}
              >
                {(p) => (
                  <Input {...p} {...register("quotation_date")} type="date" />
                )}
              </Field>
              <Field label="Valid until" error={errText(errors.valid_until)}>
                {(p) => (
                  <Input {...p} {...register("valid_until")} type="date" />
                )}
              </Field>
            </div>
          </FormSection>

          <ItemsEditor catalogue={catalogue} />
          <ConfigEditor />

          <section
            className="rounded-lg border border-border bg-surface p-5"
            aria-labelledby="ms-h"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="ms-h" className="text-sm font-semibold">
                  Payment milestones
                </h2>
                <p className="text-xs text-muted">
                  Percentages are shares of the grand total. They must add up to
                  it before the quotation can be issued.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  milestones.append({
                    label: "",
                    kind: "percent",
                    value: "",
                    due_text: "",
                  })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add milestone
              </Button>
            </div>

            <div className="space-y-3">
              {milestones.fields.map((f, i) => (
                <div
                  key={f.id}
                  className="grid items-end gap-3 rounded-md border border-border/70 p-3 sm:grid-cols-12"
                >
                  <Field
                    label="Label"
                    className="sm:col-span-5"
                    error={errText(errors.milestones?.[i]?.label)}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        {...register(`milestones.${i}.label`)}
                        placeholder="e.g. Advance on booking"
                      />
                    )}
                  </Field>
                  <Field label="Kind" className="sm:col-span-2">
                    {(p) => (
                      <Select {...p} {...register(`milestones.${i}.kind`)}>
                        <option value="percent">% of total</option>
                        <option value="fixed">Fixed ₹</option>
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="Value"
                    className="sm:col-span-2"
                    error={errText(errors.milestones?.[i]?.value)}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        {...register(`milestones.${i}.value`)}
                        placeholder="50"
                        inputMode="decimal"
                      />
                    )}
                  </Field>
                  <Field
                    label="Due text"
                    className="sm:col-span-2"
                    error={errText(errors.milestones?.[i]?.due_text)}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        {...register(`milestones.${i}.due_text`)}
                        placeholder="On confirmation"
                      />
                    )}
                  </Field>
                  <div className="flex sm:col-span-1 sm:justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => milestones.remove(i)}
                      aria-label={`Remove milestone ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-lg border border-border bg-surface p-5"
            aria-labelledby="terms-h"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="terms-h" className="text-sm font-semibold">
                  Terms &amp; conditions
                </h2>
                <p className="text-xs text-muted">
                  Printed in numbered order on the quotation.
                </p>
              </div>
              <Button size="sm" onClick={() => terms.append("" as never)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add term
              </Button>
            </div>
            <div className="space-y-3">
              {terms.fields.map((f, i) => (
                <div key={f.id} className="flex items-start gap-2">
                  <span className="w-6 pt-2 text-right font-mono text-xs text-muted">
                    {i + 1}.
                  </span>
                  <Textarea
                    className="flex-1"
                    rows={2}
                    {...register(`terms.${i}` as never)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => terms.remove(i)}
                    aria-label={`Remove term ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
            <Field label="Internal notes (not printed)" className="mt-4">
              {(p) => <Textarea {...p} {...register("notes")} rows={2} />}
            </Field>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Link
              href={id ? `/quotations/${id}` : "/quotations"}
              className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
            >
              Cancel
            </Link>
            <Button type="submit" variant="outline" loading={pending}>
              Save as draft
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={pending}
              onClick={saveAndIssue}
            >
              <FileCheck className="mr-1.5 h-4 w-4" aria-hidden />
              {number ? "Save quotation" : `Issue quotation (${nextNumber || "Next"})`}
            </Button>
          </div>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card className="p-4">
            <div
              role="tablist"
              className="mb-4 flex gap-1 border-b border-border"
            >
              {(["summary", "preview"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "-mb-px border-b-2 px-3 pb-2 text-sm font-medium capitalize",
                    tab === t
                      ? "border-nav"
                      : "border-transparent text-muted hover:text-foreground",
                  )}
                >
                  {t === "summary" ? "Totals" : "Preview"}
                </button>
              ))}
            </div>
            {tab === "summary" ? (
              <SummaryPanel milestones={msWatch} />
            ) : (
              <PreviewPane
                deps={watched}
                load={() =>
                  previewDocument("quotation", form.getValues(), { number: number ?? nextNumber })
                }
              />
            )}
          </Card>
        </aside>
      </form>
    </FormProvider>
  );
}
