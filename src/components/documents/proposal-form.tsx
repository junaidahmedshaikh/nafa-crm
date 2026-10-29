"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/layout";
import { ClientSection, PreviewPane } from "@/components/documents/builder-parts";
import { deleteProposalImage, previewDocument, saveProposal, uploadProposalImage } from "@/lib/actions/documents";
import type { LeadOption } from "@/lib/documents/repo";
import { PROPOSAL_SECTION_TITLES, PROPOSAL_SECTION_TYPES, proposalInputSchema, type ProposalFormValues, type ProposalInput } from "@/lib/documents/schemas";
import { formatINR } from "@/lib/format";

type Attachment = { id: string; section_id: string | null; filename: string; size_bytes: number; caption: string };
type QuotationOption = { id: string; number: string | null; client_company: string; grand_total: number };
const errText = (e: unknown): string | undefined => (e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") || undefined : undefined);

function ImageUploader({ proposalId, sectionId, attachments }: { proposalId: string; sectionId: string; attachments: Attachment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  return (
    <div className="mt-3 rounded-md border border-dashed border-border-strong p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Images &amp; moodboard</p>
      {attachments.length > 0 && (
        <ul className="mb-3 space-y-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-surface-muted px-2 py-1 text-sm">
              <span className="truncate">{a.filename} <span className="text-xs text-muted">({Math.round(a.size_bytes / 1024)} KB){a.caption ? ` · ${a.caption}` : ""}</span></span>
              <Button size="icon" variant="ghost" aria-label={`Remove ${a.filename}`} onClick={() => startTransition(async () => { const r = await deleteProposalImage(a.id); if (r.ok) router.refresh(); else toast.error(r.error); })}><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose image" className="max-w-[16rem] text-sm" />
        <Input aria-label="Caption" placeholder="Caption (optional)" className="w-56" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} />
        <Button size="sm" loading={pending} onClick={() => {
          const file = fileRef.current?.files?.[0];
          if (!file) return toast.error("Choose an image first.");
          const fd = new FormData();
          fd.set("file", file); fd.set("section_id", sectionId); fd.set("caption", caption);
          startTransition(async () => {
            const r = await uploadProposalImage(proposalId, fd);
            if (r.ok) { toast.success("Image added"); setCaption(""); if (fileRef.current) fileRef.current.value = ""; router.refresh(); } else toast.error(r.error);
          });
        }}><ImagePlus className="h-4 w-4" aria-hidden />Add image</Button>
      </div>
      <p className="mt-1 text-xs text-muted">PNG, JPEG or WebP, up to 2 MB. Images keep their aspect ratio in the PDF.</p>
    </div>
  );
}

export function ProposalForm({
  id, defaults, leads, quotations, attachments,
}: { id?: string; defaults: ProposalFormValues; leads: LeadOption[]; quotations: QuotationOption[]; attachments: Attachment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProposalFormValues, unknown, ProposalInput>({ resolver: zodResolver(proposalInputSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, control, formState: { errors } } = form;
  const sections = useFieldArray({ control, name: "sections" });
  const watched = useWatch({ control });
  const mode = useWatch({ control, name: "commercial_mode" });
  const secWatch = (useWatch({ control, name: "sections" }) ?? []) as ProposalFormValues["sections"];
  const [addType, setAddType] = useState("");
  const used = new Set(secWatch.map((s) => s.type));

  function save() {
    startTransition(async () => {
      const res = await saveProposal(form.getValues(), id);
      if (res.ok) {
        toast.success(id ? "Draft saved" : "Proposal draft created");
        if (id) router.refresh();
        router.push(id ? `/proposals/${id}/edit` : `/proposals/${res.data?.id}/edit`);
        return;
      }
      for (const [name, message] of Object.entries(res.fieldErrors ?? {})) form.setError(name as never, { type: "server", message });
      toast.error(res.error);
    });
  }

  const missing = secWatch.map((s, i) => ({ s, i })).filter(({ s }) => s.included && !["commercial", "acceptance", "prepared_for", "cover"].includes(s.type) && !(s.body ?? "").trim() && !attachments.some((a) => a.section_id === s.id));

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(save, () => toast.error("Please fix the highlighted fields."))} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <FormSection title="Proposal">
            <Field label="Proposal title" required className="sm:col-span-2" error={errText(errors.title)}>{(p) => <Input {...p} {...register("title")} placeholder="e.g. Annual Dealer Meet 2027 — Event Proposal" />}</Field>
            <Field label="Proposal date" required error={errText(errors.proposal_date)}>{(p) => <Input {...p} {...register("proposal_date")} type="date" />}</Field>
          </FormSection>
          <ClientSection leads={leads} />

          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="sec-h">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="sec-h" className="text-sm font-semibold">Sections</h2>
                <p className="text-xs text-muted">Reorder, rename, switch off or add sections. Only what you write is printed — nothing is invented for you. Use a blank line for a new paragraph, “- ” for bullets and “## ” for a sub-heading.</p>
              </div>
              <div className="flex gap-2">
                <Select aria-label="Section type to add" value={addType} onChange={(e) => setAddType(e.target.value)} className="w-56">
                  <option value="">Add a section…</option>
                  {PROPOSAL_SECTION_TYPES.filter(([t]) => t === "custom" || !used.has(t)).map(([t, label]) => <option key={t} value={t}>{label}</option>)}
                </Select>
                <Button size="sm" disabled={!addType} onClick={() => { sections.append({ id: "", type: addType, title: PROPOSAL_SECTION_TITLES[addType] ?? "", body: "", included: true }); setAddType(""); }}><Plus className="h-4 w-4" aria-hidden />Add</Button>
              </div>
            </div>
            {missing.length > 0 && (
              <p role="status" className="mb-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Not filled in yet (left out of the PDF): {missing.map(({ s }) => s.title).join(" · ")}
              </p>
            )}
            <ol className="space-y-3">
              {sections.fields.map((f, i) => {
                const cur = secWatch[i];
                const isMissing = missing.some((m) => m.i === i);
                const sectionErr = (errors.sections as unknown as Record<number, Record<string, unknown>> | undefined)?.[i];
                return (
                  <li key={f.id} className="rounded-md border border-border bg-surface-muted p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="w-6 text-sm text-muted">{i + 1}.</span>
                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4" {...register(`sections.${i}.included`)} />Include</label>
                      <Input aria-label={`Section ${i + 1} title`} className="max-w-sm flex-1 font-medium" {...register(`sections.${i}.title`)} />
                      <input type="hidden" {...register(`sections.${i}.id`)} /><input type="hidden" {...register(`sections.${i}.type`)} />
                      {isMissing && <Badge tone="warning">Missing</Badge>}
                      <span className="flex-1" />
                      <Button size="icon" variant="ghost" onClick={() => sections.move(i, i - 1)} disabled={i === 0} aria-label={`Move section ${i + 1} up`}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => sections.move(i, i + 1)} disabled={i === sections.fields.length - 1} aria-label={`Move section ${i + 1} down`}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => sections.remove(i)} aria-label={`Remove section ${i + 1}`}><Trash2 className="h-4 w-4 text-danger" /></Button>
                    </div>
                    {errText(sectionErr?.title) && <p role="alert" className="mb-1 text-xs text-danger">{errText(sectionErr?.title)}</p>}
                    {cur?.type === "commercial" ? (
                      <p className="text-sm text-muted">The cost breakdown comes from “Commercial summary” below. Text you add here is printed under the table.</p>
                    ) : cur?.type === "acceptance" ? (
                      <p className="text-sm text-muted">Signature blocks for the client and NAFA are added automatically. Text here is printed above them.</p>
                    ) : cur?.type === "prepared_for" ? (
                      <p className="text-sm text-muted">Client details are filled from the Client section above. Add any extra text here.</p>
                    ) : null}
                    <Textarea aria-label={`Section ${i + 1} content`} rows={cur?.type === "cover" ? 3 : 6} placeholder={cur?.type === "cover" ? "Short introduction shown under the title (optional)" : "Write this section…"} {...register(`sections.${i}.body`)} />
                    {id && cur?.id ? (
                      <ImageUploader proposalId={id} sectionId={cur.id} attachments={attachments.filter((a) => a.section_id === cur.id)} />
                    ) : (
                      <p className="mt-2 text-xs text-muted">Save the draft to attach images to this section.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <FormSection title="Commercial summary" description="Link a quotation to reuse its line items and totals, or describe the commercials yourself.">
            <Field label="Source" error={errText(errors.commercial_mode)}>
              {(p) => <Select {...p} {...register("commercial_mode")}><option value="none">Not included</option><option value="linked">Linked to a quotation</option><option value="manual">Written manually</option></Select>}
            </Field>
            {mode === "linked" && (
              <Field label="Quotation" required error={errText(errors.quotation_id)} hint="The proposal shows this quotation's lines and totals at the time it is issued.">
                {(p) => (
                  <Select {...p} {...register("quotation_id")}>
                    <option value="">— Choose —</option>
                    {quotations.map((q) => <option key={q.id} value={q.id}>{q.number ?? "Draft"} · {q.client_company || "—"} · {formatINR(q.grand_total)}</option>)}
                  </Select>
                )}
              </Field>
            )}
            {mode !== "none" && <Field label={mode === "manual" ? "Commercial details" : "Additional commercial notes"} className="sm:col-span-2" error={errText(errors.commercial_note)}>{(p) => <Textarea {...p} {...register("commercial_note")} rows={4} />}</Field>}
          </FormSection>

          <div className="flex justify-end gap-2">
            <Link href={id ? `/proposals/${id}` : "/proposals"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
            <Button type="submit" variant="primary" loading={pending}>Save as draft</Button>
          </div>
        </div>

        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold">Preview</p>
            <PreviewPane deps={[watched, attachments.length]} load={() => previewDocument("proposal", form.getValues(), { proposalId: id ?? null })} />
          </Card>
        </aside>
      </form>
    </FormProvider>
  );
}
