import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { ScheduleEmailButton, ScheduledRowActions } from "@/components/scheduled/schedule-dialog";
import { FilterForm } from "@/components/shared/filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { RELATED_LABEL, RELATED_PATH, SCHEDULE_STATUSES, STATUS_LABEL, type RelatedType, type ScheduleStatus } from "@/lib/scheduled/core";
import { listScheduledEmails } from "@/lib/scheduled/repo";

export const metadata = { title: "Scheduled Emails" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = { draft: "neutral", scheduled: "info", sending: "warning", sent: "success", failed: "danger", cancelled: "neutral" };
const FILTER = SCHEDULE_STATUSES.filter((s) => s !== "sending");

export default async function ScheduledEmailsPage({ searchParams }: PageProps<"/scheduled-emails">) {
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const status = one(sp.status);
  const kind = one(sp.kind);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const { supabase } = await requireMember();
  const { rows, total, pageSize, setupNeeded } = await listScheduledEmails(supabase, { q, status, kind, page });
  const href = (n: number) => `/scheduled-emails?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(kind && { kind }), page: String(n) })}`;
  const filtered = !!(q || status || kind);

  return (
    <>
      <PageHeader
        title="Scheduled Emails"
        description="Follow-ups and payment reminders: drafts, scheduled, sent, failed and cancelled. Scheduled emails are sent by the server, even when nobody has the CRM open."
        actions={<ScheduleEmailButton label="New follow-up email" variant="primary" />}
      />
      {setupNeeded && <p className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Scheduled emails are not set up yet. Run <code>supabase/migrations/20261118000001_scheduled_emails_reminders.sql</code> in the Supabase SQL editor.</p>}
      <Card>
        <FilterForm basePath="/scheduled-emails" className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Input name="q" aria-label="Search" defaultValue={q} placeholder="Search client, email, subject, document…" className="min-w-[14rem] flex-1" />
          <Select name="status" aria-label="Status" defaultValue={status} className="w-40"><option value="">All statuses</option>{FILTER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          <Select name="kind" aria-label="Type" defaultValue={kind} className="w-48"><option value="">All types</option><option value="follow_up">Follow-ups</option><option value="payment_reminder">Payment reminders</option></Select>
          <Button type="submit" variant="primary" size="sm">Apply</Button>
          {filtered && <Link href="/scheduled-emails" className="text-sm text-accent hover:underline">Clear</Link>}
        </FilterForm>
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title={filtered ? "No emails match" : "Nothing scheduled yet"}
            description={filtered ? "Try a different search or filter." : "Schedule a follow-up from a contact, lead, quotation, invoice or project, or start one here."} />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Client</Th><Th>Related to</Th><Th>Subject</Th><Th>Scheduled for</Th><Th>Status</Th><Th>Assigned to</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const t = r.related_type as RelatedType | null;
                  return (
                    <tr key={r.id} className="align-top hover:bg-surface-muted">
                      <Td><p className="font-medium">{r.client_name || "—"}</p><p className="text-xs text-muted break-all">{r.to_email}</p></Td>
                      <Td>{t && r.related_id ? <Link className="hover:text-accent hover:underline" href={`${RELATED_PATH[t]}/${r.related_id}`}>{r.related_label || RELATED_LABEL[t]}</Link> : "—"}
                        <p className="text-xs text-muted">{r.kind === "payment_reminder" ? `Payment reminder${r.auto ? " · automatic" : ""}` : t ? RELATED_LABEL[t] : "General"}</p></Td>
                      <Td className="max-w-[18rem]"><p className="truncate" title={r.subject}>{r.subject}</p>{r.attach_document && <p className="text-xs text-muted">PDF attached</p>}</Td>
                      <Td className="whitespace-nowrap text-muted">{r.status === "sent" ? <>Sent {formatDateTime(r.sent_at)}</> : r.scheduled_at ? formatDateTime(r.scheduled_at) : "—"}</Td>
                      <Td><Badge tone={TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status as ScheduleStatus] ?? r.status}</Badge>
                        {(r.last_error || r.cancel_reason) && <p className="mt-1 max-w-[14rem] text-xs text-muted">{r.status === "cancelled" ? r.cancel_reason : r.last_error}{r.status === "scheduled" && r.next_attempt_at ? ` · retrying ${formatDateTime(r.next_attempt_at)}` : ""}</p>}</Td>
                      <Td>{r.assignee?.full_name ?? (r.auto ? "Automatic" : "—")}</Td>
                      <Td><ScheduledRowActions status={r.status} row={{ id: r.id, kind: r.kind, related_type: r.related_type, related_id: r.related_id, related_label: r.related_label, to_email: r.to_email, cc_emails: r.cc_emails, subject: r.subject, body: r.body, attach_document: r.attach_document, scheduled_at: r.scheduled_at, timezone: r.timezone }} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={pageSize} total={total} hrefFor={href} />
          </>
        )}
      </Card>
    </>
  );
}
