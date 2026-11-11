"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, RefreshCw, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { RichEditor } from "@/components/email/rich-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { checkRepliesNow, convertReplyToLead, logManualReply, markReplyHandled, reclassifyReply, sendReplyEmail, setReplyCategory } from "@/lib/actions/email-engage";
import { formatDateTime } from "@/lib/datetime";
import { POSITIVE, REPLY_CATEGORIES, REPLY_LABEL, type ReplyCategory } from "@/lib/email/reply-categories";

export type ReplyView = {
  id: string; fromEmail: string; fromName: string; subject: string; body: string; receivedAt: string; campaign: string | null; campaignId: string | null;
  category: ReplyCategory | null; summary: string | null; suggested: string | null; handled: boolean; leadId: string | null; hasContact: boolean; source: string;
};

export function ReplyToolbar({ gmail }: { gmail: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fromEmail: "", subject: "", body: "" });
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !gmail} title={gmail ? "" : "Gmail monitoring is not configured"} onClick={() => start(async () => { const r = await checkRepliesNow(); if (r.ok) { toast.success(`${r.data.stored} new repl${r.data.stored === 1 ? "y" : "ies"} found`); router.refresh(); } else toast.error(r.error); })}><RefreshCw className="h-4 w-4" aria-hidden />Check mailbox now</Button>
        <Button onClick={() => setOpen(!open)}>Log a reply manually</Button>
      </div>
      {!gmail && <p className="text-xs text-muted">Automatic reply monitoring needs read-only Gmail access (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN). Until then, paste replies in manually.</p>}
      {open && (
        <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await logManualReply(f); if (r.ok) { toast.success("Reply logged and classified"); setF({ fromEmail: "", subject: "", body: "" }); setOpen(false); router.refresh(); } else toast.error(r.error); }); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From email" required>{(p) => <Input {...p} type="email" value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} />}</Field>
            <Field label="Subject">{(p) => <Input {...p} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          </div>
          <Field label="Reply text" required>{(p) => <Textarea {...p} rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          <Button type="submit" variant="primary" loading={pending}>Save reply</Button>
        </form>
      )}
    </div>
  );
}

const tone = (c: ReplyCategory | null) => (!c ? "neutral" : POSITIVE.includes(c) ? "success" : c === "unsubscribe" || c === "not_interested" ? "danger" : "info");

export function ReplyCard({ r }: { r: ReplyView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reply, setReply] = useState(r.suggested ?? "");
  const [subject, setSubject] = useState(r.subject.toLowerCase().startsWith("re:") ? r.subject : `Re: ${r.subject}`.trim());
  const [composing, setComposing] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => { const x = await fn(); if (x.ok) { toast.success(ok); router.refresh(); } else toast.error(x.error ?? "Something went wrong"); });
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-medium">{r.fromName} <span className="font-normal text-muted">&lt;{r.fromEmail}&gt;</span></p><p className="text-xs text-muted">{formatDateTime(r.receivedAt)}{r.campaign && <> · <Link className="hover:underline" href={`/email-marketing/campaigns/${r.campaignId}`}>{r.campaign}</Link></>}</p></div>
        <div className="flex items-center gap-2">
          {r.handled && <Badge tone="success">Handled</Badge>}
          <Badge tone={tone(r.category)}>{r.category ? REPLY_LABEL[r.category] : "Needs review"}</Badge>
          <Select aria-label="Change category" className="h-8 w-auto py-0 text-xs" value="" disabled={pending} onChange={(e) => e.target.value && run(() => setReplyCategory(r.id, e.target.value), "Category updated")}>
            <option value="">Change…</option>{REPLY_CATEGORIES.map((c) => <option key={c} value={c}>{REPLY_LABEL[c]}</option>)}
          </Select>
        </div>
      </div>
      {r.summary && <p className="text-sm"><span className="text-muted">AI summary: </span>{r.summary}</p>}
      <details><summary className="cursor-pointer text-xs text-muted">Show the reply{r.subject ? ` — ${r.subject}` : ""}</summary><p className="mt-2 whitespace-pre-wrap rounded border border-border bg-surface-muted/50 p-3 text-sm">{r.body}</p></details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => reclassifyReply(r.id), "Re-classified")}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Re-run AI</Button>
        {r.leadId ? <Link className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-surface-muted" href={`/leads/${r.leadId}`}>Open lead</Link>
          : <Button size="sm" disabled={pending || !r.hasContact} onClick={() => run(async () => { const x = await convertReplyToLead(r.id); return x; }, "Lead created / linked")}><UserPlus className="h-3.5 w-3.5" aria-hidden />Convert to lead</Button>}
        {r.category !== "unsubscribe" && <Button size="sm" onClick={() => setComposing(!composing)}><Send className="h-3.5 w-3.5" aria-hidden />{r.suggested ? "Review suggested response" : "Write response"}</Button>}
        <Button size="sm" disabled={pending} onClick={() => run(() => markReplyHandled(r.id, !r.handled), r.handled ? "Marked unhandled" : "Marked handled")}><Check className="h-3.5 w-3.5" aria-hidden />{r.handled ? "Reopen" : "Mark handled"}</Button>
      </div>
      {composing && (
        <div className="space-y-3 rounded-lg border border-accent/40 p-4">
          <p className="text-xs text-muted">{r.suggested ? "AI-drafted response — edit it freely. It is sent only when you press Send." : "Write your response."}</p>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          <RichEditor value={reply} onChange={setReply} />
          <div className="flex justify-end gap-2"><Button onClick={() => setComposing(false)}>Cancel</Button><Button variant="primary" loading={pending} onClick={() => { if (window.confirm(`Send this response to ${r.fromEmail}?`)) run(async () => { const x = await sendReplyEmail({ id: r.id, subject, bodyHtml: reply }); if (x.ok) setComposing(false); return x; }, "Response sent"); }}>Send response</Button></div>
        </div>
      )}
    </div>
  );
}
