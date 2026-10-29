import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Mail, MessageCircle, Phone } from "lucide-react";
import { FollowUpActions } from "@/components/followups/followup-actions";
import { LeadActions } from "@/components/leads/lead-actions";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, DetailList, EmptyState, PageHeader } from "@/components/ui/layout";
import { getSettings, requireMember } from "@/lib/auth";
import { FOLLOW_UP_TYPE_LABELS, LEAD_SOURCE_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/constants";
import { getLead, getLeadActivities, getLeadFollowUps } from "@/lib/data/leads";
import { defaultFollowUpLocal, formatDate, formatDateTime, isoToIstLocal } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const lead = await getLead(supabase, id);
  if (!lead) notFound();
  const [activities, followUps, settings] = await Promise.all([
    getLeadActivities(supabase, id), getLeadFollowUps(supabase, id), getSettings(),
  ]);
  const pending = followUps.filter((f) => f.status === "pending");
  const history = followUps.filter((f) => f.status !== "pending");
  const now = new Date();

  return (
    <>
      <PageHeader
        title={lead.title}
        breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: formatLeadNumber(lead.lead_number) }]}
        description={[lead.company_name, lead.contact_name].filter(Boolean).join(" · ") || undefined}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={lead.status} />
        <PriorityBadge priority={lead.priority} />
        {lead.archived_at && <Badge tone="neutral">Archived {formatDate(lead.archived_at)}</Badge>}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Link href={`/quotations/new?lead=${lead.id}`} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-muted">+ Quotation</Link>
          <Link href={`/proposals/new?lead=${lead.id}`} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-muted">+ Proposal</Link>
          <Link href={`/invoices/new?lead=${lead.id}`} className="inline-flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-muted">+ Invoice</Link>
        </div>
        <div className="w-full sm:w-auto">
          <LeadActions
            lead={{ id: lead.id, title: lead.title, status: lead.status, archived: !!lead.archived_at, contactName: lead.contact_name }}
            followUpDefaults={{
              due: defaultFollowUpLocal(settings.default_follow_up_days, settings.default_follow_up_time),
              type: settings.default_follow_up_type,
            }}
          />
        </div>
      </div>

      {lead.status === "lost" && lead.lost_reason && (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
          <span className="font-medium text-danger">Lost reason: </span>{lead.lost_reason}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Contact & company" />
            <div className="p-5">
              <DetailList
                items={[
                  { label: "Company", value: lead.company_id ? <Link href={`/companies/${lead.company_id}`} className="font-medium hover:text-accent hover:underline">{lead.company_name}</Link> : null },
                  { label: "Website", value: lead.company_website ? <a href={lead.company_website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{lead.company_website}</a> : null },
                  { label: "Contact person", value: lead.contact_id ? <Link href={`/contacts/${lead.contact_id}`} className="font-medium hover:text-accent hover:underline">{lead.contact_name}</Link> : null },
                  { label: "Designation", value: lead.contact_designation },
                  { label: "Email", value: lead.contact_email ? <a href={`mailto:${lead.contact_email}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Mail className="h-3.5 w-3.5" aria-hidden />{lead.contact_email}</a> : null },
                  { label: "Phone", value: lead.contact_phone ? <a href={`tel:${lead.contact_phone}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden />{lead.contact_phone}</a> : null },
                  { label: "WhatsApp", value: lead.contact_whatsapp ? <a href={`https://wa.me/${lead.contact_whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{lead.contact_whatsapp}</a> : null },
                  { label: "Assigned owner", value: lead.assigned_name },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Requirements & event" />
            <div className="space-y-5 p-5">
              <DetailList
                items={[
                  { label: "Service category", value: SERVICE_CATEGORY_LABELS[lead.service_category] },
                  { label: "Source", value: LEAD_SOURCE_LABELS[lead.source] },
                  { label: "Event / campaign", value: lead.event_name },
                  { label: "Event date", value: lead.event_date ? formatDate(lead.event_date) : null },
                  { label: "City", value: lead.city },
                  { label: "Venue", value: lead.venue },
                  { label: "Estimated budget", value: lead.budget_inr != null ? formatINR(lead.budget_inr, { exact: true }) : null },
                  { label: "Expected revenue", value: lead.expected_revenue_inr != null ? formatINR(lead.expected_revenue_inr, { exact: true }) : null },
                ]}
              />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes & requirements</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{lead.notes || <span className="text-muted">No notes yet.</span>}</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity history" />
            {activities.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ol className="p-5">
                {activities.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < activities.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden />}
                    <span
                      className={cn(
                        "relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-surface ring-1",
                        a.type === "won" ? "bg-success ring-success" : a.type === "lost" ? "bg-danger ring-danger" : a.type === "note" ? "bg-accent ring-accent" : "bg-muted ring-muted",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn("whitespace-pre-wrap text-sm", a.type === "note" && "rounded-md bg-surface-muted px-3 py-2")}>{a.summary}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatDateTime(a.created_at)}{a.author?.full_name ? ` · ${a.author.full_name}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Next follow-ups" />
            {pending.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No pending follow-ups" description={lead.status === "won" || lead.status === "lost" ? "This lead is closed." : "Schedule one so this lead doesn’t go cold."} />
            ) : (
              <ul className="divide-y divide-border">
                {pending.map((f) => {
                  const overdue = new Date(f.due_at) < now;
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{f.title}</p>
                        <p className={cn("text-xs", overdue ? "font-medium text-danger" : "text-muted")}>
                          {FOLLOW_UP_TYPE_LABELS[f.type]} · {formatDateTime(f.due_at)}{overdue ? " · overdue" : ""}
                        </p>
                        {f.notes && <p className="mt-0.5 truncate text-xs text-muted">{f.notes}</p>}
                      </div>
                      <FollowUpActions id={f.id} title={f.title} dueLocal={isoToIstLocal(f.due_at)} />
                    </li>
                  );
                })}
              </ul>
            )}
            {history.length > 0 && (
              <details className="border-t border-border">
                <summary className="cursor-pointer px-5 py-2.5 text-xs font-medium text-muted hover:text-foreground">Completed / cancelled ({history.length})</summary>
                <ul className="divide-y divide-border">
                  {history.map((f) => (
                    <li key={f.id} className="px-5 py-2.5 text-sm">
                      <span className={cn(f.status === "cancelled" && "text-muted line-through")}>{f.title}</span>
                      <p className="text-xs text-muted">{f.status === "completed" ? `Completed ${formatDateTime(f.completed_at)}` : "Cancelled"}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <div className="p-5">
              <DetailList
                items={[
                  { label: "Created", value: formatDateTime(lead.created_at) },
                  { label: "Last updated", value: formatDateTime(lead.updated_at) },
                  { label: "Last contact", value: lead.last_contact_at ? formatDate(lead.last_contact_at) : null },
                  { label: "Next follow-up", value: lead.next_follow_up_at ? formatDateTime(lead.next_follow_up_at) : null },
                  ...(lead.closed_at ? [{ label: lead.status === "won" ? "Won on" : "Closed on", value: formatDate(lead.closed_at) }] : []),
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
