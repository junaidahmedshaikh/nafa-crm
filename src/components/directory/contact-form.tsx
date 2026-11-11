"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input } from "@/components/ui/form";
import { CategoryTags } from "@/components/directory/category-tags";
import { GroupPicker, type GroupOption } from "@/components/email/group-picker";
import { DuplicatePanel } from "@/components/shared/duplicate-panel";
import { saveContact } from "@/lib/actions/directory";
import type { DuplicateReport } from "@/lib/types";
import { contactSchema, type ContactFormData, type ContactFormInput } from "@/lib/validation/schemas";

export function ContactForm({
  contactId, defaults, companies, countryCode, groups = [],
}: {
  contactId?: string;
  defaults: ContactFormInput;
  companies: { id: string; name: string }[];
  countryCode: string;
  groups?: GroupOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const form = useForm<ContactFormInput, unknown, ContactFormData>({
    resolver: zodResolver(contactSchema(countryCode)), defaultValues: defaults, mode: "onBlur",
  });
  const { register, handleSubmit, formState: { errors } } = form;
  const groupIds = useWatch({ control: form.control, name: "group_ids" }) ?? [];
  const categories = useWatch({ control: form.control, name: "categories" }) ?? [];
  const companyId = useWatch({ control: form.control, name: "company_id" }) ?? "";
  const [companyText, setCompanyText] = useState(companies.find((c) => c.id === defaults.company_id)?.name ?? "");
  const newCompany = useWatch({ control: form.control, name: "new_company_name" }) ?? "";
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
        <Field label="Company" error={e("company_id")} hint="Type the company name. An existing company is reused; a new name is created when you save.">
          {(p) => (
            <Input
              {...p} autoComplete="off" value={companyText} placeholder="Company name"
              onChange={(ev) => {
                const v = ev.target.value;
                setCompanyText(v);
                const hit = companies.find((c) => c.name.trim().toLowerCase() === v.trim().toLowerCase());
                form.setValue("company_id", hit ? hit.id : "", { shouldDirty: true });
                form.setValue("new_company_name", hit || !v.trim() ? "" : v.trim(), { shouldDirty: true });
              }}
            />
          )}
        </Field>
        {newCompany && !companyId && (
          <>
            <Field label="New company — industry" hint="Helps group and filter contacts for email campaigns.">{(p) => <Input {...p} {...register("new_company_industry")} placeholder="e.g. Wedding planning" />}</Field>
            <Field label="New company — city">{(p) => <Input {...p} {...register("new_company_city")} placeholder="e.g. Mumbai" />}</Field>
          </>
        )}
        <Field label="Work email" error={e("email")}>{(p) => <Input {...p} {...register("email")} type="email" inputMode="email" />}</Field>
        <Field label="Phone" error={e("phone")} hint={`Numbers without a country code use ${countryCode}.`}>{(p) => <Input {...p} {...register("phone")} inputMode="tel" />}</Field>
        <Field label="WhatsApp (if different)" error={e("whatsapp")}>{(p) => <Input {...p} {...register("whatsapp")} inputMode="tel" />}</Field>
      </FormSection>
      <FormSection title="Category & recipient groups" description="Used by AI Email Marketing to choose who receives a campaign. Dynamic groups fill themselves from their conditions.">
        <div className="space-y-1.5 sm:col-span-2">
          <p className="text-[13px] font-medium">Business category</p>
          <CategoryTags value={categories} onChange={(v) => form.setValue("categories", v, { shouldDirty: true })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <p className="text-[13px] font-medium">Recipient groups</p><GroupPicker groups={groups} value={groupIds} onChange={(ids) => form.setValue("group_ids", ids, { shouldDirty: true })} /></div>
      </FormSection>
      <div className="flex justify-end gap-2">
        <Link href={contactId ? `/contacts/${contactId}` : "/contacts"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
        <Button type="submit" variant="primary" loading={pending}>{contactId ? "Save changes" : "Create contact"}</Button>
      </div>
    </form>
  );
}
