import Link from "next/link";
import { BellRing } from "lucide-react";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { ReminderSettingsForm } from "@/components/scheduled/reminder-settings";
import { AutoReminderToggle, ScheduleEmailButton, ScheduledRowActions } from "@/components/scheduled/schedule-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatINR } from "@/lib/format";
import { STATUS_LABEL, type ScheduleStatus } from "@/lib/scheduled/core";
import { getReminderSettings, listReceivables, listScheduledEmails } from "@/lib/scheduled/repo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Payment Reminders" };
const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = { draft: "neutral", scheduled: "info", sending: "warning", sent: "success", failed: "danger", cancelled: "neutral" };

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-1.5 text-xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

export default async function PaymentRemindersPage() {
  const { supabase, profile } = await requireMember();
  const [{ rows: history }, settings, receivables, finRole] = await Promise.all([
    listScheduledEmails(supabase, { kind: "payment_reminder", limit: 50 }),
    getReminderSettings(supabase),
    listReceivables(supabase),
    supabase.rpc("fin_role"),
  ]);
  const canEdit = profile.role === "admin" || ["accounts", "management"].includes((finRole.data as string | null) ?? "");
  const outstanding = receivables.reduce((a, r) => a + r.balance_due, 0);
  const overdue = receivables.filter((r) => r.payment_status === "overdue");
  const plural = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;

  return (
    <>
      <PageHeader title="Payment Reminders" description="Outstanding invoices, automatic reminder rules, and every reminder that was scheduled, sent, failed or cancelled." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Pending from clients" value={formatINR(outstanding, { exact: true })} hint={plural(receivables.length)} />
        <Stat label="Overdue" value={formatINR(overdue.reduce((a, r) => a + r.balance_due, 0), { exact: true })} hint={plural(overdue.length)} tone={overdue.length > 0 ? "text-danger" : undefined} />
        <Stat label="Automatic reminders" value={settings?.enabled ? "On" : "Off"} tone={settings?.enabled ? "text-success" : "text-muted"}
          hint={settings?.enabled ? `${settings.offsets.length} rule${settings.offsets.length === 1 ? "" : "s"} · ${String(settings.send_hour).padStart(2, "0")}:00 IST` : "Nothing is sent automatically"} />
      </div>

      <Card className="mb-6">
        <CardHeader title="Outstanding invoices" />
        {receivables.length === 0 ? <EmptyState icon={BellRing} title="Nothing outstanding" description="Every issued invoice has been paid in full." /> : (
          <DataTable>
            <thead><tr><Th>Invoice</Th><Th>Client</Th><Th>Project</Th><Th>Due date</Th><Th className="text-right">Pending</Th><Th>Status</Th><Th>Reminders</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.id} className="hover:bg-surface-muted">
                  <Td><Link href={`/invoices/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.number}</Link></Td>
                  <Td>{r.client_company || r.client_name || "—"}</Td>
                  <Td>{r.project_name || "—"}</Td>
                  <Td className={cn("whitespace-nowrap", r.payment_status === "overdue" ? "font-medium text-danger" : "text-muted")}>{r.due_date ? formatDate(r.due_date) : "—"}</Td>
                  <Td className="text-right tabular-nums"><span className="font-semibold">{formatINR(r.balance_due, { exact: true })}</span><p className="text-xs text-muted">of {formatINR(r.grand_total, { exact: true })}</p></Td>
                  <Td><DocStatusBadge status={r.payment_status} /></Td>
                  <Td className="text-xs text-muted">{r.pending_reminders > 0 ? `${r.pending_reminders} scheduled` : "None scheduled"}{r.last_reminder_at && <p>Last sent {formatDate(r.last_reminder_at)}</p>}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-3">
                      <AutoReminderToggle invoiceId={r.id} enabled={r.auto_enabled} />
                      <ScheduleEmailButton type="invoice" id={r.id} kind="payment_reminder" label="Send reminder" size="sm" />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Automatic reminder rules" />
          {settings
            ? <ReminderSettingsForm settings={settings} canEdit={canEdit} />
            : <p className="p-5 text-sm text-muted">Payment reminders are not set up yet. Run <code>supabase/migrations/20261118000001_scheduled_emails_reminders.sql</code> in the Supabase SQL editor.</p>}
        </Card>
        <Card>
          <CardHeader title="Reminder history" action={<Link href="/scheduled-emails?kind=payment_reminder" className="text-xs text-accent hover:underline">View all</Link>} />
          {history.length === 0 ? <EmptyState title="No reminders yet" description="Reminders you send or schedule, and automatic ones, are listed here with their delivery status." /> : (
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {h.related_id ? <Link className="hover:underline" href={`/invoices/${h.related_id}`}>{h.related_label}</Link> : h.related_label}
                      <span className="font-normal text-muted"> · {h.client_name || h.to_email}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {h.status === "sent" ? `Sent ${formatDateTime(h.sent_at)}` : h.scheduled_at ? `Scheduled for ${formatDateTime(h.scheduled_at)}` : "Draft"} · {h.to_email}{h.auto ? " · automatic" : ""}
                    </p>
                    {(h.last_error || h.cancel_reason) && <p className="text-xs text-muted">{h.status === "cancelled" ? h.cancel_reason : h.last_error}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={TONE[h.status] ?? "neutral"}>{STATUS_LABEL[h.status as ScheduleStatus] ?? h.status}</Badge>
                    <ScheduledRowActions status={h.status} row={{ id: h.id, kind: h.kind, related_type: h.related_type, related_id: h.related_id, related_label: h.related_label, to_email: h.to_email, cc_emails: h.cc_emails, subject: h.subject, body: h.body, attach_document: h.attach_document, scheduled_at: h.scheduled_at, timezone: h.timezone }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
