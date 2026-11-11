"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { RichEditor } from "@/components/email/rich-editor";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { aiWriteEmail } from "@/lib/actions/email-ai";
import { aiCompareSubjects, aiGenerateFollowUps, saveSequence, saveVariants } from "@/lib/actions/email-engage";

type Step = { delay_days: number; subject: string; body_html: string };
type Version = { subject: string; body_html: string };

export function SequenceEditor({ campaignId, initial, editable }: { campaignId: string; initial: Step[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [steps, setSteps] = useState<Step[]>(initial);
  const [sugg, setSugg] = useState<Step[] | null>(null);
  const upd = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  if (!editable) {
    return steps.length ? (
      <ol className="space-y-2 text-sm">{steps.map((s, i) => <li key={i}><span className="font-medium">Follow-up {i + 1}</span> <span className="text-muted">— {s.delay_days} day(s) after the previous email · {s.subject || "(Re: original subject)"}</span></li>)}</ol>
    ) : <p className="text-sm text-muted">No follow-ups configured.</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Follow-ups go only to people who have not replied, unsubscribed, bounced or been suppressed — checked again before every send. They are part of the campaign you approve.</p>
      {steps.map((s, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm font-medium">Follow-up {i + 1}</p>
            <Field label="Send after (days)">{(p) => <Input {...p} type="number" min={1} max={60} className="w-24" value={s.delay_days} onChange={(e) => upd(i, { delay_days: Number(e.target.value) })} />}</Field>
            <Field label="Subject" className="min-w-[240px] flex-1" hint="Blank = “Re: ” + the original subject">{(p) => <Input {...p} value={s.subject} onChange={(e) => upd(i, { subject: e.target.value })} />}</Field>
            <Button size="sm" variant="danger-outline" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
          </div>
          <RichEditor value={s.body_html} onChange={(h) => upd(i, { body_html: h })} />
        </div>
      ))}
      {sugg && (
        <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-4 text-sm">
          <p className="mb-2 font-medium">AI suggested {sugg.length} follow-ups <span className="font-normal text-muted">— nothing is saved until you apply and save.</span></p>
          {sugg.map((s, i) => <div key={i} className="mb-2"><p className="text-xs text-muted">Day +{s.delay_days} · {s.subject}</p><div className="max-h-32 overflow-y-auto rounded border border-border bg-surface p-2 [&_p]:mb-1" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(s.body_html) }} /></div>)}
          <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => { if (!steps.length || window.confirm("Replace your current follow-ups with these?")) { setSteps(sugg); setSugg(null); } }}>Apply suggestions</Button><Button size="sm" onClick={() => setSugg(null)}>Discard</Button></div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSteps([...steps, { delay_days: steps.length ? 4 : 3, subject: "", body_html: "<p>Hello {{first_name|there}},</p><p></p>" }])} disabled={steps.length >= 6}><Plus className="h-4 w-4" aria-hidden />Add follow-up</Button>
        <Button disabled={pending} onClick={() => start(async () => { const r = await aiGenerateFollowUps(campaignId, [4, 8, 15]); if (r.ok) setSugg(r.data); else toast.error(r.error); })}><Sparkles className="h-4 w-4" aria-hidden />Generate Day 4 / 8 / 15 with AI</Button>
        <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await saveSequence(campaignId, steps); if (r.ok) { toast.success("Follow-ups saved"); router.refresh(); } else toast.error(r.error); })}>Save follow-ups</Button>
      </div>
    </div>
  );
}

export function VariantsEditor({ campaignId, initial, mainSubject, mainBody, editable }: { campaignId: string; initial: Version[]; mainSubject: string; mainBody: string; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vs, setVs] = useState<Version[]>(initial);
  const [review, setReview] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<Version>) => setVs(vs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const label = (i: number) => "BCD"[i];

  if (!editable) {
    return <p className="text-sm text-muted">{vs.length ? `${vs.length + 1} versions (A${vs.map((_, i) => ", " + label(i)).join("")}) — recipients are split evenly.` : "Single version."}</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Version A is the campaign’s own email. Recipients are split evenly at random across all versions. Results appear under Analytics; a winner is only named with enough data.</p>
      {vs.map((v, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-end gap-3"><p className="text-sm font-medium">Version {label(i)}</p><Field label="Subject" className="flex-1">{(p) => <Input {...p} value={v.subject} onChange={(e) => upd(i, { subject: e.target.value })} />}</Field><Button size="sm" variant="danger-outline" onClick={() => setVs(vs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button></div>
          <RichEditor value={v.body_html} onChange={(h) => upd(i, { body_html: h })} />
        </div>
      ))}
      {review && <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface-muted/50 p-4 text-sm"><p className="mb-1 text-xs text-muted">AI writing review (an opinion, not a performance prediction):</p>{review}</div>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={vs.length >= 3 || pending} onClick={() => start(async () => {
          const r = await aiWriteEmail({ instruction: "Write an alternative version of this email with a different angle and subject line, for the same audience and goal.", style: vs.length === 0 ? "short" : "friendly", part: "all", current: { subject: mainSubject, bodyHtml: mainBody } });
          if (r.ok && r.data.bodyHtml) setVs([...vs, { subject: r.data.subject ?? "", body_html: r.data.bodyHtml }]); else if (!r.ok) toast.error(r.error);
        })}><Sparkles className="h-4 w-4" aria-hidden />Add version with AI</Button>
        <Button disabled={vs.length >= 3} onClick={() => setVs([...vs, { subject: "", body_html: "<p>Hello {{first_name|there}},</p><p></p>" }])}><Plus className="h-4 w-4" aria-hidden />Add blank version</Button>
        <Button disabled={pending || vs.length < 1} onClick={() => start(async () => { const r = await aiCompareSubjects([mainSubject, ...vs.map((v) => v.subject)]); if (r.ok) setReview(r.data.review); else toast.error(r.error); })}>Compare subject lines (AI)</Button>
        <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await saveVariants(campaignId, vs); if (r.ok) { toast.success(`Versions saved — ${r.data.recipients} recipients re-split`); router.refresh(); } else toast.error(r.error); })}>Save versions</Button>
      </div>
    </div>
  );
}
