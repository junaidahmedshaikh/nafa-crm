"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Textarea } from "@/components/ui/form";
import { DuplicatePanel } from "@/components/shared/duplicate-panel";
import { saveCompany } from "@/lib/actions/directory";
import type { DuplicateReport } from "@/lib/types";
import { companySchema, type CompanyFormData, type CompanyFormInput } from "@/lib/validation/schemas";

export function CompanyForm({ companyId, defaults }: { companyId?: string; defaults: CompanyFormInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const form = useForm<CompanyFormInput, unknown, CompanyFormData>({ resolver: zodResolver(companySchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, formState: { errors } } = form;
  const e = (n: keyof CompanyFormInput) => errors[n]?.message as string | undefined;

  function submit(confirmDuplicate = false) {
    startTransition(async () => {
      const res = await saveCompany(form.getValues(), { id: companyId, confirmDuplicate });
      if (res.ok) {
        toast.success(companyId ? "Company updated" : "Company created");
        router.push(`/companies/${res.data?.id}`);
        return;
      }
      if (res.duplicates) return setDuplicates(res.duplicates);
      Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => form.setError(k as keyof CompanyFormInput, { type: "server", message }));
      toast.error(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit(() => submit())} className="space-y-5" noValidate>
      {duplicates && <DuplicatePanel entity="company" report={duplicates} pending={pending} onCreateAnyway={() => { setDuplicates(null); submit(true); }} onDismiss={() => setDuplicates(null)} />}
      <FormSection title="Company details">
        <Field label="Company name" required error={e("name")} className="sm:col-span-2">{(p) => <Input {...p} {...register("name")} />}</Field>
        <Field label="Website" error={e("website")}>{(p) => <Input {...p} {...register("website")} placeholder="https://" inputMode="url" />}</Field>
        <Field label="Industry" error={e("industry")}>{(p) => <Input {...p} {...register("industry")} />}</Field>
        <Field label="City" error={e("city")}>{(p) => <Input {...p} {...register("city")} />}</Field>
        <Field label="Address" error={e("address")}>{(p) => <Input {...p} {...register("address")} />}</Field>
        <Field label="Notes" error={e("notes")} className="sm:col-span-2">{(p) => <Textarea {...p} {...register("notes")} rows={4} />}</Field>
      </FormSection>
      <div className="flex justify-end gap-2">
        <Link href={companyId ? `/companies/${companyId}` : "/companies"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">Cancel</Link>
        <Button type="submit" variant="primary" loading={pending}>{companyId ? "Save changes" : "Create company"}</Button>
      </div>
    </form>
  );
}
