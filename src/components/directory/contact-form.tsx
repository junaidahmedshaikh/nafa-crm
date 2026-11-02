"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { DuplicatePanel } from "@/components/shared/duplicate-panel";
import { saveContact } from "@/lib/actions/directory";
import type { DuplicateReport } from "@/lib/types";
import { contactSchema, type ContactFormData, type ContactFormInput } from "@/lib/validation/schemas";

export function ContactForm({
  contactId, defaults, companies, countryCode,
}: {
  contactId?: string;
  defaults: ContactFormInput;
  companies: { id: string; name: string }[];
  countryCode: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const form = useForm<ContactFormInput, unknown, ContactFormData>({
    resolver: zodResolver(contactSchema(countryCode)), defaultValues: defaults, mode: "onBlur",
  });
  const { register, handleSubmit, formState: { errors } } = form;
  const e = (n: keyof ContactFormInput) => errors[n]?.message as string | undefined;

  function submit(confirmDuplicate = false) {
    startTransition(async () => {
      const res = await saveContact(form.getValues(), { id: contactId, confirmDuplicate });
      if (res.ok) {
        toast.success(contactId ? "Contact updated" : "Contact created");
        router.push(`/contacts/${res.data?.id}`);
        return;
      }
      if (res.duplicates) return setDuplicates(res.duplicates);
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => form.setError(k as keyof ContactFormInput, { type: "server", message }));
      toast.error(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(() => submit())} className="space-y-5" noValidate>
      {duplicates && <DuplicatePanel entity="contact" report={duplicates} pending={pending} onCreateAnyway={() => { setDuplicates(null); submit(true); }} onDismiss={() => setDuplicates(null)} />}
      <FormSection title="Contact details">
        <Field label="Full name" required error={e("full_name")}>{(p) => <Input {...p} {...register("full_name")} />}</Field>
        <Field label="Designation" error={e("designation")}>{(p) => <Input {...p} {...register("designation")} />}</Field>
        <Field label="Company" error={e("company_id")}>
          {(p) => (
            <Select {...p} {...register("company_id")}>
              <option value="">No company</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Work email" error={e("email")}>{(p) => <Input {...p} {...register("email")} type="email" inputMode="email" />}</Field>
        <Field label="Phone" error={e("phone")} hint={`Numbers without a country code use ${countryCode}.`}>{(p) => <Input {...p} {...register("phone")} inputMode="tel" />}</Field>
        <Field label="WhatsApp (if different)" error={e("whatsapp")}>{(p) => <Input {...p} {...register("whatsapp")} inputMode="tel" />}</Field>
        <Field label="Communication preferences / restrictions" error={e("communication_notes")} className="sm:col-span-2" hint='e.g. "WhatsApp only", "No calls after 6 pm", "Do not email"'>
          {(p) => <Input {...p} {...register("communication_notes")} />}
        </Field>
        <Field label="Notes" error={e("notes")} className="sm:col-span-2">{(p) => <Textarea {...p} {...register("notes")} rows={4} />}</Field>
      </FormSection>
      <div className="flex justify-end gap-2">
        <Link href={contactId ? `/contacts/${contactId}` : "/contacts"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
        <Button type="submit" variant="primary" loading={pending}>{contactId ? "Save changes" : "Create contact"}</Button>
      </div>
    </form>
  );
}
