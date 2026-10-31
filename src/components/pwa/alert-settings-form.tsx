"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { saveInstallAlertSettings } from "@/lib/actions/notifications";
import type { AlertSettings } from "@/lib/pwa/repo";

export function AlertSettingsForm({
  settings, people, emailAvailable,
}: {
  settings: AlertSettings;
  people: { id: string; full_name: string; role: string }[];
  emailAvailable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [emailOn, setEmailOn] = useState(settings.email_enabled);
  const [extra, setExtra] = useState<string[]>(settings.extra_recipients);
  const [emails, setEmails] = useState(settings.alert_emails.join(", "));
  const [error, setError] = useState<string>();
  const admins = people.filter((p) => p.role === "admin");
  const others = people.filter((p) => p.role !== "admin");

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const list = emails.split(/[,\s;]+/).map((x) => x.trim()).filter(Boolean);
        startTransition(async () => {
          const r = await saveInstallAlertSettings({ enabled, email_enabled: emailOn, extra_recipients: extra, alert_emails: list });
          if (r.ok) { setError(undefined); toast.success("Notification settings saved"); } else { setError(r.fieldErrors?.alert_emails); toast.error(r.error); }
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span><span className="font-medium">Installation alerts</span><span className="block text-xs text-muted">Show an alert in the notification bell whenever someone installs the app. Installations are still recorded when this is off.</span></span>
      </label>

      <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-50">
        <div>
          <p className="text-[13px] font-medium">Who is notified</p>
          <p className="mb-2 text-xs text-muted">Every active administrator is always notified{admins.length ? ` (${admins.map((a) => a.full_name || "Unnamed").join(", ")})` : ""}. Tick anyone else who should also receive these alerts.</p>
          {others.length === 0 ? <p className="text-xs text-muted">There are no other team members.</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {others.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={extra.includes(p.id)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))} />
                  {p.full_name || "Unnamed"}
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            <span><span className="font-medium">Also send an email</span><span className="block text-xs text-muted">{emailAvailable ? "Sent to the addresses below through your configured email service." : "Email is not configured on the server (RESEND_API_KEY and EMAIL_FROM), so nothing will be sent yet."}</span></span>
          </label>
          {emailOn && (
            <div className="mt-3">
              <Field label="Send alerts to" hint="Separate several addresses with commas" error={error}>{(p) => <Textarea {...p} rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="owner@example.com, ops@example.com" />}</Field>
            </div>
          )}
        </div>
      </fieldset>

      <p className="text-xs text-muted">Push notifications are not available yet; alerts appear in the bell and, optionally, by email.</p>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save preferences</Button></div>
    </form>
  );
}
