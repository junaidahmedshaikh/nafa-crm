import { Badge } from "@/components/ui/badge";
import type { Counts } from "@/lib/email/data";

const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral", scheduled: "info", sending: "warning", paused: "warning", stopped: "danger", completed: "success",
  pending: "neutral", sent: "success", failed: "danger", skipped: "neutral",
};
const LABEL: Record<string, string> = { sending: "In progress", scheduled: "Scheduled" };
export const CampaignStatus = ({ status }: { status: string }) => <Badge tone={TONE[status] ?? "neutral"}>{LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;

export function Progress({ counts }: { counts: Counts }) {
  const done = counts.sent + counts.failed + counts.skipped;
  const pct = counts.total ? Math.round((done / counts.total) * 100) : 0;
  return (
    <div className="min-w-[140px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full bg-success" style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-xs text-muted">{counts.sent} sent · {counts.pending + counts.sending} pending{counts.failed ? ` · ${counts.failed} failed` : ""}</p>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

export const REASON_LABEL: Record<string, string> = {
  invalid: "Invalid email", duplicate: "Duplicate", unsubscribed: "Unsubscribed", bounced: "Bounced", suppressed: "Suppressed",
  missing_field: "Missing personalisation field", stopped: "Campaign stopped", no_email: "No email address",
};
