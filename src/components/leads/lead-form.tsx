"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { DuplicatePanel } from "@/components/shared/duplicate-panel";
import { saveLead, type DuplicateResolution } from "@/lib/actions/leads";
import {
  LEAD_PRIORITY_OPTIONS, LEAD_SOURCE_OPTIONS, LEAD_STATUS_OPTIONS, SERVICE_CATEGORY_OPTIONS,
} from "@/lib/constants";
import type { DuplicateReport } from "@/lib/types";
import { leadSchema, type LeadFormData, type LeadFormInput } from "@/lib/validation/schemas";

type Props = {
  mode: "create" | "edit";
  leadId?: string;
  defaults: LeadFormInput;
  team: { id: string; full_name: string }[];
  companyNames: string[];
  countryCode: string;
};

export function LeadForm({ mode, leadId, defaults, team, companyNames, countryCode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [duplicates, setDuplicates] = useState<DuplicateReport | null>(null);
  const form = useForm<LeadFormInput, unknown, LeadFormData>({
    resolver: zodResolver(leadSchema(countryCode)),
    defaultValues: defaults,
    mode: "onBlur",
  });
  const { register, handleSubmit, control, formState: { errors } } = form;
  const status = useWatch({ control, name: "status" });

  function submit(resolution?: DuplicateResolution) {
    startTransition(async () => {
      const res = await saveLead(form.getValues(), { id: leadId, resolution });
      if (res.ok) {
        if (res.data?.warning) toast.warning(res.data.warning);
        toast.success(mode === "create" ? "Lead created" : "Lead updated");
        router.push(`/leads/${res.data?.id ?? leadId}`);
        return;
      }
      if (res.duplicates) {
        setDuplicates(res.duplicates);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (res.fieldErrors) {
        for (const [name, message] of Object.entries(res.fieldErrors)) {
          form.setError(name as keyof LeadFormInput, { type: "server", message });
        }
      }
      toast.error(res.error);
    });
  }

  const e = (name: keyof LeadFormInput) => errors[name]?.message as string | undefined;

  return (
    <form onSubmit={handleSubmit(() => submit())} className="space-y-5" noValidate>
      {duplicates && (
        <DuplicatePanel
          report={duplicates}
          pending={pending}
          onUseExisting={() => { setDuplicates(null); submit("use_existing"); }}
          onCreateNew={() => { setDuplicates(null); submit("create_new"); }}
          onDismiss={() => setDuplicates(null)}
        />
      )}

      <FormSection title="Lead details">
        <Field label="Lead title / opportunity" required error={e("title")} className="sm:col-span-2">
          {(p) => <Input {...p} {...register("title")} placeholder="e.g. Annual Dealer Meet 2027" />}
        </Field>
        <Field label="Source" error={e("source")}>
          {(p) => <Select {...p} {...register("source")}>{LEAD_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
        </Field>
        <Field label="Service category" error={e("service_category")}>
          {(p) => <Select {...p} {...register("service_category")}>{SERVICE_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
        </Field>
        <Field label="Status" error={e("status")}>
          {(p) => <Select {...p} {...register("status")}>{LEAD_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
        </Field>
        <Field label="Priority" error={e("priority")}>
          {(p) => <Select {...p} {...register("priority")}>{LEAD_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
        </Field>
        <Field label="Assigned owner" error={e("assigned_to")}>
          {(p) => (
            <Select {...p} {...register("assigned_to")}>
              <option value="">Unassigned</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.full_name || "Team member"}</option>)}
            </Select>
          )}
        </Field>
        {status === "lost" && (
          <Field label="Lost reason" required error={e("lost_reason")}>
            {(p) => <Input {...p} {...register("lost_reason")} placeholder="e.g. Budget too low, went with another agency" />}
          </Field>
        )}
      </FormSection>

      <FormSection title="Company & contact" description="Existing companies and contacts are matched automatically; you will be asked before anything is reused.">
        <Field label="Company name" error={e("company_name")}>
          {(p) => (
            <>
              <Input {...p} {...register("company_name")} list="company-names" autoComplete="off" />
              <datalist id="company-names">{companyNames.map((n) => <option key={n} value={n} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Website" error={e("website")}>
          {(p) => <Input {...p} {...register("website")} placeholder="https://" inputMode="url" />}
        </Field>
        <Field label="Contact person" error={e("contact_name")}>
          {(p) => <Input {...p} {...register("contact_name")} autoComplete="off" />}
        </Field>
        <Field label="Designation" error={e("designation")}>
          {(p) => <Input {...p} {...register("designation")} />}
        </Field>
        <Field label="Email" error={e("email")}>
          {(p) => <Input {...p} {...register("email")} type="email" inputMode="email" />}
        </Field>
        <Field label="Phone" error={e("phone")} hint={`Include the country code; numbers without one use ${countryCode}.`}>
          {(p) => <Input {...p} {...register("phone")} inputMode="tel" placeholder={`${countryCode} 98765 43210`} />}
        </Field>
        <Field label="WhatsApp (if different)" error={e("whatsapp")}>
          {(p) => <Input {...p} {...register("whatsapp")} inputMode="tel" />}
        </Field>
      </FormSection>

      <FormSection title="Event & budget">
        <Field label="Event / campaign name" error={e("event_name")}>
          {(p) => <Input {...p} {...register("event_name")} />}
        </Field>
        <Field label="Event date" error={e("event_date")}>
          {(p) => <Input {...p} {...register("event_date")} type="date" />}
        </Field>
        <Field label="City" error={e("city")}>
          {(p) => <Input {...p} {...register("city")} />}
        </Field>
        <Field label="Venue" error={e("venue")}>
          {(p) => <Input {...p} {...register("venue")} />}
        </Field>
        <Field label="Estimated budget (₹)" error={e("budget_inr")}>
          {(p) => <Input {...p} {...register("budget_inr")} inputMode="decimal" placeholder="1500000" />}
        </Field>
        <Field label="Expected revenue (₹)" error={e("expected_revenue_inr")}>
          {(p) => <Input {...p} {...register("expected_revenue_inr")} inputMode="decimal" placeholder="300000" />}
        </Field>
      </FormSection>

      <FormSection title="Follow-up & notes">
        {mode === "create" && (
          <Field label="First follow-up" error={e("first_follow_up_at")} hint="Optional. Creates a follow-up task (IST).">
            {(p) => <Input {...p} {...register("first_follow_up_at")} type="datetime-local" />}
          </Field>
        )}
        <Field label="Last contact date" error={e("last_contact_date")}>
          {(p) => <Input {...p} {...register("last_contact_date")} type="date" />}
        </Field>
        <Field label="Notes & requirements" error={e("notes")} className="sm:col-span-2">
          {(p) => <Textarea {...p} {...register("notes")} rows={5} />}
        </Field>
      </FormSection>

      <div className="flex justify-end gap-2">
        <Link href={leadId ? `/leads/${leadId}` : "/leads"} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
          Cancel
        </Link>
        <Button type="submit" variant="primary" loading={pending}>{mode === "create" ? "Create lead" : "Save changes"}</Button>
      </div>
    </form>
  );
}
