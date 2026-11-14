"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { saveReminderSettings } from "@/lib/actions/scheduled";
import { offsetLabel, REMINDER_OFFSETS, type ReminderSettings } from "@/lib/scheduled/core";

/** Automatic payment reminders: on/off, which days, the hour, and the wording. Read-only for people who cannot manage finance. */
export function ReminderSettingsForm({ settings, canEdit }: { settings: ReminderSettings; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [offsets, setOffsets] = useState<number[]>(settings.offsets);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toggle = (o: number) => setOffsets((cur) => (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]));

  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        startTransition(async () => {
          const r = await saveReminderSettings({ enabled, offsets, send_hour: Number(f.send_hour), subject: f.subject, body: f.body });
          if (r.ok) { setErrors({}); toast.success(enabled ? "Automatic payment reminders are ON" : "Settings saved. Automatic reminders are off."); router.refresh(); }
          else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
        });
      }}
    >
      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={enabled} disabled={!canEdit || pending} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <span className="block text-sm font-semibold">Send payment reminders automatically</span>
          <span className="block text-xs text-muted">When on, the server emails the client on the days ticked below, with the invoice PDF attached. Each reminder is sent once, and reminders stop as soon as the invoice is paid in full or cancelled. Off by default.</span>
        </span>
      </label>
      <div>
        <p className="mb-2 text-[13px] font-medium">Remind the client</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {REMINDER_OFFSETS.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={offsets.includes(o)} disabled={!canEdit || pending} onChange={() => toggle(o)} />
              {offsetLabel(o)}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">For a one-off reminder on any other date and time, use Send reminder on an invoice and choose Schedule.</p>
      </div>
      <Field label="Send at (India time)" className="max-w-[12rem]">
        {(p) => (
          <Select {...p} name="send_hour" defaultValue={String(settings.send_hour)} disabled={!canEdit || pending}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </Select>
        )}
      </Field>
      <Field label="Email subject" required error={errors.subject}>{(p) => <Input {...p} name="subject" defaultValue={settings.subject} maxLength={200} disabled={!canEdit || pending} />}</Field>
      <Field label="Email message" required error={errors.body} hint="Placeholders: {{client_name}} {{invoice_number}} {{project_name}} {{project_clause}} {{pending_amount}} {{due_date}}">
        {(p) => <Textarea {...p} name="body" rows={12} defaultValue={settings.body} maxLength={5000} disabled={!canEdit || pending} />}
      </Field>
      {canEdit
        ? <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save reminder settings</Button></div>
        : <p className="text-xs text-muted">Only an administrator or the accounts / management team can change these settings.</p>}
    </form>
  );
}
