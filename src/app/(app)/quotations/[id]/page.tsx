import Link from "next/link";
import { notFound } from "next/navigation";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { QuotationActions } from "@/components/documents/doc-actions";
import { Card, CardHeader, DetailList, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { quotationFromRows } from "@/lib/documents/build";
import { emailConfigured } from "@/lib/documents/email";
import { getActivity, getDocSettings, getEmails, getQuotationFull, todayIST } from "@/lib/documents/repo";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Quotation" };

export default async function QuotationDetailPage({ params }: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getQuotationFull(supabase, id);
  if (!full) notFound();
  const { row } = full;
  const settings = await getDocSettings();
  const render = quotationFromRows(row, full.items, full.milestones, settings);
  const today = todayIST();
  const effective = row.status === "sent" && row.valid_until && row.valid_until < today ? "expired" : row.status;
  const [activity, emails, invoices, source] = await Promise.all([
    getActivity(supabase, "quotation", id), getEmails(supabase, "quotation", id),
    supabase.from("invoices").select("id, number, state").eq("quotation_id", id).order("created_at"),
    row.revision_of ? supabase.from("quotations").select("id, number").eq("id", row.revision_of).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const invs = (invoices.data ?? []) as { id: string; number: string | null; state: string }[];
  const live = invs.filter((i) => i.state !== "cancelled").length;

  return (
    <>
      <PageHeader
        title={row.number ?? "Draft quotation"}
        breadcrumbs={[{ label: "Quotations", href: "/quotations" }, { label: row.number ?? "Draft" }]}
        description={[render.client.company || render.client.client_name, render.event.name].filter(Boolean).join(" · ") || undefined}
      />
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DocStatusBadge status={effective} />
          {effective === "expired" && row.status === "sent" && <span className="text-xs text-warning">Valid-until date has passed.</span>}
          {source.data && <span className="text-xs text-muted">Revision of <Link className="underline" href={`/quotations/${(source.data as { id: string }).id}`}>{(source.data as { number: string }).number}</Link></span>}
        </div>
        <QuotationActions
          id={id} status={row.status} effectiveStatus={effective} invoiceCount={live}
          email={{ number: row.number, clientEmail: row.client_email ?? "", clientName: row.client_name ?? "", subjectLabel: "Quotation", companyName: settings.company_name, emailEnabled: emailConfigured() }}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Document" action={<span className="text-xs text-muted">Live PDF{row.status !== "draft" ? " · issued snapshot" : " · draft"}</span>} />
          <iframe title="Quotation PDF" src={`/api/documents/quotation/${id}/pdf#toolbar=0&navpanes=0`} className="h-[1100px] w-full bg-surface-muted" />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <div className="p-5">
              <DetailList items={[
                { label: "Grand total", value: <span className="text-lg font-semibold">{formatINR(render.calc.grand_total, { exact: true })}</span> },
                { label: "Quotation date", value: formatDate(row.quotation_date) },
                { label: "Valid until", value: row.valid_until ? formatDate(row.valid_until) : null },
                { label: "Revision", value: row.revision_of ? "Yes" : "Original" },
                { label: "Issued", value: row.issued_at ? formatDateTime(row.issued_at as string) : "Not issued" },
                { label: "CRM lead", value: row.lead_id ? <Link className="text-accent underline" href={`/leads/${row.lead_id}`}>Open lead</Link> : null },
                { label: "Company", value: row.company_id ? <Link className="text-accent underline" href={`/companies/${row.company_id}`}>{render.client.company || "Open"}</Link> : null },
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Invoices" />
            {invs.length === 0 ? <EmptyState title="No invoice yet" description={row.status === "accepted" ? "Convert this accepted quotation to start invoicing." : "Invoices can be created once the quotation is accepted."} /> : (
              <ul className="divide-y divide-border">{invs.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-3 text-sm"><Link className="font-medium hover:underline" href={`/invoices/${i.id}`}>{i.number ?? "Draft invoice"}</Link><DocStatusBadge status={i.state} /></li>
              ))}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-3 p-5">
              {activity.map((a) => (
                <li key={a.id} className="text-sm"><p>{a.summary}</p><p className="text-xs text-muted">{formatDateTime(a.created_at)}{a.author?.full_name ? ` · ${a.author.full_name}` : ""}</p></li>
              ))}
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
        </div>
      </div>
    </>
  );
}
