import Link from "next/link";
import { AlertTriangle, CalendarClock, Sparkles } from "lucide-react";
import { BdmSettingsForm, RefreshButton } from "@/components/bdm/bdm-controls";
import { SalesChat } from "@/components/bdm/chat";
import { RecActions, type RecView } from "@/components/bdm/rec-actions";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { getTeam, requireMember } from "@/lib/auth";
import { generateBriefing, plainSummary } from "@/lib/bdm/briefing";
import { geminiConfigured } from "@/lib/bdm/gemini";
import { loadBdmSettings } from "@/lib/bdm/snapshot";
import type { BriefingData, DealAssessment, LeadRef } from "@/lib/bdm/types";
import { formatDate, formatDateTime, istDayBounds } from "@/lib/datetime";
import { emailConfigured } from "@/lib/documents/email";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "AI Business Development Manager" };
export const dynamic = "force-dynamic";

type Row = {
  id: string; lead_id: string | null; title: string; action: string; reason: string; kind: string; channel: string | null;
  state: RecView["state"]; snoozed_until: string | null; follow_up_id: string | null; assigned_to: string | null;
  draft_subject: string | null; draft_body: string | null; priority: number; suggested_service: string | null;
};

const TIER: Record<DealAssessment["tier"], { label: string; tone: "success" | "info" | "neutral" | "warning" }> = {
  high: { label: "High potential", tone: "success" }, medium: { label: "Medium potential", tone: "info" },
  low: { label: "Low potential", tone: "neutral" }, needs_data: { label: "Needs more data", tone: "warning" },
};

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now)) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", value > 0 && tone === "danger" && "text-danger", value > 0 && tone === "warning" && "text-warning", value > 0 && tone === "success" && "text-success")}>{value}</p>
    </div>
  );
}

const Who = ({ l }: { l: LeadRef }) => (
  <div className="min-w-0">
    <Link href={`/leads/${l.leadId}`} className="font-medium hover:underline">{l.company}</Link>
    <p className="truncate text-xs text-muted">
      {[l.contact, l.industry, l.city].filter(Boolean).join(" · ") || "No contact / industry recorded"}
      {" · "}{formatLeadNumber(l.leadNumber)}
    </p>
  </div>
);

const lastContact = (l: LeadRef) => (l.lastContactAt ? `${formatDate(l.lastContactAt)} (${l.daysSinceContact}d ago)` : "Never contacted");

export default async function AiBdmPage({ searchParams }: PageProps<"/ai-bdm">) {
  const sp = await searchParams;
  const onlyHigh = (Array.isArray(sp.priority) ? sp.priority[0] : sp.priority) === "high";
  const { supabase, profile } = await requireMember();
  const now = new Date();
  const { start } = istDayBounds(now);
  const today = new Date(start.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [settings, team] = await Promise.all([loadBdmSettings(supabase), getTeam()]);

  let { data: briefing } = await supabase.from("bdm_briefings").select("*").eq("briefing_date", today).maybeSingle();
  let catchUpError: string | null = null;
  if (!briefing && settings.enabled) {
    try {
      await generateBriefing(supabase, { trigger: "catchup", now, settings });
      briefing = (await supabase.from("bdm_briefings").select("*").eq("briefing_date", today).maybeSingle()).data;
    } catch (e) {
      console.error("[ai-bdm catch-up]", e);
      catchUpError = "Today's briefing could not be generated automatically. Use “Refresh briefing” to retry.";
    }
  }
  if (!briefing) briefing = (await supabase.from("bdm_briefings").select("*").order("briefing_date", { ascending: false }).limit(1).maybeSingle()).data;

  const jobRuns = profile.role === "admin"
    ? ((await supabase.from("bdm_job_runs").select("job, status, attempts, started_at, error").order("started_at", { ascending: false }).limit(5)).data ?? [])
    : [];

  const settingsCard = profile.role === "admin" && (
    <Card className="mt-6">
      <CardHeader title="Briefing settings (administrator)" />
      <BdmSettingsForm defaults={settings} emailReady={emailConfigured()} aiReady={geminiConfigured()} />
      {jobRuns.length > 0 && (
        <div className="border-t border-border px-5 py-3 text-xs text-muted">
          <p className="mb-1 font-medium text-foreground">Recent runs</p>
          {jobRuns.map((j, i) => (
            <p key={i}>{formatDateTime(j.started_at)} — {j.status}{j.attempts > 1 ? ` (${j.attempts} attempts)` : ""}{j.error ? ` — ${j.error}` : ""}</p>
          ))}
        </div>
      )}
    </Card>
  );

  if (!briefing) {
    return (
      <>
        <PageHeader title="AI Business Development Manager" actions={<RefreshButton />} />
        <Card><EmptyState icon={Sparkles} title="No briefing yet" description={catchUpError ?? "Generate your first briefing to see priorities, prospects and proposals that need attention."} /></Card>
        <Card className="mt-6"><CardHeader title="AI sales assistant" /><SalesChat /></Card>
        {settingsCard}
      </>
    );
  }

  const d = briefing.data as BriefingData;
  const isToday = briefing.briefing_date === today;
  const { data: recRows } = await supabase.from("bdm_recommendations").select("*").eq("for_date", briefing.briefing_date).order("priority", { ascending: false });
  const recs = (recRows ?? []) as Row[];
  const byLead = new Map(recs.filter((r) => r.lead_id).map((r) => [r.lead_id!, r]));
  const leadIds = [...byLead.keys()];
  const { data: contactRows } = leadIds.length
    ? await supabase.from("lead_list").select("id, contact_email, contact_whatsapp, contact_phone_digits").in("id", leadIds)
    : { data: [] };
  const contact = new Map((contactRows ?? []).map((c: { id: string; contact_email: string | null; contact_whatsapp: string | null; contact_phone_digits: string | null }) => [c.id, c]));

  const view = (r: Row): RecView => {
    const c = r.lead_id ? contact.get(r.lead_id) : undefined;
    return {
      id: r.id, leadId: r.lead_id, state: r.state, hasTask: !!r.follow_up_id, assignedTo: r.assigned_to,
      draftSubject: r.draft_subject, draftBody: r.draft_body, email: c?.contact_email ?? null,
      phone: (c?.contact_whatsapp || c?.contact_phone_digits || null)?.replace(/\D/g, "") || null,
    };
  };
  const actions = (leadId: string) => { const r = byLead.get(leadId); return r ? <RecActions rec={view(r)} team={team} compact /> : null; };

  const visible = recs.filter((r) => r.state === "open" || r.state === "done" || (r.state === "snoozed" && r.snoozed_until && r.snoozed_until <= now.toISOString()));
  const plan = visible.slice(0, 10);
  const m = d.metrics;
  const firstName = (profile.full_name || "").split(" ")[0];
  const prospects = d.prospects.filter((p) => !onlyHigh || p.priority === "high");
  const atRisk = d.deals.filter((x) => x.atRisk || x.needsManagement);

  return (
    <>
      <PageHeader
        title="AI Business Development Manager"
        description={`Briefing for ${formatDate(briefing.briefing_date)} · generated ${formatDateTime(briefing.generated_at)} IST`}
        actions={<RefreshButton />}
      />
      {!isToday && <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Showing the latest available briefing ({formatDate(briefing.briefing_date)}). {catchUpError ?? "Today's has not been generated yet."}</p>}

      <Card className="mb-6">
        <div className="p-5">
          <p className="text-lg font-semibold tracking-tight">{greeting(now)}{firstName ? `, ${firstName}` : ""}.</p>
          <p className="mt-2 text-sm leading-relaxed">{briefing.summary ?? plainSummary(d)}</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted">
            <Sparkles className="h-3 w-3" aria-hidden />
            {briefing.ai_status === "ok" ? "Narrative written by Gemini from your CRM data. All figures below come directly from the CRM or from transparent rules." : `AI narrative unavailable (${briefing.ai_status}) — showing a rule-based summary.`}
          </p>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Active leads" value={m.activeLeads} />
        <Tile label="New (7 days)" value={m.newLeads} />
        <Tile label="Hot prospects" value={m.hotProspects} tone="warning" />
        <Tile label="Follow-ups today" value={m.followUpsToday} />
        <Tile label="Overdue" value={m.overdue} tone="danger" />
        <Tile label="Pending proposals" value={m.pendingProposals} />
        <Tile label="High-potential deals" value={m.highPotentialDeals} tone="success" />
        <Tile label="Deals at risk" value={m.dealsAtRisk} tone="danger" />
        <Tile label="Meetings (7 days)" value={m.meetings} />
        <Tile label="Awaiting your reply" value={m.awaitingResponse} tone="danger" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Today’s business development priorities" />
        {plan.length === 0 ? <EmptyState title="Nothing queued" description="No open recommendations for this day." /> : (
          <ol className="divide-y divide-border">
            {plan.map((r, i) => (
              <li key={r.id} className={cn("flex flex-col gap-2 px-5 py-4", r.state === "done" && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-xs font-medium">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", r.state === "done" && "line-through")}>{r.title} <span className="font-normal text-muted">— {r.action}</span></p>
                    <p className="mt-0.5 text-xs text-muted">Why: {r.reason}</p>
                    {r.suggested_service && <p className="mt-0.5 text-xs text-muted">Suggested NAFA service: <span className="text-foreground">{r.suggested_service}</span></p>}
                  </div>
                  {r.assigned_to && <Badge>{team.find((t) => t.id === r.assigned_to)?.full_name || "Assigned"}</Badge>}
                </div>
                <div className="pl-9"><RecActions rec={view(r)} team={team} /></div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader title="Top prospects to contact" action={
          <div className="flex gap-2 text-xs">
            <Link href="/ai-bdm" className={cn("rounded px-2 py-1", !onlyHigh ? "bg-foreground/5 font-medium" : "text-muted hover:text-foreground")}>All</Link>
            <Link href="/ai-bdm?priority=high" className={cn("rounded px-2 py-1", onlyHigh ? "bg-foreground/5 font-medium" : "text-muted hover:text-foreground")}>High priority</Link>
          </div>
        } />
        {prospects.length === 0 ? <EmptyState title="No prospects to show" /> : (
          <ul className="divide-y divide-border">
            {prospects.map((p) => (
              <li key={p.leadId} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Who l={p} />
                  <div className="flex items-center gap-2"><PriorityBadge priority={p.priority} /><StatusBadge status={p.status} /><Badge tone={p.score >= 60 ? "warning" : "neutral"}>Score {p.score}</Badge></div>
                </div>
                <p className="text-sm"><span className="font-medium">{p.nextAction}</span> <span className="text-muted">via {p.channel.replace("_", " ")} · last contact: {lastContact(p)}</span></p>
                <p className="text-xs text-muted">Why: {p.reasons.join("; ") || "Open lead"}</p>
                {p.service && <p className="text-xs text-muted">Suggested service: <span className="text-foreground">{p.service.name}</span> ({p.service.why}){p.segment ? ` · ${p.segment}` : ""}</p>}
                {p.missing.length > 0 && <p className="text-xs text-warning">Missing data: {p.missing.join(", ")}</p>}
                {actions(p.leadId)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Proposal & quotation follow-ups" />
          {d.proposals.length === 0 ? <EmptyState title="No proposals awaiting a decision" /> : (
            <ul className="divide-y divide-border">
              {d.proposals.map((p) => (
                <li key={p.docId} className="space-y-1.5 px-5 py-3">
                  <div className="flex items-start justify-between gap-2"><Who l={p} /><span className="text-sm tabular-nums">{formatINR(p.amount)}</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.expired && <Badge tone="danger">Expired</Badge>}
                    {p.expiringSoon && <Badge tone="warning">Expires in {p.daysToExpiry}d</Badge>}
                    {p.needsFollowUp && <Badge tone="warning">Needs follow-up</Badge>}
                    {p.interestShown && <Badge tone="info">Client replied</Badge>}
                    {p.highConversion && <Badge tone="success">High conversion signals</Badge>}
                    {p.needsNegotiation && <Badge>Negotiation / revised pricing</Badge>}
                  </div>
                  <p className="text-xs text-muted">{p.reasons.join("; ")}</p>
                  <p className="text-sm">{p.nextAction}</p>
                  {actions(p.leadId)}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Deal potential" />
          <p className="border-b border-border px-5 py-2 text-xs text-muted">Estimates from CRM signals — not guaranteed outcomes. “Data confidence” shows how complete the underlying information is.</p>
          {d.deals.length === 0 ? <EmptyState title="No deals in the pipeline" /> : (
            <ul className="divide-y divide-border">
              {d.deals.slice(0, 12).map((x) => (
                <li key={x.leadId} className="space-y-1.5 px-5 py-3">
                  <div className="flex items-start justify-between gap-2"><Who l={x} /><span className="text-sm tabular-nums">{formatINR(x.value)}</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={TIER[x.tier].tone}>{TIER[x.tier].label}{x.score !== null ? ` · ${x.score}` : ""}</Badge>
                    <Badge>Data confidence: {x.dataConfidence}</Badge>
                    {x.atRisk && <Badge tone="danger">At risk</Badge>}
                    {x.needsManagement && <Badge tone="warning">Management attention</Badge>}
                  </div>
                  <p className="text-xs text-muted">Because: {x.reasons.slice(0, 4).join("; ")}</p>
                  {x.riskReasons.length > 0 && <p className="text-xs text-danger">Risks: {x.riskReasons.join("; ")}</p>}
                  {x.missing.length > 0 && <p className="text-xs text-warning">Missing: {x.missing.slice(0, 3).join("; ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {atRisk.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Deals requiring attention" />
          <ul className="divide-y divide-border">
            {atRisk.map((x) => (
              <li key={x.leadId} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-danger" aria-hidden /><div><Who l={x} /><p className="text-xs text-muted">{[...x.riskReasons, ...(x.needsManagement ? ["High-value or in negotiation — worth a management check-in"] : [])].join("; ")}</p></div></div>
                <span className="text-sm tabular-nums">{formatINR(x.value)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming meetings & calls" />
          {d.meetings.length === 0 ? <EmptyState icon={CalendarClock} title="No meetings in the next 7 days" description="Meetings are follow-ups of type “Meeting”." /> : (
            <ul className="divide-y divide-border">{d.meetings.map((x) => <li key={x.followUpId} className="px-5 py-3"><Who l={x} /><p className="text-xs text-muted">{formatDateTime(x.at)} — {x.title}</p></li>)}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Replied — awaiting your response" />
          {d.awaitingResponse.length === 0 ? <EmptyState title="None" description="Replies are tracked when logged on a lead (Log reply)." /> : (
            <ul className="divide-y divide-border">{d.awaitingResponse.map((x) => <li key={x.leadId} className="px-5 py-3"><Who l={x} /><p className="text-xs text-muted">Replied {formatDate(x.repliedAt)}</p>{actions(x.leadId)}</li>)}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Gone quiet / overdue" />
          {d.overdueFollowUps.length + d.inactive.length === 0 ? <EmptyState title="All clear" /> : (
            <ul className="divide-y divide-border">
              {d.overdueFollowUps.slice(0, 6).map((x) => <li key={x.followUpId} className="px-5 py-3"><Who l={x} /><p className="text-xs text-danger">Overdue: {x.title} (due {formatDate(x.dueAt)})</p></li>)}
              {d.inactive.slice(0, 6).map((x) => <li key={x.leadId} className="px-5 py-3"><Who l={x} /><p className="text-xs text-muted">No contact for {x.daysSinceContact ?? "30+"} days</p></li>)}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Industries by open opportunities" />
          <ul className="divide-y divide-border">
            {d.industries.map((i) => <li key={i.industry} className="flex justify-between px-5 py-2.5 text-sm"><span>{i.industry}</span><span className="text-muted tabular-nums">{i.openLeads} lead(s){i.value ? ` · ${formatINR(i.value)}` : ""}</span></li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Data gaps (handled transparently)" />
          {d.dataNotes.length === 0 ? <EmptyState title="No gaps detected" /> : <ul className="space-y-1.5 p-5 text-sm text-muted">{d.dataNotes.map((n) => <li key={n}>• {n}</li>)}</ul>}
        </Card>
      </div>

      <Card>
        <CardHeader title="AI sales assistant" />
        <SalesChat />
      </Card>
      {settingsCard}
    </>
  );
}
