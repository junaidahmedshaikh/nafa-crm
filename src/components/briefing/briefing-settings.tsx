"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { saveBriefingSettings, sendTestBriefing } from "@/lib/actions/briefing";
import { DAY_NAMES, type BriefingSettings } from "@/lib/briefing/core";
import { TIMEZONES } from "@/lib/scheduled/core";

export function BriefingSettingsForm({ settings, canEdit }: { settings: BriefingSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [testing, startTest] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [days, setDays] = useState(settings.days);
  const [custom, setCustom] = useState<number[]>(settings.custom_days);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const off = !canEdit || pending;

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        startTransition(async () => {
          const r = await saveBriefingSettings({ enabled, delivery_time: f.delivery_time, timezone: f.timezone, method: f.method, recipient_email: f.recipient_email ?? "", days, custom_days: custom });
          if (r.ok) { setErrors({}); toast.success(enabled ? "Daily Business Briefing is ON" : "Saved. The daily briefing is off."); router.refresh(); }
          else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
        });
      }}
    >
      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={enabled} disabled={off} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <span className="block text-sm font-semibold">Enable Daily Business Briefing</span>
          <span className="block text-xs text-muted">One report every morning: meetings, tasks, follow-ups, quotations, invoices, payments, projects, vendors and finance, with a recommended action plan. Untick to pause it; tick again to resume.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Delivery time" error={errors.delivery_time}>{(p) => <Input {...p} name="delivery_time" type="time" defaultValue={settings.delivery_time} disabled={off} />}</Field>
        <Field label="Time zone">{(p) => <Select {...p} name="timezone" defaultValue={settings.timezone} disabled={off}>{TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select>}</Field>
        <Field label="Delivery method">{(p) => (
          <Select {...p} name="method" defaultValue={settings.method} disabled={off}><option value="both">Email and in-app notification</option><option value="email">Email only</option><option value="in_app">In-app notification only</option></Select>)}
        </Field>
        <Field label="Recipient email address" error={errors.recipient_email}>{(p) => <Input {...p} name="recipient_email" type="email" defaultValue={settings.recipient_email} placeholder="you@nafaevents.in" disabled={off} />}</Field>
        <Field label="Days of delivery" error={errors.custom_days}>{(p) => (
          <Select {...p} value={days} onChange={(e) => setDays(e.target.value as BriefingSettings["days"])} disabled={off}><option value="all">Every day (including weekends)</option><option value="weekdays">Weekdays only (Mon–Fri)</option><option value="custom">Custom days</option></Select>)}
        </Field>
      </div>
      {days === "custom" && (
        <div className="flex flex-wrap gap-3">
          {DAY_NAMES.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={custom.includes(i)} disabled={off} onChange={() => setCustom((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} />{d.slice(0, 3)}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Public holidays are not known to the CRM, so they are treated like any other day. Use Custom days, or untick the box above, to skip a day.</p>
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button loading={testing} disabled={pending}
            onClick={() => startTest(async () => {
              const r = await sendTestBriefing();
              if (r.ok) { toast.success(r.data.message || "Test briefing created"); router.push(`/briefing/${r.data.id}`); } else toast.error(r.error);
            })}>{!testing && <Send className="h-4 w-4" aria-hidden />}Send Test Briefing</Button>
          <Button type="submit" variant="primary" loading={pending} disabled={testing}>Save settings</Button>
        </div>
      ) : <p className="text-xs text-muted">Only an administrator can change these settings.</p>}
      <p className="text-xs text-muted">Send Test Briefing uses the saved method and recipient, so save your changes first.</p>
    </form>
  );
}
