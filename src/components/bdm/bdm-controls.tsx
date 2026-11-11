"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, MessageSquareReply, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { generateBriefingNow, logCommunication, saveBdmSettings } from "@/lib/actions/bdm";

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button loading={pending} onClick={() => start(async () => {
      const r = await generateBriefingNow();
      if (r.ok) { toast.success("Briefing refreshed"); router.refresh(); } else toast.error(r.error);
    })}>
      {!pending && <RefreshCw className="h-4 w-4" aria-hidden />}Refresh briefing
    </Button>
  );
}

/** Lets the team record a client reply / an outgoing message so "replied but not answered" is accurate. */
export function LogCommunication({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const log = (type: "reply_received" | "message_sent") =>
    start(async () => {
      const r = await logCommunication({ leadId, type });
      if (r.ok) { toast.success(type === "reply_received" ? "Reply logged" : "Message logged"); router.refresh(); } else toast.error(r.error);
    });
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => log("reply_received")} title="Record that the client replied"><MessageSquareReply className="h-4 w-4" aria-hidden />Log reply</Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => log("message_sent")} title="Record that you contacted the client"><Send className="h-4 w-4" aria-hidden />Log message sent</Button>
    </>
  );
}

type Settings = { enabled: boolean; briefing_time: string; email_enabled: boolean; email_recipients: string[]; inactive_days: number; proposal_followup_days: number };

export function BdmSettingsForm({ defaults, emailReady, aiReady }: { defaults: Settings; emailReady: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState({ ...defaults, briefing_time: defaults.briefing_time.slice(0, 5), recipients: defaults.email_recipients.join(", ") });
  return (
    <form className="space-y-4 p-5" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await saveBdmSettings({
          enabled: s.enabled, briefing_time: s.briefing_time, email_enabled: s.email_enabled,
          email_recipients: s.recipients.split(/[,\s]+/).filter(Boolean), inactive_days: Number(s.inactive_days), proposal_followup_days: Number(s.proposal_followup_days),
        });
        if (r.ok) { toast.success("Briefing settings saved"); router.refresh(); } else toast.error(r.error);
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Briefing time (IST)" hint="Created once a day, after this time.">{(p) => <Input {...p} type="time" value={s.briefing_time} onChange={(e) => setS({ ...s, briefing_time: e.target.value })} />}</Field>
        <Field label="Inactive after (days)">{(p) => <Input {...p} type="number" min={7} max={365} value={s.inactive_days} onChange={(e) => setS({ ...s, inactive_days: Number(e.target.value) })} />}</Field>
        <Field label="Proposal follow-up after (days)">{(p) => <Input {...p} type="number" min={1} max={60} value={s.proposal_followup_days} onChange={(e) => setS({ ...s, proposal_followup_days: Number(e.target.value) })} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />Generate the daily briefing automatically</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.email_enabled} onChange={(e) => setS({ ...s, email_enabled: e.target.checked })} />E-mail the briefing {!emailReady && <span className="text-xs text-warning">(set RESEND_API_KEY and EMAIL_FROM first)</span>}</label>
      {s.email_enabled && (
        <Field label="E-mail recipients" hint="Comma-separated addresses.">{(p) => <Input {...p} value={s.recipients} onChange={(e) => setS({ ...s, recipients: e.target.value })} />}</Field>
      )}
      <p className="text-xs text-muted">AI: {aiReady ? "Gemini is configured." : "Gemini is not configured (GEMINI_API_KEY) — rule-based results only."} The default schedule runs daily at 08:30 IST (vercel.json).</p>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={pending}>Save</Button></div>
    </form>
  );
}
