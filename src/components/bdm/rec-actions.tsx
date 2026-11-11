"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ClipboardPlus, Copy, ExternalLink, Mail, MessageCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import {
  assignRecommendation, createTaskFromRecommendation, generateDraft, setRecommendationState, snoozeRecommendation,
} from "@/lib/actions/bdm";

export type RecView = {
  id: string;
  leadId: string | null;
  state: "open" | "done" | "snoozed" | "dismissed";
  hasTask: boolean;
  assignedTo: string | null;
  draftSubject: string | null;
  draftBody: string | null;
  email: string | null;
  phone: string | null; // WhatsApp-capable number, digits only
};

const waLink = (phone: string, text: string) => {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
};

/** Per-recommendation actions. Nothing here sends a message: drafts are shown for review and opened in the user's own mail/WhatsApp. */
export function RecActions({ rec, team, compact }: { rec: RecView; team: { id: string; full_name: string }[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<{ channel: "email" | "whatsapp"; subject: string | null; body: string } | null>(
    rec.draftBody ? { channel: rec.draftSubject ? "email" : "whatsapp", subject: rec.draftSubject, body: rec.draftBody } : null,
  );

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>, ok: string | ((r: T) => string)) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { toast.success(typeof ok === "function" ? ok(res) : ok); router.refresh(); } else toast.error(res.error ?? "Something went wrong");
    });
  }

  function draftFor(channel: "email" | "whatsapp") {
    startTransition(async () => {
      const res = await generateDraft({ id: rec.id, channel });
      if (res.ok) { setDraft({ channel, subject: res.data.subject, body: res.data.body }); router.refresh(); } else toast.error(res.error);
    });
  }

  const done = rec.state === "done";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {done ? (
          <Button size="sm" onClick={() => run(() => setRecommendationState(rec.id, "open"), "Reopened")} disabled={pending}><Undo2 className="h-3.5 w-3.5" aria-hidden />Reopen</Button>
        ) : (
          <Button size="sm" onClick={() => run(() => setRecommendationState(rec.id, "done"), "Marked completed")} disabled={pending}><Check className="h-3.5 w-3.5" aria-hidden />Done</Button>
        )}
        {rec.leadId && !done && (
          <Button size="sm" variant="secondary" disabled={pending || rec.hasTask} title={rec.hasTask ? "A CRM task already exists for this item" : "Create a follow-up task in the CRM"}
            onClick={() => run(() => createTaskFromRecommendation(rec.id), (r) => ("data" in r && (r as { data?: { reused: boolean } }).data?.reused ? "Linked to the existing task for that day" : "CRM task created"))}>
            <ClipboardPlus className="h-3.5 w-3.5" aria-hidden />{rec.hasTask ? "Task created" : "Create task"}
          </Button>
        )}
        {rec.leadId && !done && (
          <>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => draftFor("email")}><Mail className="h-3.5 w-3.5" aria-hidden />Email</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => draftFor("whatsapp")}><MessageCircle className="h-3.5 w-3.5" aria-hidden />WhatsApp</Button>
          </>
        )}
        {rec.leadId && (
          <Link href={`/leads/${rec.leadId}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:text-foreground hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />Open
          </Link>
        )}
      </div>
      {!compact && !done && (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Snooze" className="h-8 w-auto py-0 text-xs" value="" disabled={pending}
            onChange={(e) => { const d = Number(e.target.value); if (d) run(() => snoozeRecommendation(rec.id, d), "Snoozed"); }}>
            <option value="">Schedule for later…</option>
            <option value="1">Tomorrow</option>
            <option value="3">In 3 days</option>
            <option value="7">In a week</option>
          </Select>
          <Select aria-label="Assign to" className="h-8 w-auto py-0 text-xs" value={rec.assignedTo ?? ""} disabled={pending}
            onChange={(e) => run(() => assignRecommendation(rec.id, e.target.value || null), "Assignment saved")}>
            <option value="">Unassigned</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.full_name || "Team member"}</option>)}
          </Select>
        </div>
      )}
      {draft && (
        <div className="rounded-md border border-border bg-surface-muted/50 p-3 text-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted">
            <span>AI draft — review before sending. Nothing has been sent.</span>
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => { navigator.clipboard?.writeText(`${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}`); toast.success("Copied"); }}>
              <Copy className="h-3 w-3" aria-hidden />Copy
            </button>
          </div>
          {draft.subject && <p className="mb-1 font-medium">{draft.subject}</p>}
          <p className="whitespace-pre-wrap">{draft.body}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.channel === "email" && rec.email && (
              <a className="text-xs text-accent hover:underline" href={`mailto:${rec.email}?subject=${encodeURIComponent(draft.subject ?? "")}&body=${encodeURIComponent(draft.body)}`}>Open in your email app</a>
            )}
            {draft.channel === "whatsapp" && rec.phone && (
              <a className="text-xs text-accent hover:underline" href={waLink(rec.phone, draft.body)} target="_blank" rel="noreferrer">Open in WhatsApp</a>
            )}
            {draft.channel === "email" && !rec.email && <span className="text-xs text-muted">No email address on this contact.</span>}
            {draft.channel === "whatsapp" && !rec.phone && <span className="text-xs text-muted">No WhatsApp/phone number on this contact.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
