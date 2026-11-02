"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { saveTemplate } from "@/lib/actions/whatsapp";
import { CATEGORY_LABELS, TEMPLATE_CATEGORIES, templateInputSchema, type TemplateData, type TemplateInput } from "@/lib/whatsapp/schemas";
import { CONTACT_VARIABLES, checkTemplate, customPlaceholders, renderTemplate } from "@/lib/whatsapp/template";
import { Bubble } from "./bits";

const SAMPLE = { full_name: "Asha Rao", company_name: "Acme Foods", designation: "Marketing Head" };

export function TemplateForm({ templateId, defaults, locked }: { templateId?: string; defaults: TemplateInput; locked?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<TemplateInput, unknown, TemplateData>({ resolver: zodResolver(templateInputSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, control, setValue, formState: { errors } } = form;
  const e = (n: keyof TemplateInput) => errors[n]?.message as string | undefined;
  const [body, footer, category] = useWatch({ control, name: ["body", "footer", "category"] });

  const check = useMemo(() => checkTemplate({ body: body ?? "", footer, category: category ?? "marketing" }), [body, footer, category]);
  const preview = useMemo(() => {
    const custom = Object.fromEntries(customPlaceholders(body ?? "").map((p) => [p, `[${p}]`]));
    return renderTemplate({ body: body ?? "", footer }, SAMPLE, custom).text;
  }, [body, footer]);

  function insert(name: string) {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const token = `{{${name}}}`;
    const cur = form.getValues("body") ?? "";
    const at = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? at;
    setValue("body", cur.slice(0, at) + token + cur.slice(end), { shouldDirty: true, shouldValidate: true });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  }

  function submit() {
    startTransition(async () => {
      const res = await saveTemplate(form.getValues(), templateId);
      if (res.ok) {
        toast.success(templateId ? "Template saved" : "Template created");
        router.push(`/whatsapp/templates/${res.data?.id ?? templateId}`);
        router.refresh();
        return;
      }
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => form.setError(k as keyof TemplateInput, { type: "server", message }));
      toast.error(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(() => submit())} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" noValidate>
      <div className="space-y-5">
        <FormSection title="Template" description="Meta must approve a template before you can message people with it.">
          <Field label="Name" required error={e("name")} hint="Lowercase letters, numbers and underscores, e.g. event_invite">
            {(p) => <Input {...p} {...register("name")} disabled={locked} autoComplete="off" />}
          </Field>
          <Field label="Language" required error={e("language")} hint="en, en_GB, hi…">{(p) => <Input {...p} {...register("language")} autoComplete="off" />}</Field>
          <Field label="Category" required error={e("category")} className="sm:col-span-2" hint="Marketing = offers and invitations. Utility = updates about something the customer already asked for or bought.">
            {(p) => <Select {...p} {...register("category")}>{TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>}
          </Field>
          <Field label="Message" required error={e("body")} className="sm:col-span-2">
            {(p) => <Textarea {...p} {...register("body")} rows={7} />}
          </Field>
          <div className="sm:col-span-2 -mt-2">
            <p className="mb-1.5 text-xs text-muted">Insert a placeholder (filled in for each person):</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CONTACT_VARIABLES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => insert(k)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-muted">{v.label}</button>
              ))}
              <button type="button" onClick={() => insert("event_name")} className="rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs hover:bg-surface-muted">+ Event name</button>
              <button type="button" onClick={() => insert("event_date")} className="rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs hover:bg-surface-muted">+ Event date</button>
            </div>
            <p className="mt-1.5 text-xs text-muted">Write your own too, such as {"{{offer_code}}"}. You will fill campaign-wide ones in when you create the campaign.</p>
          </div>
          <Field label="Footer" error={e("footer")} className="sm:col-span-2" hint="Up to 60 characters. For marketing, include how to opt out.">
            {(p) => <Input {...p} {...register("footer")} placeholder="Reply STOP to unsubscribe" />}
          </Field>
        </FormSection>

        {(check.errors.length > 0 || check.warnings.length > 0) && (body ?? "").trim().length > 0 && (
          <ul className="space-y-2" aria-live="polite">
            {check.errors.map((m) => (
              <li key={m} className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{m}</li>
            ))}
            {check.warnings.map((m) => (
              <li key={m} className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{m}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Link href="/whatsapp/templates" className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
          <Button type="submit" variant="primary" loading={pending} disabled={check.errors.length > 0}>{templateId ? "Save template" : "Create template"}</Button>
        </div>
        {templateId && <p className="text-xs text-muted">Changing the message of an approved template sends it back to “Draft”. It needs approval again before live use.</p>}
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="mb-3 text-xs text-muted">Shown with a sample contact ({SAMPLE.full_name}, {SAMPLE.company_name}).</p>
          {(body ?? "").trim() ? <Bubble text={preview} /> : <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted">Start typing to see the message.</p>}
          <p className="mt-3 text-xs text-muted">{(body ?? "").length}/1024 characters</p>
        </div>
      </aside>
    </form>
  );
}
