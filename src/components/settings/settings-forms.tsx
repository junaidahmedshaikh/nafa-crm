"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select } from "@/components/ui/form";
import { saveProfile, saveSettings } from "@/lib/actions/settings";
import { FOLLOW_UP_TYPE_OPTIONS } from "@/lib/constants";
import {
  profileSchema, settingsSchema, type ProfileFormInput, type SettingsFormData, type SettingsFormInput,
} from "@/lib/validation/schemas";

export function BusinessSettingsForm({ defaults, canEdit }: { defaults: SettingsFormInput; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<SettingsFormInput, unknown, SettingsFormData>({ resolver: zodResolver(settingsSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, formState: { errors } } = form;
  const e = (n: keyof SettingsFormInput) => errors[n]?.message as string | undefined;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit(() =>
        startTransition(async () => {
          const res = await saveSettings(form.getValues());
          if (res.ok) { toast.success("Settings saved"); router.refresh(); return; }
          Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => form.setError(k as keyof SettingsFormInput, { type: "server", message }));
          toast.error(res.error);
        }),
      )}
    >
      <FormSection title="Business" description={canEdit ? undefined : "Only an administrator can change these settings."}>
        <Field label="Business name" required error={e("business_name")}>{(p) => <Input {...p} {...register("business_name")} disabled={!canEdit} />}</Field>
        <Field label="Website" error={e("website")}>{(p) => <Input {...p} {...register("website")} disabled={!canEdit} inputMode="url" />}</Field>
        <Field label="Business email" error={e("business_email")}>{(p) => <Input {...p} {...register("business_email")} type="email" disabled={!canEdit} />}</Field>
        <Field label="Currency" hint="All amounts are stored and shown in Indian Rupees.">{(p) => <Input {...p} value="INR (₹)" disabled readOnly />}</Field>
        <Field label="Default country code" error={e("default_country_code")} hint="Applied to phone numbers entered without a country code.">
          {(p) => <Input {...p} {...register("default_country_code")} disabled={!canEdit} />}
        </Field>
      </FormSection>
      <FormSection title="Follow-up preferences" description="Pre-fills the “Schedule follow-up” form.">
        <Field label="Default follow-up after (days)" error={e("default_follow_up_days")}>
          {(p) => <Input {...p} {...register("default_follow_up_days")} inputMode="numeric" disabled={!canEdit} />}
        </Field>
        <Field label="Default time (IST)" error={e("default_follow_up_time")}>
          {(p) => <Input {...p} {...register("default_follow_up_time")} type="time" disabled={!canEdit} />}
        </Field>
        <Field label="Default type" error={e("default_follow_up_type")}>
          {(p) => <Select {...p} {...register("default_follow_up_type")} disabled={!canEdit}>{FOLLOW_UP_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
        </Field>
      </FormSection>
      {canEdit && (
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save settings</Button></div>
      )}
    </form>
  );
}

export function ProfileForm({ defaults, email, role }: { defaults: ProfileFormInput; email: string; role: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProfileFormInput>({ resolver: zodResolver(profileSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, formState: { errors } } = form;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit(() =>
        startTransition(async () => {
          const res = await saveProfile(form.getValues());
          if (res.ok) { toast.success("Profile saved"); router.refresh(); } else toast.error(res.error);
        }),
      )}
    >
      <FormSection title="Your profile">
        <Field label="Full name" required error={errors.full_name?.message}>{(p) => <Input {...p} {...register("full_name")} autoComplete="name" />}</Field>
        <Field label="Email" hint="Managed through Supabase Auth.">{(p) => <Input {...p} value={email} disabled readOnly />}</Field>
        <Field label="Role">{(p) => <Input {...p} value={role} disabled readOnly className="capitalize" />}</Field>
      </FormSection>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save profile</Button></div>
    </form>
  );
}
