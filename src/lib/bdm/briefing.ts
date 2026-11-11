import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { buildBriefingData, type BdmSettingsRow } from "@/lib/bdm/snapshot";
import type { BriefingData } from "@/lib/bdm/types";
import { istDayBounds } from "@/lib/datetime";
import { emailConfigured } from "@/lib/documents/email";
import { sendAlertEmail } from "@/lib/notifications/email";
import { notify } from "@/lib/push";

/** Rule-based one-paragraph summary: used as the fallback whenever Gemini is unavailable. */
export function plainSummary(d: BriefingData): string {
  const m = d.metrics;
  const parts = [
    `${m.activeLeads} active lead${m.activeLeads === 1 ? "" : "s"} (${m.newLeads} new in the last 7 days).`,
    m.followUpsToday || m.overdue ? `${m.followUpsToday} follow-up(s) due today and ${m.overdue} overdue.` : "No follow-ups due today and none overdue.",
    m.awaitingResponse ? `${m.awaitingResponse} client(s) replied and are waiting for you.` : "",
    m.pendingProposals ? `${m.pendingProposals} proposal/quotation(s) awaiting a decision, ${d.proposals.filter((p) => p.needsFollowUp).length} needing follow-up.` : "",
    m.notContacted ? `${m.notContacted} lead(s) have never been contacted.` : "",
    m.dealsAtRisk ? `${m.dealsAtRisk} deal(s) show risk signals.` : "",
    m.meetings ? `${m.meetings} meeting(s) in the next 7 days.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

async function aiSummary(d: BriefingData): Promise<{ summary: string | null; status: "ok" | "unavailable" | "failed"; error: string | null }> {
  const brief = {
    date: d.istDate,
    metrics: d.metrics,
    topProspects: d.prospects.slice(0, 5).map((p) => ({ company: p.company, status: p.status, nextAction: p.nextAction, reasons: p.reasons.slice(0, 2) })),
    proposalsNeedingFollowUp: d.proposals.filter((p) => p.needsFollowUp).slice(0, 5).map((p) => ({ company: p.company, nextAction: p.nextAction, reasons: p.reasons })),
    dealsAtRisk: d.deals.filter((x) => x.atRisk).slice(0, 5).map((x) => ({ company: x.company, risks: x.riskReasons })),
    dataNotes: d.dataNotes,
  };
  const r = await geminiGenerate({
    system: GROUNDING_RULES,
    prompt: `Write today's business development briefing for the owner in 4-6 short sentences of plain text (no markdown, no bullet characters). Lead with the single most important thing to do today, then mention the next 2-3 priorities by company name, and finish with one sentence on data gaps only if dataNotes is non-empty.\n\nCRM data:\n${JSON.stringify(brief)}`,
    temperature: 0.4,
  });
  if (r.ok) return { summary: r.text, status: "ok", error: null };
  return { summary: null, status: r.code === "not_configured" ? "unavailable" : "failed", error: r.error };
}

export function emailText(d: BriefingData, summary: string, appUrl?: string): string {
  const m = d.metrics;
  const lines = [
    `NAFA Business OS — Morning briefing (${d.istDate})`,
    "",
    summary,
    "",
    `Active leads: ${m.activeLeads} | New: ${m.newLeads} | Hot prospects: ${m.hotProspects}`,
    `Follow-ups due today: ${m.followUpsToday} | Overdue: ${m.overdue}`,
    `Pending proposals: ${m.pendingProposals} | High-potential deals: ${m.highPotentialDeals} | Deals at risk: ${m.dealsAtRisk}`,
    `Meetings (next 7 days): ${m.meetings}`,
    "",
    "Today's priorities:",
    ...d.actionPlan.map((a, i) => `${i + 1}. ${a.title} — ${a.action} (${a.reason})`),
    "",
    "Scores and tiers are estimates from CRM data, not guarantees. Nothing has been sent to any client.",
    appUrl ? `Open the dashboard: ${appUrl}/ai-bdm` : "",
  ];
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export type RunOutcome = { ok: boolean; skipped?: string; briefingId?: string; error?: string };

/** Current IST wall-clock minutes since midnight. */
export function istMinutes(now: Date): number {
  const { start } = istDayBounds(now);
  return Math.floor((now.getTime() - start.getTime()) / 60000);
}
export const timeToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Builds today's briefing and stores it together with its recommendations. Idempotent per IST day:
 *  - scheduled/catch-up runs skip when today's briefing exists (or it is before the configured time);
 *  - a manual run regenerates the briefing but never duplicates recommendations or resets their state.
 * `supabase` is the service-role client for the cron job or a signed-in user's client for manual runs.
 */
export async function generateBriefing(
  supabase: SupabaseClient,
  opts: { trigger: "cron" | "manual" | "catchup"; now?: Date; settings?: BdmSettingsRow; userId?: string | null },
): Promise<RunOutcome> {
  const now = opts.now ?? new Date();
  const { data, settings } = await buildBriefingData(supabase, now);
  const cfg = opts.settings ?? settings;

  if (opts.trigger !== "manual") {
    if (!cfg.enabled) return { ok: true, skipped: "Daily briefing is disabled" };
    if (istMinutes(now) < timeToMinutes(cfg.briefing_time)) return { ok: true, skipped: "Before the configured briefing time" };
    const { data: existing } = await supabase.from("bdm_briefings").select("id").eq("briefing_date", data.istDate).maybeSingle();
    if (existing) return { ok: true, skipped: "Today's briefing already exists", briefingId: existing.id };
  }

  const ai = await aiSummary(data);
  const summary = ai.summary ?? plainSummary(data);

  const { data: row, error } = await supabase
    .from("bdm_briefings")
    .upsert(
      {
        briefing_date: data.istDate, generated_at: now.toISOString(), trigger: opts.trigger, data, summary: ai.summary,
        ai_status: ai.status, ai_error: ai.error, email_status: "not_requested", ...(opts.userId ? { created_by: opts.userId } : {}),
      },
      { onConflict: "briefing_date" },
    )
    .select("id")
    .single();
  if (error || !row) throw new Error(`Could not save the briefing: ${error?.message}`);

  // Recommendations: one per (lead, day). Existing rows (and their done/snoozed state) are left untouched.
  if (data.recommendations.length) {
    const { error: recErr } = await supabase.from("bdm_recommendations").upsert(
      data.recommendations.map((p) => ({
        for_date: data.istDate, dedupe_key: p.dedupeKey, kind: p.kind, lead_id: p.leadId, quotation_id: p.quotationId, proposal_id: p.proposalId,
        title: p.title, action: p.action, reason: p.reason, channel: p.channel, suggested_service: p.suggestedService, priority: p.priority,
      })),
      { onConflict: "dedupe_key,for_date", ignoreDuplicates: true },
    );
    if (recErr) throw new Error(`Could not save recommendations: ${recErr.message}`);
  }

  if (opts.trigger !== "manual" && cfg.email_enabled && cfg.email_recipients.length) {
    let status: "sent" | "failed" | "not_configured" = "not_configured";
    if (emailConfigured()) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      const r = await sendAlertEmail({ to: cfg.email_recipients, subject: `NAFA morning briefing — ${data.istDate}`, text: emailText(data, summary, appUrl) });
      status = r.ok ? "sent" : "failed";
    }
    await supabase.from("bdm_briefings").update({ email_status: status }).eq("id", row.id);
  }
  if (opts.trigger !== "manual") {
    const m = data.metrics;
    await notify("team", {
      type: "bdm_briefing", title: "Your morning briefing is ready",
      body: `${m.followUpsToday} follow-up(s) due today, ${m.overdue} overdue, ${m.awaitingResponse} awaiting your reply, ${m.pendingProposals} proposal(s) pending.`,
      url: "/ai-bdm", tag: "briefing",
    });
  }
  return { ok: true, briefingId: row.id };
}

/** Runs a job with retries and records every attempt outcome in bdm_job_runs (monitoring / error log). */
export async function runLoggedJob(
  supabase: SupabaseClient,
  job: string,
  fn: () => Promise<RunOutcome>,
  attempts = 3,
): Promise<RunOutcome> {
  const { data: run } = await supabase.from("bdm_job_runs").insert({ job }).select("id").single();
  let last: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const out = await fn();
      if (run) await supabase.from("bdm_job_runs").update({ status: out.skipped ? "skipped" : "success", attempts: i, finished_at: new Date().toISOString(), details: out }).eq("id", run.id);
      return out;
    } catch (e) {
      last = e;
      console.error(`[bdm job ${job}] attempt ${i} failed`, e);
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  const msg = (last as Error)?.message ?? "Unknown error";
  if (run) await supabase.from("bdm_job_runs").update({ status: "failed", attempts, finished_at: new Date().toISOString(), error: msg }).eq("id", run.id);
  return { ok: false, error: msg };
}
