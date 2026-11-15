import { notFound } from "next/navigation";
import { BriefingView } from "@/components/briefing/briefing-view";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import type { BriefingRow } from "@/lib/briefing/build";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Daily Briefing" };

export default async function BriefingPage({ params }: PageProps<"/briefing/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  if (!isUuid(id)) notFound();
  const { data } = await supabase.from("daily_briefings").select("*").eq("id", id).maybeSingle();   // RLS decides who may read it
  if (!data) notFound();
  const r = data as BriefingRow;
  const status = r.method === "in_app" ? `In-app notification ${r.in_app_status === "sent" ? "sent" : r.in_app_status}` : `Email ${r.email_status.replace("_", " ")}${r.recipient_email ? ` to ${r.recipient_email}` : ""}`;
  return (
    <>
      <PageHeader
        title={`Daily Business Briefing · ${formatDate(r.briefing_date)}`}
        breadcrumbs={[{ label: "Daily Briefing", href: "/briefing" }, { label: formatDate(r.briefing_date) }]}
        description={`Generated ${formatDateTime(r.generated_at)} from CRM records · ${status}${r.ai_status === "ok" ? "" : " · summary written by rule (AI unavailable)"}`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {r.kind === "test" && <Badge>Test briefing</Badge>}
        {r.email_error && <span className="text-xs text-danger">{r.email_error}</span>}
      </div>
      <BriefingView briefing={r.data} summary={r.summary} />
    </>
  );
}
