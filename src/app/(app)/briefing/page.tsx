import Link from "next/link";
import { Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import type { BriefingRow } from "@/lib/briefing/build";
import { PAGE_SIZE } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { pageRange } from "@/lib/lead-filters";

export const metadata = { title: "Daily Briefing" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { sent: "success", failed: "danger", pending: "warning", not_configured: "warning", not_requested: "neutral" };
const LABEL: Record<string, string> = { sent: "Sent", failed: "Failed", pending: "Pending", not_configured: "Email not configured", not_requested: "Not requested" };
const METHOD: Record<string, string> = { email: "Email", in_app: "In-app", both: "Email + in-app" };

export default async function BriefingHistoryPage({ searchParams }: PageProps<"/briefing">) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const { supabase } = await requireMember();
  const [from, to] = pageRange(page);
  // RLS: only administrators and the accounts / management team receive rows (the briefing contains financial figures).
  const { data, count, error } = await supabase.from("daily_briefings")
    .select("id, briefing_date, kind, summary, method, recipient_email, email_status, email_error, in_app_status, generated_at, delivered_at", { count: "exact" })
    .order("generated_at", { ascending: false }).range(from, to);
  const rows = (data ?? []) as Omit<BriefingRow, "data" | "ai_status" | "attempts">[];

  return (
    <>
      <PageHeader title="Daily Briefing" description="Every morning report that was generated, with how and whether it was delivered."
        actions={<Link href="/settings/briefing" className="text-sm font-medium text-accent hover:underline">Briefing settings &rarr;</Link>} />
      <Card>
        {error && <p className="border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning">The Daily Business Briefing is not set up yet. Run <code>supabase/migrations/20261121000001_daily_briefing.sql</code> in the Supabase SQL editor.</p>}
        {rows.length === 0 ? <EmptyState icon={Newspaper} title="No briefings yet" description="Enable the Daily Business Briefing in settings, or send a test briefing. The history is visible to administrators and the accounts / management team." /> : (
          <>
            <DataTable>
              <thead><tr><Th>Report date</Th><Th>Generated</Th><Th>Method</Th><Th>Recipient</Th><Th>Email</Th><Th>In-app</Th><Th>Preview</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-surface-muted">
                    <Td><Link href={`/briefing/${r.id}`} className="font-medium hover:text-accent hover:underline">{formatDate(r.briefing_date)}</Link>{r.kind === "test" && <Badge className="ml-2">Test</Badge>}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(r.generated_at)}{r.delivered_at && <p className="text-xs">Delivered {formatDateTime(r.delivered_at)}</p>}</Td>
                    <Td>{METHOD[r.method] ?? r.method}</Td>
                    <Td className="break-all">{r.recipient_email || "—"}</Td>
                    <Td><Badge tone={TONE[r.email_status] ?? "neutral"}>{LABEL[r.email_status] ?? r.email_status}</Badge>{r.email_error && <p className="mt-1 max-w-[14rem] text-xs text-danger">{r.email_error}</p>}</Td>
                    <Td><Badge tone={TONE[r.in_app_status] ?? "neutral"}>{LABEL[r.in_app_status] ?? r.in_app_status}</Badge></Td>
                    <Td className="max-w-[22rem]"><p className="line-clamp-2 text-xs text-muted">{r.summary}</p></Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(n) => `/briefing?page=${n}`} />
          </>
        )}
      </Card>
    </>
  );
}
