import { Badge } from "@/components/ui/badge";

type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";
const TONE: Record<string, Tone> = {
  draft: "neutral", sent: "info", accepted: "success", rejected: "danger", expired: "warning", revised: "neutral",
  issued: "info", partially_paid: "warning", paid: "success", overdue: "danger", cancelled: "neutral",
};
const LABEL: Record<string, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected", expired: "Expired", revised: "Revised",
  issued: "Issued", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
};

export const docStatusLabel = (s: string) => LABEL[s] ?? s;
export function DocStatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "neutral"}>{LABEL[status] ?? status}</Badge>;
}
