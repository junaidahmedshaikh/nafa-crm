"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { AudiencePicker, type PickerGroup } from "@/components/email/audience-picker";
import { RichEditor } from "@/components/email/rich-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/layout";
import { aiTransformEmail, aiWriteEmail } from "@/lib/actions/email-ai";
import { saveCampaignDraft, saveTemplate } from "@/lib/actions/email";
import type { AudienceFilters } from "@/lib/email/audience";
import { usedVariables } from "@/lib/email/personalize";
import { WRITING_STYLES, type WritingStyle } from "@/lib/email/styles";
import { cn } from "@/lib/utils";

export type WizardInitial = {
  id?: string; name: string; objective: string; subject: string; bodyHtml: string; style: string; senderName: string; senderEmail: string;
  replyTo: string; salespersonName: string; audience: AudienceFilters; fallbacks: Record<string, string>; dailyLimit: number | null; templateId?: string | null;
};
type Template = { id: string; name: string; category: string; subject: string; body_html: string };
const STEPS = ["Recipients", "Details", "Write", "Preview"];

export function CampaignWizard({ initial, templates, defaults, groups = [] }: { initial: WizardInitial; templates: Template[]; groups?: PickerGroup[]; defaults: { senderName: string; senderEmail: string; replyTo: string; signatureHtml: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [c, setC] = useState(initial);
  const [instruction, setInstruction] = useState(initial.objective);
  const [aiBusy, setAiBusy] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [suggestion, setSuggestion] = useState<{ label: string; subject: string | null; bodyHtml: string | null } | null>(null);
  async function ai<T>(label: string, run: () => Promise<{ ok: true; data: { subject: string | null; bodyHtml: string | null } } | { ok: false; error: string }>) {
    setAiBusy(true);
    const r = await run();
    setAiBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    // Never overwrite silently: if there is existing content, ask first; if the editor is empty, apply directly.
    if (!c.bodyHtml.trim() && !c.subject.trim()) {
      setC((s) => ({ ...s, subject: r.data.subject ?? s.subject, bodyHtml: r.data.bodyHtml ?? s.bodyHtml }));
      toast.success("Draft generated — review and edit it below");
    } else setSuggestion({ label, ...r.data });
    return undefined as T | undefined;
  }
  const write = (part: "all" | "subject" | "intro" | "closing", label: string) =>
    ai(label, () => aiWriteEmail({ instruction: instruction || c.objective || "Introduce NAFA Events & Activations and explore a collaboration.", style: c.style as WritingStyle, part, current: { subject: c.subject, bodyHtml: c.bodyHtml } }));
  const transform = (action: "improve" | "shorter" | "professional" | "persuasive" | "grammar", label: string) =>
    ai(label, () => aiTransformEmail({ action, subject: c.subject, bodyHtml: c.bodyHtml }));

  function loadTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if ((c.bodyHtml.trim() || c.subject.trim()) && !window.confirm("Replace your current subject and body with this template?")) return;
    setC((s) => ({ ...s, subject: t.subject, bodyHtml: t.body_html, templateId: t.id }));
  }
  function saveAsTemplate() {
    const name = window.prompt("Template name");
    if (!name) return;
    start(async () => {
      const r = await saveTemplate({ name, subject: c.subject, bodyHtml: c.bodyHtml, category: "general" });
      if (r.ok) toast.success("Saved to Email Templates"); else toast.error(r.error);
    });
  }
  function save() {
    start(async () => {
      const r = await saveCampaignDraft({ ...c, dailyLimit: c.dailyLimit || null });
      if (r.ok) {
        toast.success(`Draft saved — ${r.data.recipients} recipients ready${r.data.missingFields ? `, ${r.data.missingFields} excluded for missing fields` : ""}`);
        router.push(`/email-marketing/campaigns/${r.data.id}`);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const vars = usedVariables(c.subject, c.bodyHtml).filter((v) => ["first_name", "last_name", "company_name", "designation", "industry", "city", "website"].includes(v));
  const sample = { first_name: "Priya", last_name: "Sharma", full_name: "Priya Sharma", company_name: "Sample Events", city: "Mumbai", industry: "Wedding planning", designation: "Founder", website: "example.com", sender_name: c.senderName || defaults.senderName, salesperson_name: c.salespersonName };
  const canNext = step === 0 ? true : step === 1 ? !!c.name.trim() : step === 2 ? !!c.subject.trim() && !!c.bodyHtml.trim() : true;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-sm", i === step ? "border-btn-primary bg-btn-primary text-btn-primary-foreground" : i < step ? "border-success/40 text-success" : "border-border text-muted")}>
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="text-xs">{i + 1}</span>}{s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && <AudiencePicker value={c.audience} onChange={(audience) => setC((s2) => ({ ...s2, audience }))} groups={groups} />}

      {step === 1 && (
        <Card>
          <CardHeader title="2 · Campaign details" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Campaign name" required>{(p) => <Input {...p} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="Mumbai Wedding Planners — Nov" />}</Field>
            <Field label="Campaign objective">{(p) => <Input {...p} value={c.objective} onChange={(e) => setC({ ...c, objective: e.target.value })} placeholder="Introduce NAFA and book intro calls" />}</Field>
            <Field label="Sender name">{(p) => <Input {...p} value={c.senderName} onChange={(e) => setC({ ...c, senderName: e.target.value })} placeholder={defaults.senderName} />}</Field>
            <Field label="Sender email" hint="Blank = the address in Email Settings. Must be on a domain verified with your email provider.">{(p) => <Input {...p} type="email" value={c.senderEmail} onChange={(e) => setC({ ...c, senderEmail: e.target.value })} placeholder={defaults.senderEmail || "set in Email Settings"} />}</Field>
            <Field label="Reply-to email">{(p) => <Input {...p} type="email" value={c.replyTo} onChange={(e) => setC({ ...c, replyTo: e.target.value })} placeholder={defaults.replyTo || "same as sender"} />}</Field>
            <Field label="Salesperson name" hint="Used for {{salesperson_name}}">{(p) => <Input {...p} value={c.salespersonName} onChange={(e) => setC({ ...c, salespersonName: e.target.value })} />}</Field>
            <Field label="Daily sending limit for this campaign" hint="Optional. The account-wide limit in Email Settings always applies too.">{(p) => <Input {...p} type="number" min={1} value={c.dailyLimit ?? ""} onChange={(e) => setC({ ...c, dailyLimit: Number(e.target.value) || null })} />}</Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-sm text-muted">Write the email yourself below, or let AI draft it for you to edit.</p>
            <Button variant={showAi ? "secondary" : "primary"} onClick={() => setShowAi(!showAi)} aria-expanded={showAi}>
              <Sparkles className="h-4 w-4" aria-hidden />{showAi ? "Hide AI writer" : "Write with AI"}
            </Button>
          </div>
          {showAi && (
          <Card>
              <CardHeader title="3 · Write the email" action={<span className="flex items-center gap-1 text-xs text-muted"><Sparkles className="h-3 w-3" aria-hidden />AI suggestions never replace your text without asking</span>} />
              <div className="space-y-4 p-5">
                <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                  <Field label="Tell the AI what to write">{(p) => <Textarea {...p} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Write an introductory email to wedding planners in Mumbai explaining how NAFA can support their projects with event execution, decoration, fabrication, manpower and logistics." />}</Field>
                  <div className="space-y-3">
                    <Field label="Writing style">{(p) => <Select {...p} value={c.style} onChange={(e) => setC({ ...c, style: e.target.value })}>{Object.entries(WRITING_STYLES).map(([k, v]) => <option key={k} value={k}>{v.split(":")[0]}</option>)}</Select>}</Field>
                    <Field label="Start from a template">{(p) => <Select {...p} value="" onChange={(e) => loadTemplate(e.target.value)}><option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" loading={aiBusy} onClick={() => write("all", "Full email")}><Sparkles className="h-4 w-4" aria-hidden />Generate with AI</Button>
                  <Button disabled={aiBusy} onClick={() => write("subject", "Subject line")}>New subject</Button>
                  <Button disabled={aiBusy} onClick={() => write("intro", "Introduction")}>Rewrite introduction</Button>
                  <Button disabled={aiBusy} onClick={() => write("closing", "Closing")}>Rewrite closing</Button>
                  <Button disabled={aiBusy || !c.bodyHtml} onClick={() => transform("improve", "Improved writing")}>Improve writing</Button>
                  <Button disabled={aiBusy || !c.bodyHtml} onClick={() => transform("shorter", "Shorter version")}>Make shorter</Button>
                  <Button disabled={aiBusy || !c.bodyHtml} onClick={() => transform("professional", "More professional version")}>More professional</Button>
                  <Button disabled={aiBusy || !c.bodyHtml} onClick={() => transform("persuasive", "More persuasive version")}>More persuasive</Button>
                  <Button disabled={aiBusy || !c.bodyHtml} onClick={() => transform("grammar", "Grammar-checked version")}>Check grammar</Button>
                </div>
                {suggestion && (
                  <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
                    <p className="mb-2 text-sm font-medium">AI suggestion: {suggestion.label} <span className="font-normal text-muted">— your current text is unchanged until you apply this.</span></p>
                    {suggestion.subject && <p className="mb-2 text-sm"><span className="text-muted">Subject: </span>{suggestion.subject}</p>}
                    {suggestion.bodyHtml && <div className="max-h-64 overflow-y-auto rounded border border-border bg-surface p-3 text-sm [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:ml-5 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(suggestion.bodyHtml) }} />}
                    <div className="mt-3 flex gap-2">
                      <Button variant="primary" size="sm" onClick={() => { setC((s) => ({ ...s, subject: suggestion.subject ?? s.subject, bodyHtml: suggestion.bodyHtml ?? s.bodyHtml })); setSuggestion(null); }}>Apply suggestion</Button>
                      <Button size="sm" onClick={() => setSuggestion(null)}>Discard</Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Subject and body" action={<Button size="sm" onClick={saveAsTemplate} disabled={!c.subject || !c.bodyHtml}>Save as template</Button>} />
            <div className="space-y-4 p-5">
              <Field label="Subject" required hint="You can use {{company_name}}, {{first_name|there}} …">{(p) => <Input {...p} value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} />}</Field>
              <RichEditor value={c.bodyHtml} onChange={(html) => setC((s) => ({ ...s, bodyHtml: html }))} previewVars={sample} signatureHtml={defaults.signatureHtml} />
              {vars.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Fallback values <span className="font-normal text-muted">— used when a contact has no value. Without a fallback, that contact is excluded; no email is ever sent with a blank or unresolved field.</span></p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {vars.map((v) => (
                      <Field key={v} label={`{{${v}}}`}>{(p) => <Input {...p} value={c.fallbacks[v] ?? ""} onChange={(e) => setC({ ...c, fallbacks: { ...c.fallbacks, [v]: e.target.value } })} placeholder={v === "first_name" ? "there" : v === "company_name" ? "your company" : ""} />}</Field>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {step === 3 && (
        <Card>
          <CardHeader title="4 · Preview" />
          <div className="space-y-3 p-5 text-sm">
            <p><span className="text-muted">Campaign:</span> {c.name || "—"}</p>
            <p><span className="text-muted">Subject:</span> {c.subject || "—"}</p>
            <div className="rounded-lg border border-border bg-white p-5 text-[15px] leading-relaxed text-neutral-800 [&_a]:text-blue-700 [&_a]:underline [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(c.bodyHtml + defaults.signatureHtml).replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, (_m, k: string, fb?: string) => (sample as Record<string, string>)[k] || fb || c.fallbacks[k] || `[${k}]`) }} />
            <p className="text-xs text-muted">Shown with sample values. After saving, the campaign page lets you preview real recipients, send yourself a test, and request approval. Nothing is sent from this wizard.</p>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</Button>
        <div className="flex gap-2">
          {step >= 1 && <Button onClick={save} loading={pending} disabled={!c.name.trim()}>Save draft</Button>}
          {step < STEPS.length - 1 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button> : <Button variant="primary" loading={pending} onClick={save} disabled={!c.name.trim() || !c.subject.trim() || !c.bodyHtml.trim()}>Save &amp; review recipients</Button>}
        </div>
      </div>
    </div>
  );
}
