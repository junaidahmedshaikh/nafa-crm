"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { cancelCampaign, pauseCampaign, resumeCampaign, sendNextBatch } from "@/lib/actions/whatsapp";

type Props = {
  id: string;
  status: "ready" | "sending" | "paused" | "completed" | "cancelled";
  mode: "dry_run" | "live";
  pausedReason: string | null;
  counts: Record<string, number>;
};

/** Drives a campaign: asks the server for one small batch at a time until nothing is left, it pauses, or you stop. */
export function CampaignRunner({ id, status, mode, pausedReason, counts }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, start] = useTransition();
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.failed ?? 0) + (counts.skipped ?? 0);
  const queued = counts.queued ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const finished = status === "completed" || status === "cancelled";

  async function run() {
    setConfirmStart(false);
    stop.current = false;
    setRunning(true);
    setNote(null);
    try {
      while (!stop.current) {
        const res = await sendNextBatch(id);
        if (!res.ok) { toast.error(res.error); break; }
        router.refresh();
        const r = res.data!;
        if (r.state === "completed") { toast.success("Campaign finished"); break; }
        if (r.state === "paused") { toast.warning(r.message ?? "Campaign paused"); setNote(r.message ?? null); break; }
        if (r.state !== "sent_batch") { setNote(r.message ?? null); break; }
        if (r.sent + r.failed + r.skipped === 0) break; // nothing moved: avoid a tight loop
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  function pause() {
    stop.current = true;
    start(async () => {
      const res = await pauseCampaign(id);
      if (res.ok) { toast.success("Paused. The queue is kept."); router.refresh(); } else toast.error(res.error);
    });
  }
  function resume() {
    start(async () => {
      const res = await resumeCampaign(id);
      if (!res.ok) return void toast.error(res.error);
      router.refresh();
      void run();
    });
  }
  function cancel() {
    stop.current = true;
    start(async () => {
      const res = await cancelCampaign(id);
      setConfirmCancel(false);
      if (res.ok) { toast.success("Campaign cancelled"); router.refresh(); } else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{done} of {total} processed</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Campaign progress">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      {(status === "paused" && (pausedReason || note)) && (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" role="status">{note ?? pausedReason}</p>
      )}
      {running && <p className="mt-3 text-sm text-muted" role="status">Sending in small batches. Keep this page open; you can pause at any time.</p>}
      {!running && status === "sending" && queued > 0 && <p className="mt-3 text-sm text-muted">Sending was interrupted with {queued} still waiting. Continue when you are ready.</p>}

      {!finished && (
        <div className="mt-4 flex flex-wrap gap-2">
          {running ? (
            <Button onClick={pause} loading={pending}><Pause className="h-4 w-4" aria-hidden />Pause</Button>
          ) : status === "paused" ? (
            <Button variant="primary" onClick={resume} loading={pending} disabled={queued === 0}><Play className="h-4 w-4" aria-hidden />Resume sending</Button>
          ) : (
            <Button variant="primary" onClick={() => setConfirmStart(true)} disabled={queued === 0}><Play className="h-4 w-4" aria-hidden />{status === "sending" ? "Continue sending" : "Start sending"}</Button>
          )}
          <Button variant="danger-outline" onClick={() => setConfirmCancel(true)} disabled={running}><XCircle className="h-4 w-4" aria-hidden />Cancel campaign</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmStart} onClose={() => setConfirmStart(false)} onConfirm={run} destructive={mode === "live"}
        title={mode === "live" ? `Send ${queued} real WhatsApp messages?` : `Start the dry run for ${queued} messages?`}
        description={mode === "live"
          ? "These messages go to real people and cannot be recalled. Sending runs in small batches within your daily limit, and stops by itself if WhatsApp reports a problem."
          : "This is a rehearsal. Nothing is sent to anyone; messages are only marked as sent so you can check the flow."}
        confirmLabel={mode === "live" ? "Send now" : "Start dry run"}
      />
      <ConfirmDialog
        open={confirmCancel} onClose={() => setConfirmCancel(false)} onConfirm={cancel} pending={pending}
        title="Cancel this campaign?" description={`The ${queued} messages still waiting will not be sent. Messages already sent stay in the log.`} confirmLabel="Cancel campaign"
      />
    </div>
  );
}
