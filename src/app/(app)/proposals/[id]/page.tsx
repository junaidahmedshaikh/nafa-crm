/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { DocStatusBadge } from "@/components/documents/status-badge";
import { ProposalActions } from "@/components/documents/doc-actions";
import { Card, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { missingSections } from "@/lib/documents/build";
import { emailConfigured } from "@/lib/documents/email";
import { getActivity, getDocSettings, getEmails, getProposalFull } from "@/lib/documents/repo";

export const metadata = { title: "Proposal" };

export default async function ProposalDetailPage({ params }: PageProps<"/proposals/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getProposalFull(supabase, id);
  if (!full) notFound();
  const { row } = full;
  const settings = await getDocSettings();
  const [activity, emails] = await Promise.all([getActivity(supabase, "proposal", id), getEmails(supabase, "proposal", id)]);
  const missing =
    row.status === "draft" ? missingSections(full.sections, (i) => full.attachments.filter((a) => a.section_id === full.sections[i].id).length) : [];

  return (
    <>
      <PageHeader
        title={row.number ?? "Draft proposal"}
        breadcrumbs={[{ label: "Proposals", href: "/proposals" }, { label: row.number ?? "Draft" }]}
        description={[row.title, row.client_company || row.client_name].filter(Boolean).join(" · ") || undefined}
      />
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DocStatusBadge status={row.status} />
          {row.revision_of && <Link className="text-xs text-muted underline" href={`/proposals/${row.revision_of}`}>Revision of an earlier proposal</Link>}
        </div>
        {missing.length > 0 && (
          <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Sections still empty (they are left out of the PDF): {missing.join(" · ")}
          </p>
        )}
        <ProposalActions
          id={id} status={row.status}
          email={{ number: row.number, clientEmail: row.client_email ?? "", clientName: row.client_name ?? "", subjectLabel: "Proposal", companyName: settings.company_name, emailEnabled: emailConfigured() }}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Document" action={<span className="text-xs text-muted">Live PDF{row.status !== "draft" ? " · issued snapshot" : " · draft"}</span>} />
          <iframe title="Proposal PDF" src={`/api/documents/proposal/${id}/pdf#toolbar=0&navpanes=0`} className="h-[1100px] w-full bg-surface-muted" />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <div className="p-5">
              <DetailList
                items={[
                  { label: "Date", value: formatDate(row.proposal_date) },
                  { label: "Sections", value: `${full.sections.filter((s) => s.included).length} included` },
                  { label: "Commercial summary", value: { none: "Not included", linked: "Linked to a quotation", manual: "Written manually" }[row.commercial_mode] },
                  { label: "Issued", value: row.issued_at ? formatDateTime(row.issued_at as string) : "Not issued" },
                  { label: "CRM lead", value: row.lead_id ? <Link className="text-accent underline" href={`/leads/${row.lead_id}`}>Open lead</Link> : null },
                  { label: "Linked quotation", value: row.quotation_id ? <Link className="text-accent underline" href={`/quotations/${row.quotation_id}`}>Open quotation</Link> : null },
                ]}
              />
            </div>
          </Card>
          {full.attachments.length > 0 && (
            <Card>
              <CardHeader title={`Attached Images (${full.attachments.length})`} />
              <div className="p-4 grid grid-cols-2 gap-2.5">
                {full.attachments.map((att) => (
                  <div key={att.id} className="group relative overflow-hidden rounded-lg border border-border bg-surface-muted/50 p-2 text-center">
                    {att.data_uri ? (
                      <img src={att.data_uri} alt={att.caption || att.filename} className="h-20 w-full object-cover rounded-md border border-border" />
                    ) : (
                      <div className="h-20 w-full rounded-md bg-surface border border-border flex items-center justify-center text-xs text-muted">Image</div>
                    )}
                    <p className="mt-1.5 truncate text-[11px] font-medium text-foreground">{att.filename}</p>
                    <p className="text-[10px] text-muted">{Math.round(att.size_bytes / 1024)} KB</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
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
              <ul className="divide-y divide-border">
                {emails.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <p className={e.status === "sent" ? "" : "text-danger"}>{e.status === "sent" ? "Sent" : "Failed"} to {e.to_email}</p>
                    <p className="text-xs text-muted">{formatDateTime(e.sent_at)}{e.error ? ` · ${e.error}` : ""}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
