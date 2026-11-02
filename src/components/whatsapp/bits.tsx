import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS, CONSENT_LABELS, TEMPLATE_STATUS_LABELS } from "@/lib/whatsapp/schemas";

const TEMPLATE_TONE = { draft: "neutral", pending: "warning", approved: "success", rejected: "danger" } as const;
export function TemplateStatusBadge({ status }: { status: keyof typeof TEMPLATE_STATUS_LABELS }) {
  return <Badge tone={TEMPLATE_TONE[status]}>{TEMPLATE_STATUS_LABELS[status]}</Badge>;
}

const CAMPAIGN_TONE = { ready: "info", sending: "accent", paused: "warning", completed: "success", cancelled: "neutral" } as const;
export function CampaignStatusBadge({ status }: { status: keyof typeof CAMPAIGN_STATUS_LABELS }) {
  return <Badge tone={CAMPAIGN_TONE[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

const CONSENT_TONE = { unknown: "neutral", opted_in: "success", opted_out: "danger" } as const;
export function ConsentBadge({ value }: { value: keyof typeof CONSENT_LABELS }) {
  return <Badge tone={CONSENT_TONE[value]}>{CONSENT_LABELS[value]}</Badge>;
}

const MSG_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  queued: "neutral", sending: "info", sent: "info", delivered: "success", read: "success", failed: "danger", skipped: "warning",
};
export function MessageStatusBadge({ status }: { status: string }) {
  return <Badge tone={MSG_TONE[status] ?? "neutral"} className="capitalize">{status}</Badge>;
}

export function ModeBadge({ mode }: { mode: "dry_run" | "live" }) {
  return mode === "live" ? <Badge tone="danger">Live</Badge> : <Badge tone="info">Dry run</Badge>;
}

/** A WhatsApp-style chat bubble for previews. */
export function Bubble({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-surface-muted p-3">
      <div className="ml-auto max-w-sm whitespace-pre-wrap rounded-lg rounded-tr-none border border-border bg-surface px-3 py-2 text-sm shadow-xs">{text}</div>
    </div>
  );
}
