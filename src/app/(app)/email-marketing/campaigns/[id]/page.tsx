import { notFound } from "next/navigation";
import { SequenceEditor, VariantsEditor } from "@/components/email/sequence-variants";
import { CampaignControls } from "@/components/email/campaign-controls";
import { CampaignStatus, Progress, REASON_LABEL, Stat } from "@/components/email/bits";
import { Card, CardHeader, DataTable, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { isUuid } from "@/lib/actions/util";
import { formatDateTime } from "@/lib/datetime";
import { loadEmailSettings, recipientCounts, emptyCounts } from "@/lib/email/data";

export const metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: PageProps<"/email-marketing/campaigns/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, profile } = await requireMember();
  const { data: c } = await supabase.from("email_campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [counts, settings, tests, skipped, recent, audit, stepsRes, variantsRes] = await Promise.all([
    recipientCounts(supabase, [id]),
    loadEmailSettings(supabase),
    supabase.from("email_audit_log").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("action", "test_sent"),
    supabase.from("email_recipients").select("skip_reason, missing_fields").eq("campaign_id", id).eq("status", "skipped").limit(5000),
    supabase.from("email_recipients").select("email, full_name, status, skip_reason, last_error, sent_at, attempts").eq("campaign_id", id).order("sent_at", { ascending: false, nullsFirst: false }).limit(25),
    supabase.from("email_audit_log").select("action, details, created_at").eq("campaign_id", id).order("created_at", { ascending: false }).limit(8),
    supabase.from("email_sequence_steps").select("step, delay_days, subject, body_html").eq("campaign_id", id).order("step"),
    supabase.from("email_campaign_variants").select("label, subject, body_html").eq("campaign_id", id).order("label"),
  ]);
  const k = counts.get(id) ?? emptyCounts();
  const reasons = new Map<string, number>();
  for (const r of skipped.data ?? []) reasons.set(r.skip_reason ?? "other", (reasons.get(r.skip_reason ?? "other") ?? 0) + 1);
  const stats = ((c.audience ?? {}) as { _stats?: { totalContacts: number; matched: number; excluded: Record<string, number> } })._stats;
  const dailyCap = c.daily_limit ? Math.min(c.daily_limit, settings.daily_limit) : settings.daily_limit;
  const readyRecipients = k.pending + k.sending;

  return (
    <>
      <PageHeader title={c.name} description={c.objective || undefined} breadcrumbs={[{ label: "Campaigns", href: "/email-marketing/campaigns" }, { label: c.name }]} actions={<CampaignStatus status={c.status} />} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Total recipients" value={k.total} />
        <Stat label="Sent" value={k.sent} />
        <Stat label="Pending" value={k.pending + k.sending} />
        <Stat label="Failed" value={k.failed} />
        <Stat label="Excluded" value={k.skipped} />
        <Stat label="Daily capacity" value={dailyCap} note="emails per day" />
      </div>
      {(c.status === "sending" || c.status === "scheduled") && <Card className="mb-6 p-4"><Progress counts={k} /><p className="mt-2 text-xs text-muted">Status: {c.status === "sending" ? "In progress" : `Scheduled for ${formatDateTime(c.scheduled_at)}`}. Sending runs on the server in batches within {settings.window_start.slice(0, 5)}–{settings.window_end.slice(0, 5)} IST.</p></Card>}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recipient review" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-5 text-sm">
            <dt className="text-muted">Contacts in CRM</dt><dd className="tabular-nums">{stats?.totalContacts ?? "—"}</dd>
            <dt className="text-muted">Matching your filters</dt><dd className="tabular-nums">{stats?.matched ?? "—"}</dd>
            <dt className="text-muted">Eligible & ready</dt><dd className="font-medium tabular-nums">{readyRecipients}</dd>
            {Object.entries(stats?.excluded ?? {}).map(([r, n]) => (<><dt key={`${r}l`} className="text-muted">{REASON_LABEL[r] ?? r}</dt><dd key={`${r}v`} className="tabular-nums">{n}</dd></>))}
            {[...reasons].map(([r, n]) => (<><dt key={`${r}sl`} className="text-muted">{REASON_LABEL[r] ?? r} (this campaign)</dt><dd key={`${r}sv`} className="tabular-nums">{n}</dd></>))}
          </dl>
          {reasons.has("missing_field") && <p className="border-t border-border px-5 py-3 text-xs text-warning">Some contacts were excluded because a personalisation field has no value and no fallback. Edit the campaign to add fallbacks.</p>}
        </Card>
        <Card>
          <CardHeader title="Email" />
          <div className="space-y-2 p-5 text-sm">
            <p><span className="text-muted">Subject:</span> {c.subject || "—"}</p>
            <p><span className="text-muted">From:</span> {c.sender_name || settings.sender_name} &lt;{c.sender_email || settings.sender_email || "not set"}&gt;</p>
            <p><span className="text-muted">Reply-to:</span> {c.reply_to || settings.reply_to || "—"}</p>
            <p><span className="text-muted">Postal address in footer:</span> {settings.postal_address || <span className="text-danger">Not set — required</span>}</p>
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Actions" />
        <div className="p-5"><CampaignControls id={id} status={c.status} isAdmin={profile.role === "admin"} tested={(tests.count ?? 0) > 0} readyRecipients={readyRecipients} /></div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Follow-up sequence" />
          <div className="p-5"><SequenceEditor campaignId={id} editable={c.status === "draft"} initial={(stepsRes.data ?? []).map((x) => ({ delay_days: x.delay_days, subject: x.subject, body_html: x.body_html }))} /></div>
        </Card>
        <Card>
          <CardHeader title="Versions (A/B test)" />
          <div className="p-5"><VariantsEditor campaignId={id} editable={c.status === "draft"} mainSubject={c.subject} mainBody={c.body_html} initial={(variantsRes.data ?? []).map((x) => ({ subject: x.subject, body_html: x.body_html }))} /></div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent recipients" />
          <DataTable>
            <thead><tr><Th>Recipient</Th><Th>Status</Th><Th>When</Th></tr></thead>
            <tbody>
              {(recent.data ?? []).map((r) => (
                <tr key={r.email}><Td>{r.full_name}<p className="text-xs text-muted">{r.email}</p></Td><Td>{r.status}{r.skip_reason ? ` · ${REASON_LABEL[r.skip_reason] ?? r.skip_reason}` : ""}{r.last_error && r.status !== "sent" ? <p className="text-xs text-danger">{r.last_error}</p> : null}</Td><Td>{r.sent_at ? formatDateTime(r.sent_at) : "—"}</Td></tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
        <Card>
          <CardHeader title="Audit log" />
          <ul className="divide-y divide-border text-sm">
            {(audit.data ?? []).map((a, i) => <li key={i} className="flex justify-between px-5 py-2"><span>{a.action.replace(/_/g, " ")}</span><span className="text-xs text-muted">{formatDateTime(a.created_at)}</span></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
