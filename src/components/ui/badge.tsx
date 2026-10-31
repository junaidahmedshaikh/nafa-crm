import { LEAD_PRIORITY_LABELS, LEAD_STATUS_LABELS, FOLLOW_UP_STATUS_LABELS, type FollowUpStatus, type LeadPriority, type LeadStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-foreground/[0.04] text-foreground/80 border border-border",
  info: "bg-info-soft text-info border border-info/20 font-medium",
  accent: "bg-accent-soft text-accent border border-accent/25 font-medium",
  success: "bg-success-soft text-success border border-success/20 font-medium",
  warning: "bg-warning-soft text-warning border border-warning/20 font-medium",
  danger: "bg-danger-soft text-danger border border-danger/20 font-medium",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<LeadStatus, Tone> = {
  new: "info", contacted: "info", qualified: "accent", brief_received: "accent",
  proposal_in_progress: "warning", proposal_sent: "warning", negotiation: "warning", won: "success", lost: "danger",
};
export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_TONE: Record<LeadPriority, Tone> = { high: "danger", medium: "warning", low: "neutral" };
export function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{LEAD_PRIORITY_LABELS[priority]}</Badge>;
}

const FU_TONE: Record<FollowUpStatus, Tone> = { pending: "warning", completed: "success", cancelled: "neutral" };
export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  return <Badge tone={FU_TONE[status]}>{FOLLOW_UP_STATUS_LABELS[status]}</Badge>;
}
