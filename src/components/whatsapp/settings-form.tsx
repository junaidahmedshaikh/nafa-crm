"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, Select } from "@/components/ui/form";
import { saveWaSettings } from "@/lib/actions/whatsapp";
import { waSettingsSchema, type WaSettingsData, type WaSettingsInput } from "@/lib/whatsapp/schemas";

export function WaSettingsForm({ defaults, canEdit, liveConnected }: { defaults: WaSettingsInput; canEdit: boolean; liveConnected: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<WaSettingsInput, unknown, WaSettingsData>({ resolver: zodResolver(waSettingsSchema), defaultValues: defaults, mode: "onBlur" });
  const { register, handleSubmit, formState: { errors } } = form;
  const e = (n: keyof WaSettingsInput) => errors[n]?.message as string | undefined;

  return (
    <form
      noValidate className="space-y-5"
      onSubmit={handleSubmit(() => start(async () => {
        const res = await saveWaSettings(form.getValues());
        if (res.ok) { toast.success("Settings saved"); router.refresh(); return; }
        Object.entries(res.fieldErrors ?? {}).forEach(([k, message]) => form.setError(k as keyof WaSettingsInput, { type: "server", message }));
        toast.error(res.error);
      }))}
    >
      <fieldset disabled={!canEdit} className="space-y-5">
        <FormSection title="Sending mode" description="Dry run rehearses a campaign without messaging anyone. Live sends real WhatsApp messages.">
          <Field label="Mode" error={e("mode")} hint={liveConnected ? "WhatsApp credentials found on the server." : "Live needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the server environment."} className="sm:col-span-2">
            {(p) => (
              <Select {...p} {...register("mode")}>
                <option value="dry_run">Dry run (nothing is sent)</option>
                <option value="live">Live (real messages)</option>
              </Select>
            )}
          </Field>
        </FormSection>
        <FormSection title="Safety limits" description="These protect your number's quality rating. Start low and raise them only as WhatsApp raises your tier.">
          <Field label="Daily limit" error={e("daily_limit")} hint="Unique people per rolling 24 hours, across all campaigns. New numbers start at 250.">{(p) => <Input {...p} {...register("daily_limit")} inputMode="numeric" />}</Field>
          <Field label="Messages per batch" error={e("batch_size")} hint="How many go out before the page checks in again.">{(p) => <Input {...p} {...register("batch_size")} inputMode="numeric" />}</Field>
          <Field label="Pause between messages (ms)" error={e("send_gap_ms")} hint="1000 = one message per second.">{(p) => <Input {...p} {...register("send_gap_ms")} inputMode="numeric" />}</Field>
          <Field label="Don’t message the same person again within (days)" error={e("repeat_window_days")} hint="0 turns this off.">{(p) => <Input {...p} {...register("repeat_window_days")} inputMode="numeric" />}</Field>
          <Field label="Your cost per message (₹)" error={e("cost_per_message")} hint="From Meta’s current rate card for your category. Used only for the estimate." className="sm:col-span-2">
            {(p) => <Input {...p} {...register("cost_per_message")} inputMode="decimal" placeholder="e.g. 0.88" />}
          </Field>
        </FormSection>
      </fieldset>
      {canEdit ? (
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save settings</Button></div>
      ) : (
        <p className="text-sm text-muted">Only an admin can change these settings.</p>
      )}
    </form>
  );
}
