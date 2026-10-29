import Link from "next/link";
import { notFound } from "next/navigation";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { InvoiceActions, PaymentsTable } from "@/components/documents/doc-actions";
import { Card, CardHeader, DetailList, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { invoiceFromRows } from "@/lib/documents/build";
import { emailConfigured } from "@/lib/documents/email";
import { getActivity, getDocSettings, getEmails, getInvoiceFull, todayIST } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getInvoiceFull(supabase, id);
  if (!full) notFound();
  const { row } = full;
  const settings = await getDocSettings();
  const render = invoiceFromRows(row, full.items, full.received, todayIST(), settings);
  const [activity, emails] = await Promise.all([getActivity(supabase, "invoice", id), getEmails(supabase, "invoice", id)]);

  return (
    <>
      <PageHeader
        title={row.number ?? "Draft invoice"}
        breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: row.number ?? "Draft" }]}
        description={[render.client.company || render.client.client_name, render.project.name].filter(Boolean).join(" · ") || undefined}
      />
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DocStatusBadge status={render.payment_status} />
          {row.state === "cancelled" && <span className="text-xs text-muted">Cancelled: {row.cancel_reason}</span>}
          {row.quotation_id && <span className="text-xs text-muted">From quotation <Link className="underline" href={`/quotations/${row.quotation_id}`}>{row.quotation_number}</Link></span>}
        </div>
        <InvoiceActions
          id={id} state={row.state} balance={render.balance_due}
          email={{ number: row.number, clientEmail: row.client_email ?? "", clientName: row.client_name ?? "", subjectLabel: "Invoice", companyName: settings.company_name, emailEnabled: emailConfigured() }}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Document" action={<span className="text-xs text-muted">Live PDF{row.state !== "draft" ? " · issued snapshot" : " · draft"}</span>} />
          <iframe title="Invoice PDF" src={`/api/documents/invoice/${id}/pdf#toolbar=0&navpanes=0`} className="h-[1100px] w-full bg-surface-muted" />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Payment status" />
            <div className="p-5">
              <DetailList items={[
                { label: "Invoice total", value: <span className="font-semibold">{formatINR(render.calc.grand_total, { exact: true })}</span> },
                { label: "Amount received", value: formatINR(render.amount_received, { exact: true }) },
                { label: "Balance due", value: <span className="text-lg font-semibold">{formatINR(render.balance_due, { exact: true })}</span> },
                { label: "Due date", value: row.due_date ? formatDate(row.due_date) : null },
                { label: "Invoice date", value: formatDate(row.invoice_date) },
                { label: "Issued", value: row.issued_at ? formatDateTime(row.issued_at as string) : "Not issued" },
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Payments" />
            {row.state === "draft" ? <p className="px-5 py-6 text-center text-sm text-muted">Issue the invoice to start recording payments.</p> : <PaymentsTable payments={full.payments} canVoid={row.state === "issued"} />}
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-3 p-5">
              {activity.map((a) => <li key={a.id} className="text-sm"><p>{a.summary}</p><p className="text-xs text-muted">{formatDateTime(a.created_at)}{a.author?.full_name ? ` · ${a.author.full_name}` : ""}</p></li>)}
              {activity.length === 0 && <li className="text-sm text-muted">No activity yet.</li>}
            </ol>
          </Card>
          {emails.length > 0 && (
            <Card>
              <CardHeader title="Emails" />
              <ul className="divide-y divide-border">{emails.map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm"><p className={e.status === "sent" ? "" : "text-danger"}>{e.status === "sent" ? "Sent" : "Failed"} to {e.to_email}</p><p className="text-xs text-muted">{formatDateTime(e.sent_at)}{e.error ? ` · ${e.error}` : ""}</p></li>
              ))}</ul>
            </Card>
          )}
          {emails.length === 0 && row.state === "issued" && <EmptyState title="Not emailed yet" />}
        </div>
      </div>
    </>
  );
}
