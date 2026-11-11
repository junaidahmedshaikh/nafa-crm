"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Pause, Pencil, Play, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import {
  approveCampaign, changeCampaignState, deleteCampaign, previewCampaignRecipients, sendNextBatch, sendTestEmail, type RenderedPreview,
} from "@/lib/actions/email";

export function CampaignControls({ id, status, isAdmin, tested, readyRecipients }: { id: string; status: string; isAdmin: boolean; tested: boolean; readyRecipients: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testTo, setTestTo] = useState("");
  const [when, setWhen] = useState("");
  const [previews, setPreviews] = useState<RenderedPreview[] | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);

  // Refresh the numbers while a campaign is active. (This only redraws the page; sending is done by the server-side queue.)
  useEffect(() => {
    if (status !== "sending" && status !== "scheduled") return;
    const t = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(t);
  }, [status, router]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Something went wrong"); });

  return (
    <div className="space-y-4">
      {status === "draft" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/email-marketing/campaigns/${id}/edit`} className="inline-flex h-9 items-center gap-2 rounded-md border border-btn-secondary-border bg-surface px-4 text-sm font-medium hover:bg-secondary-accent/15"><Pencil className="h-4 w-4" aria-hidden />Edit campaign</Link>
            <Button disabled={pending} onClick={() => start(async () => { const r = await previewCampaignRecipients(id, 3); if (r.ok) setPreviews(r.data); else toast.error(r.error); })}><Eye className="h-4 w-4" aria-hidden />Preview random recipients</Button>
            <Button variant="danger-outline" disabled={pending} onClick={() => { if (window.confirm("Delete this draft campaign?")) start(async () => { const r = await deleteCampaign(id); if (r.ok) router.push("/email-marketing/campaigns"); else toast.error(r.error); }); }}><Trash2 className="h-4 w-4" aria-hidden />Delete draft</Button>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 text-sm font-medium">Send a test email {tested && <span className="font-normal text-success">· test sent ✓</span>}</p>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" type="email" placeholder="your@email.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test recipient" />
              <Button disabled={pending || !testTo} onClick={() => run(() => sendTestEmail(id, testTo), "Test email sent")}><Send className="h-4 w-4" aria-hidden />Send test</Button>
            </div>
            <p className="mt-1 text-xs text-muted">A test to an internal address is required before approval.</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 text-sm font-medium">Approve &amp; schedule {isAdmin ? "" : <span className="font-normal text-muted">(administrator only)</span>}</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-muted">Start (IST) — leave empty to start immediately
                <Input className="mt-1" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!isAdmin} />
              </label>
              {!confirmApprove ? (
                <Button variant="primary" disabled={!isAdmin || pending || !tested || readyRecipients === 0} onClick={() => setConfirmApprove(true)}>Approve campaign…</Button>
              ) : (
                <>
                  <span className="text-sm">Send to <strong>{readyRecipients}</strong> recipients{when ? ` from ${when.replace("T", " ")} IST` : " now"}?</span>
                  <Button variant="primary" loading={pending} onClick={() => run(() => approveCampaign(id, when || null), "Campaign approved and queued")}>Yes, approve</Button>
                  <Button onClick={() => setConfirmApprove(false)}>Cancel</Button>
                </>
              )}
            </div>
            {!tested && <p className="mt-2 text-xs text-warning">Send a test email first.</p>}
            <p className="mt-2 text-xs text-muted">Approval queues the emails. They are sent in batches inside the sending window and daily limit — never all at once.</p>
          </div>
        </>
      )}

      {(status === "scheduled" || status === "sending" || status === "paused") && (
        <div className="flex flex-wrap gap-2">
          {status !== "paused" ? <Button disabled={pending} onClick={() => run(() => changeCampaignState(id, "pause"), "Campaign paused")}><Pause className="h-4 w-4" aria-hidden />Pause</Button>
            : <Button variant="primary" disabled={pending || !isAdmin} onClick={() => run(() => changeCampaignState(id, "resume"), "Campaign resumed")}><Play className="h-4 w-4" aria-hidden />Resume</Button>}
          {isAdmin && status !== "paused" && <Button disabled={pending} onClick={() => start(async () => { const r = await sendNextBatch(id); if (r.ok) { toast.success(r.data.skipped ?? `Sent ${r.data.sent}, retry ${r.data.retried}, failed ${r.data.failed}, skipped ${r.data.skippedRecipients}`); router.refresh(); } else toast.error(r.error); })}><Send className="h-4 w-4" aria-hidden />Send next batch now</Button>}
          <Button variant="danger-outline" disabled={pending} onClick={() => { if (window.confirm("Stop this campaign? Unsent emails will be cancelled.")) run(() => changeCampaignState(id, "stop"), "Campaign stopped"); }}><Square className="h-4 w-4" aria-hidden />Stop</Button>
          <Button disabled={pending} onClick={() => { if (window.confirm("Move back to draft to edit? Approval will be cleared.")) run(() => changeCampaignState(id, "edit"), "Moved back to draft"); }}><Pencil className="h-4 w-4" aria-hidden />Edit campaign</Button>
        </div>
      )}
      {status === "stopped" && <Button disabled={pending} onClick={() => run(() => changeCampaignState(id, "edit"), "Moved back to draft")}><Pencil className="h-4 w-4" aria-hidden />Edit as draft</Button>}

      {previews && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Preview of randomly selected recipients</p>
          {previews.length === 0 && <p className="text-sm text-muted">No recipients to preview yet.</p>}
          {previews.map((p) => (
            <div key={p.email} className="rounded-lg border border-border">
              <div className="border-b border-border bg-surface-muted/60 px-4 py-2 text-xs"><span className="text-muted">To:</span> {p.name} &lt;{p.email}&gt; · <span className="text-muted">Subject:</span> {p.subject}{p.missing.length > 0 && <span className="ml-2 text-danger">Missing: {p.missing.join(", ")}</span>}</div>
              <iframe title={`Preview for ${p.name}`} sandbox="" srcDoc={p.html} className="h-72 w-full bg-white" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
