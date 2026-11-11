"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RichEditor } from "@/components/email/rich-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/layout";
import { addSuppression, deleteTemplate, duplicateTemplate, removeSuppression, saveEmailSettings, saveTemplate } from "@/lib/actions/email";

type Tpl = { id: string; name: string; category: string; subject: string; body_html: string; is_system: boolean };

export function TemplateManager({ templates, signatureHtml }: { templates: Tpl[]; signatureHtml: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id?: string; name: string; category: string; subject: string; bodyHtml: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); router.refresh(); } else toast.error(r.error ?? "Something went wrong"); });

  if (edit) {
    return (
      <Card>
        <CardHeader title={edit.id ? "Edit template" : "New template"} />
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>{(p) => <Input {...p} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
            <Field label="Category">{(p) => <Input {...p} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />}</Field>
          </div>
          <Field label="Subject">{(p) => <Input {...p} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />}</Field>
          <RichEditor value={edit.bodyHtml} onChange={(h) => setEdit((s) => (s ? { ...s, bodyHtml: h } : s))} signatureHtml={signatureHtml} previewVars={{ first_name: "Priya", company_name: "Sample Events", city: "Mumbai" }} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => saveTemplate({ ...edit }), "Template saved", () => setEdit(null))}>Save template</Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({ name: "", category: "general", subject: "", bodyHtml: "" })}>New template</Button></div>
      <Card>
        <ul className="divide-y divide-border">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0"><p className="font-medium">{t.name} {t.is_system && <span className="ml-1 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted">NAFA</span>}</p><p className="truncate text-xs text-muted">{t.subject}</p></div>
              <div className="flex gap-1">
                {!t.is_system && <Button size="sm" onClick={() => setEdit({ id: t.id, name: t.name, category: t.category, subject: t.subject, bodyHtml: t.body_html })}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button>}
                <Button size="sm" disabled={pending} onClick={() => run(() => duplicateTemplate(t.id), "Template duplicated")}><Copy className="h-3.5 w-3.5" aria-hidden />Duplicate</Button>
                {!t.is_system && <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { if (window.confirm(`Delete “${t.name}”?`)) run(() => deleteTemplate(t.id), "Template deleted"); }}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function SuppressionControls({ id, isAdmin }: { id?: string; isAdmin?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  if (id) {
    return isAdmin ? (
      <Button size="sm" disabled={pending} onClick={() => { if (window.confirm("Allow emailing this address again? Only do this if the person has asked to be re-added.")) start(async () => { const r = await removeSuppression(id); if (r.ok) { toast.success("Address re-enabled"); router.refresh(); } else toast.error(r.error); }); }}>Re-enable</Button>
    ) : null;
  }
  return (
    <form className="flex gap-2 p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addSuppression(email); if (r.ok) { toast.success("Added to the do-not-email list"); setEmail(""); router.refresh(); } else toast.error(r.error); }); }}>
      <Input type="email" required placeholder="address to never email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" className="max-w-sm" />
      <Button type="submit" loading={pending}>Add to list</Button>
    </form>
  );
}

type S = { sender_name: string; sender_email: string; reply_to: string; postal_address: string; signature_html: string; daily_limit: number; batch_size: number; window_start: string; window_end: string };
export function EmailSettingsForm({ defaults, canEdit }: { defaults: S; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState({ ...defaults, window_start: defaults.window_start.slice(0, 5), window_end: defaults.window_end.slice(0, 5) });
  const num = (k: "daily_limit" | "batch_size") => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });
  return (
    <form className="space-y-5 p-5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveEmailSettings(s); if (r.ok) { toast.success("Email settings saved"); router.refresh(); } else toast.error(r.error); }); }}>
      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name">{(p) => <Input {...p} value={s.sender_name} onChange={(e) => setS({ ...s, sender_name: e.target.value })} />}</Field>
          <Field label="Sender email" hint="Must belong to a domain verified with your email provider (SPF/DKIM).">{(p) => <Input {...p} type="email" value={s.sender_email} onChange={(e) => setS({ ...s, sender_email: e.target.value })} />}</Field>
          <Field label="Reply-to email" hint="Where replies go. Use a monitored mailbox.">{(p) => <Input {...p} type="email" value={s.reply_to} onChange={(e) => setS({ ...s, reply_to: e.target.value })} />}</Field>
          <Field label="Postal address" required hint="Shown in every email footer. Required before any campaign can be approved.">{(p) => <Textarea {...p} rows={2} value={s.postal_address} onChange={(e) => setS({ ...s, postal_address: e.target.value })} />}</Field>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Default signature</p>
          <RichEditor value={s.signature_html} onChange={(h) => setS((x) => ({ ...x, signature_html: h }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Daily limit" hint="Set to your provider’s real limit.">{(p) => <Input {...p} type="number" min={1} value={s.daily_limit} onChange={num("daily_limit")} />}</Field>
          <Field label="Emails per run" hint="Per queue pass (spreads sending out).">{(p) => <Input {...p} type="number" min={1} max={100} value={s.batch_size} onChange={num("batch_size")} />}</Field>
          <Field label="Window start (IST)">{(p) => <Input {...p} type="time" value={s.window_start} onChange={(e) => setS({ ...s, window_start: e.target.value })} />}</Field>
          <Field label="Window end (IST)">{(p) => <Input {...p} type="time" value={s.window_end} onChange={(e) => setS({ ...s, window_end: e.target.value })} />}</Field>
        </div>
      </fieldset>
      {canEdit ? <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save settings</Button></div> : <p className="text-xs text-muted">Only an administrator can change these settings.</p>}
    </form>
  );
}
