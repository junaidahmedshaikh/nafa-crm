import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { buildBriefingData } from "@/lib/bdm/snapshot";
import { emailConfigured, sendEmailWithPdf } from "@/lib/documents/email";
import { profitAndLoss, type SummaryRow } from "@/lib/finance/calc";
import { formatINR } from "@/lib/format";
import { notify } from "@/lib/push";
import { addDays } from "@/lib/scheduled/core";
import { briefingDue, briefingSubject, renderBriefingEmail, type BriefingAction, type BriefingItem, type BriefingSection, type BriefingSettings, type BusinessBriefing } from "./core";

const money = (v: number | string) => formatINR(v, { exact: true });
const lead = (n: number) => `L-${String(n).padStart(4, "0")}`;
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A query that fails (for example a table from a migration that has not been applied) simply contributes nothing. */
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try { const { data, error } = await q; return error || !Array.isArray(data) ? [] : (data as T[]); } catch { return []; }
}

type Inv = { id: string; number: string; client_company: string; client_name: string; project_name: string; due_date: string | null; balance_due: number | string; payment_status: string };
type Pay = { id: string; invoice_id: string; paid_on: string; amount: number | string; invoice_number: string; client_company: string; client_name: string };
type Quo = { id: string; number: string | null; client_company: string; client_name: string; quotation_date: string; valid_until: string | null; grand_total: number | string; issued_at?: string | null };
type Proj = { id: string; name: string; status: string; start_date: string | null; end_date: string | null };
type Payable = { vendor_name: string; expense_id: string; project_id: string; project_name: string; due_date: string | null; outstanding_amount: number | string; payment_status: string };

/** Reads everything the briefing reports, straight from the CRM. Nothing is estimated or invented: an empty source gives an empty section. */
export async function collectBusinessBriefing(supabase: SupabaseClient, now = new Date()): Promise<BusinessBriefing> {
  const { data: d } = await buildBriefingData(supabase, now);
  const today = d.istDate;
  const weekAgo = addDays(today, -7);
  const in7 = addDays(today, 7);
  const in14 = addDays(today, 14);

  const [invoices, payments, quotes, projects, summaries, overBudget, payables, pendingExp, pendingReimb, rateChanges, expiring, emails] = await Promise.all([
    rows<Inv>(supabase.from("invoice_list").select("id, number, client_company, client_name, project_name, due_date, balance_due, payment_status").in("payment_status", ["issued", "partially_paid", "overdue"]).limit(2000)),
    rows<Pay>(supabase.from("payment_list").select("id, invoice_id, paid_on, amount, invoice_number, client_company, client_name").is("voided_at", null).gte("paid_on", weekAgo).order("paid_on", { ascending: false }).limit(50)),
    rows<Quo>(supabase.from("quotation_list").select("id, number, client_company, client_name, quotation_date, valid_until, grand_total, issued_at").eq("effective_status", "sent").order("quotation_date").limit(500)),
    rows<Proj>(supabase.from("projects").select("id, name, status, start_date, end_date").is("deleted_at", null).in("status", ["planning", "confirmed", "in_progress"]).limit(1000)),
    rows<SummaryRow & { project_id: string; name: string; status: string }>(supabase.from("project_finance_summary").select("*").limit(1000)),
    rows<{ project_id: string; category_name: string; budget: number | string; actual: number | string }>(supabase.from("budget_status").select("project_id, category_name, budget, actual").eq("alert", "over").limit(200)),
    rows<Payable>(supabase.from("vendor_payables").select("vendor_name, expense_id, project_id, project_name, due_date, outstanding_amount, payment_status").neq("payment_status", "paid").limit(1000)),
    rows<{ id: string }>(supabase.from("expenses").select("id").eq("approval_status", "submitted").is("deleted_at", null).limit(500)),
    rows<{ id: string }>(supabase.from("reimbursements").select("id").eq("status", "submitted").is("deleted_at", null).limit(500)),
    rows<{ rate_id: string; old_rate: number | string; new_rate: number | string; changed_at: string }>(supabase.from("vendor_rate_history").select("rate_id, old_rate, new_rate, changed_at").gte("changed_at", `${weekAgo}T00:00:00+05:30`).order("changed_at", { ascending: false }).limit(20)),
    rows<{ id: string; vendor_id: string; vendor_name: string; product_name: string; valid_until: string }>(supabase.from("vendor_rate_list").select("id, vendor_id, vendor_name, product_name, valid_until").eq("is_active", true).gte("valid_until", today).lte("valid_until", in14).order("valid_until").limit(20)),
    rows<{ id: string; client_name: string; to_email: string; subject: string; scheduled_at: string; kind: string }>(supabase.from("scheduled_emails").select("id, client_name, to_email, subject, scheduled_at, kind").eq("status", "scheduled").gte("scheduled_at", `${today}T00:00:00+05:30`).lt("scheduled_at", `${addDays(today, 1)}T00:00:00+05:30`).order("scheduled_at").limit(30)),
  ]);
  const rateNames = rateChanges.length
    ? await rows<{ id: string; vendor_id: string; vendor_name: string; product_name: string }>(supabase.from("vendor_rate_list").select("id, vendor_id, vendor_name, product_name").in("id", [...new Set(rateChanges.map((r) => r.rate_id))]))
    : [];
  const rateName = new Map(rateNames.map((r) => [r.id, r]));

  const client = (x: { client_company: string; client_name: string }) => x.client_company || x.client_name || "Client";
  const open = invoices.filter((i) => Number(i.balance_due) > 0.004);
  const overdue = open.filter((i) => i.payment_status === "overdue").sort((a, b) => Number(b.balance_due) - Number(a.balance_due));
  const dueToday = open.filter((i) => i.due_date === today);
  const dueSoon = open.filter((i) => i.due_date && i.due_date > today && i.due_date <= in7).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const outstanding = open.reduce((a, i) => a + Number(i.balance_due), 0);
  const received7 = payments.reduce((a, p) => a + Number(p.amount), 0);
  const payableTotal = payables.reduce((a, p) => a + Number(p.outstanding_amount), 0);
  const payablesUrgent = payables.filter((p) => p.payment_status === "overdue" || (p.due_date && p.due_date <= in7)).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const pl = summaries.map((s) => ({ s, p: profitAndLoss(s) }));
  const weak = pl.filter(({ s, p }) => ["confirmed", "in_progress", "completed"].includes(s.status) && p.revenue_total > 0 && (p.is_loss || (p.profit_margin !== null && p.profit_margin < 10)));
  const upcoming = projects.filter((p) => p.start_date && p.start_date >= today && p.start_date <= in14).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const projectName = new Map(summaries.map((s) => [s.project_id, s.name]));

  const meetingsToday = d.meetings.filter((m) => istDate(m.at) === today);
  const tasksToday = d.followUpsToday.filter((f) => f.type !== "meeting");
  const invItem = (i: Inv, high = false): BriefingItem => ({ title: `${i.number} · ${client(i)}`, detail: `${money(i.balance_due)} pending${i.due_date ? ` · due ${i.due_date}` : ""}${i.project_name ? ` · ${i.project_name}` : ""}`, href: `/invoices/${i.id}`, priority: high ? "high" : "normal" });
  const cut = <T,>(a: T[], n = 5) => a.slice(0, n);

  const sections: BriefingSection[] = [
    { key: "meetings", title: "Today's Meetings & Schedule",
      items: meetingsToday.map((m) => ({ title: `${istTime(m.at)} · ${m.company}`, detail: `${m.title}${m.contact ? ` · with ${m.contact}` : ""}${m.city ? ` · ${m.city}` : ""}`, href: `/leads/${m.leadId}`, priority: "high" as const })),
      note: "Lists meetings recorded as follow-ups on a lead. Vendor and internal meetings, site visits, meeting links and external calendar events are not recorded in the CRM.",
      more: { label: "All follow-ups", href: "/followups" } },
    { key: "tasks", title: "Priority Tasks",
      items: [
        ...cut(d.overdueFollowUps, 5).map((f) => ({ title: `Overdue: ${f.title}`, detail: `${f.company} · was due ${istDate(f.dueAt)}`, href: `/leads/${f.leadId}`, priority: "high" as const })),
        ...cut(tasksToday, 5).map((f) => ({ title: `${istTime(f.dueAt)} · ${f.title}`, detail: `${f.company} · ${f.type.replace("_", " ")}`, href: `/leads/${f.leadId}` })),
        ...(pendingExp.length ? [{ title: `${plural(pendingExp.length, "expense")} waiting for approval`, href: "/projects" }] : []),
        ...(pendingReimb.length ? [{ title: `${plural(pendingReimb.length, "reimbursement")} waiting for approval`, href: "/finance/reimbursements" }] : []),
      ],
      more: d.overdueFollowUps.length + tasksToday.length > 10 ? { label: `All ${d.overdueFollowUps.length + tasksToday.length} tasks`, href: "/followups" } : undefined },
    { key: "followups", title: "Client Follow-ups",
      items: [
        ...cut(d.awaitingResponse, 4).map((r) => ({ title: `Reply waiting: ${r.company}`, detail: `Replied ${istDate(r.repliedAt)}${r.contact ? ` · ${r.contact}` : ""}`, href: `/leads/${r.leadId}`, priority: "high" as const })),
        ...cut(d.proposals.filter((p) => p.needsFollowUp), 4).map((p) => ({ title: `Follow up ${p.docKind} ${p.docNumber ?? ""}: ${p.company}`.replace("  ", " "), detail: `${p.daysSinceSent ?? "?"} days since it was sent${p.amount ? ` · ${money(p.amount)}` : ""}`, href: `/${p.docKind}s/${p.docId}` })),
        ...cut(emails, 4).map((e) => ({ title: `${istTime(e.scheduled_at)} · scheduled ${e.kind === "payment_reminder" ? "payment reminder" : "email"} to ${e.client_name || e.to_email}`, detail: e.subject, href: "/scheduled-emails" })),
      ] },
    { key: "sales", title: "Sales & New Opportunities",
      items: [
        ...cut(d.newLeads, 4).map((l) => ({ title: `New lead ${lead(l.leadNumber)}: ${l.company}`, detail: [l.industry, l.city, l.value ? money(l.value) : ""].filter(Boolean).join(" · ") || undefined, href: `/leads/${l.leadId}` })),
        ...cut(d.prospects, 3).map((p) => ({ title: `High potential: ${p.company}`, detail: p.nextAction, href: `/leads/${p.leadId}` })),
        ...cut(d.deals.filter((x) => x.atRisk), 3).map((x) => ({ title: `Needs attention: ${x.company}`, detail: x.riskReasons.slice(0, 2).join("; "), href: `/leads/${x.leadId}`, priority: "high" as const })),
      ],
      more: { label: "AI BD Manager", href: "/ai-bdm" } },
    { key: "documents", title: "Quotations & Invoices",
      items: [
        ...(quotes.length ? [{ title: `${plural(quotes.length, "quotation")} awaiting client approval`, detail: `Oldest: ${quotes[0].number ?? "draft"} · ${client(quotes[0])} · sent ${quotes[0].quotation_date}`, href: "/quotations?status=sent" }] : []),
        ...cut(quotes.filter((q) => q.issued_at && istDate(q.issued_at) >= weekAgo), 3).map((q) => ({ title: `Recently sent: ${q.number} · ${client(q)}`, detail: `${money(q.grand_total)}${q.valid_until ? ` · valid until ${q.valid_until}` : ""}`, href: `/quotations/${q.id}` })),
        ...dueToday.map((i) => ({ ...invItem(i, true), title: `Due today: ${i.number} · ${client(i)}` })),
        ...cut(dueSoon, 4).map((i) => ({ ...invItem(i), title: `Due ${i.due_date}: ${i.number} · ${client(i)}` })),
      ] },
    { key: "payments", title: "Payment Alerts",
      items: [
        ...cut(overdue, 5).map((i) => ({ ...invItem(i, true), title: `Overdue: ${i.number} · ${client(i)}` })),
        ...cut(payments, 4).map((p) => ({ title: `Received ${money(p.amount)} · ${client(p)}`, detail: `${p.invoice_number} · ${p.paid_on}`, href: `/invoices/${p.invoice_id}` })),
      ],
      more: overdue.length > 5 ? { label: `All ${overdue.length} overdue invoices`, href: "/payment-reminders" } : { label: "Payment reminders", href: "/payment-reminders" } },
    { key: "projects", title: "Project & Event Updates",
      items: [
        ...(projects.length ? [{ title: `${plural(projects.length, "project")} in planning or in progress`, href: "/projects" }] : []),
        ...cut(upcoming, 5).map((p) => ({ title: `Event on ${p.start_date}: ${p.name}`, detail: p.status.replace("_", " "), href: `/projects/${p.id}`, priority: p.start_date! <= in7 ? "high" as const : "normal" as const })),
        ...cut(overBudget, 4).map((b) => ({ title: `Over budget: ${projectName.get(b.project_id) ?? "Project"}`, detail: `${b.category_name}: ${money(b.actual)} spent against ${money(b.budget)}`, href: `/projects/${b.project_id}?tab=budget`, priority: "high" as const })),
      ],
      note: "Milestones, client approvals, staffing and logistics are not tracked as separate records in the CRM." },
    { key: "vendors", title: "Vendor & Procurement Updates",
      items: [
        ...cut(payablesUrgent, 4).map((p) => ({ title: `${p.payment_status === "overdue" ? "Overdue" : "Due"} to ${p.vendor_name}: ${money(p.outstanding_amount)}`, detail: `${p.project_name}${p.due_date ? ` · due ${p.due_date}` : ""}`, href: `/finance/vendors`, priority: p.payment_status === "overdue" ? "high" as const : "normal" as const })),
        ...cut(rateChanges, 4).map((r) => { const n = rateName.get(r.rate_id); return { title: `Rate change: ${n ? `${n.product_name} · ${n.vendor_name}` : "vendor rate"}`, detail: `${money(r.old_rate)} → ${money(r.new_rate)} on ${istDate(r.changed_at)}`, href: n ? `/products-services/vendors/${n.vendor_id}` : "/products-services?view=rates" }; }),
        ...cut(expiring, 3).map((r) => ({ title: `Rate expires ${r.valid_until}: ${r.product_name}`, detail: r.vendor_name, href: `/products-services/vendors/${r.vendor_id}` })),
      ],
      note: "Vendor confirmations and vendor quotations awaiting approval are not recorded in the CRM." },
    { key: "finance", title: "Project Finance Summary",
      items: [
        { title: `Outstanding from clients: ${money(outstanding)}`, detail: `${plural(open.length, "invoice")}, ${overdue.length} overdue`, href: "/payment-reminders", priority: overdue.length ? "high" : "normal" },
        { title: `Received in the last 7 days: ${money(received7)}`, detail: plural(payments.length, "payment"), href: "/payments" },
        { title: `Owed to vendors: ${money(payableTotal)}`, detail: `${plural(payables.length, "unpaid bill")}`, href: "/finance/vendors" },
        ...cut(weak, 4).map(({ s, p }) => ({ title: `${p.is_loss ? "Running at a loss" : "Low margin"}: ${s.name}`, detail: `Revenue ${money(p.revenue_total)}, expenses ${money(p.cost_total)}, margin ${p.profit_margin?.toFixed(1) ?? "—"}%`, href: `/projects/${s.project_id}`, priority: "high" as const })),
      ],
      more: { label: "Finance reports", href: "/finance/reports" } },
  ];

  // The action plan is assembled by rule from the records above, most urgent first. The AI only words the summary.
  const plan: BriefingAction[] = [
    ...cut(meetingsToday, 2).map((m) => ({ title: m.company, action: `Prepare for the ${istTime(m.at)} meeting`, reason: `${m.title} is scheduled today`, href: `/leads/${m.leadId}` })),
    ...cut(d.awaitingResponse, 2).map((r) => ({ title: r.company, action: "Reply to the client", reason: `They replied on ${istDate(r.repliedAt)} and are waiting`, href: `/leads/${r.leadId}` })),
    ...cut(overdue, 2).map((i) => ({ title: `${client(i)} · ${i.number}`, action: "Chase the overdue payment", reason: `${money(i.balance_due)} has been due since ${i.due_date}`, href: `/invoices/${i.id}` })),
    ...dueToday.slice(0, 1).map((i) => ({ title: `${client(i)} · ${i.number}`, action: "Confirm today's payment", reason: `${money(i.balance_due)} is due today`, href: `/invoices/${i.id}` })),
    ...cut(d.overdueFollowUps, 2).map((f) => ({ title: f.company, action: f.title, reason: `This follow-up was due ${istDate(f.dueAt)}`, href: `/leads/${f.leadId}` })),
    ...cut(upcoming.filter((p) => p.start_date! <= in7), 1).map((p) => ({ title: p.name, action: "Check readiness for the event", reason: `The event starts on ${p.start_date}`, href: `/projects/${p.id}` })),
    ...cut(overBudget, 1).map((b) => ({ title: projectName.get(b.project_id) ?? "Project", action: "Review the budget overrun", reason: `${b.category_name} has ${money(b.actual)} spent against ${money(b.budget)}`, href: `/projects/${b.project_id}?tab=budget` })),
    ...d.actionPlan.map((a) => ({ title: a.title, action: a.action, reason: a.reason, href: a.leadId ? `/leads/${a.leadId}` : a.quotationId ? `/quotations/${a.quotationId}` : a.proposalId ? `/proposals/${a.proposalId}` : "/ai-bdm" })),
  ];
  const seen = new Set<string>();
  const actionPlan = plan.filter((p) => { const k = `${p.href}|${p.action}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);

  return {
    date: today, generatedAt: now.toISOString(),
    headline: [
      { label: "Meetings today", value: String(meetingsToday.length) },
      { label: "Tasks due / overdue", value: `${tasksToday.length} / ${d.overdueFollowUps.length}`, tone: d.overdueFollowUps.length ? "bad" : undefined },
      { label: "Overdue invoices", value: overdue.length ? `${overdue.length} · ${money(overdue.reduce((a, i) => a + Number(i.balance_due), 0))}` : "0", tone: overdue.length ? "bad" : "good" },
      { label: "Outstanding", value: money(outstanding) },
    ],
    sections, actionPlan,
  };
}

/** Rule-based summary: used whenever the AI is unavailable, so a briefing never fails for lack of it. */
export function plainBriefingSummary(b: BusinessBriefing): string {
  const count = (k: string) => b.sections.find((s) => s.key === k)?.items.length ?? 0;
  const h = Object.fromEntries(b.headline.map((x) => [x.label, x.value]));
  return [
    `Good morning. ${h["Meetings today"] === "0" ? "No meetings are recorded for today." : `You have ${h["Meetings today"]} meeting(s) today.`}`,
    `Tasks due today / overdue: ${h["Tasks due / overdue"]}. Client follow-ups needing attention: ${count("followups")}.`,
    `Overdue invoices: ${h["Overdue invoices"]}. Total outstanding from clients: ${h["Outstanding"]}.`,
    b.actionPlan.length ? `Start with: ${b.actionPlan.slice(0, 3).map((a) => `${a.title} (${a.action.toLowerCase()})`).join("; ")}.` : "No urgent actions were found in the CRM records.",
  ].join("\n");
}

async function aiBriefingSummary(b: BusinessBriefing): Promise<{ summary: string | null; status: "ok" | "unavailable" | "failed" }> {
  const facts = {
    date: b.date, headline: b.headline,
    sections: b.sections.map((s) => ({ section: s.title, items: s.items.slice(0, 5).map((i) => `${i.title}${i.detail ? ` — ${i.detail}` : ""}`), notRecorded: s.note })),
    actionPlan: b.actionPlan.map((a) => `${a.title}: ${a.action} (${a.reason})`),
  };
  const r = await geminiGenerate({
    system: GROUNDING_RULES,
    prompt: `Write this morning's executive summary for the owner of NAFA Events & Activations. Plain text only, no markdown, at most 130 words.
Line 1: one sentence on how the day looks.
Then "Top priorities:" followed by up to five short numbered lines, chosen ONLY from actionPlan, in that order of urgency.
Then one short line each, only when the data has something to say: meetings to prepare for; payments needing attention; projects at risk.
If a section's items are empty, do not mention it, except meetings: if there are none, say no meetings are recorded for today.
Never add a client, amount, date, meeting or task that is not in the data below.

CRM data:
${JSON.stringify(facts)}`,
    temperature: 0.3,
  });
  if (r.ok && r.text.trim()) return { summary: r.text.trim(), status: "ok" };
  return { summary: null, status: r.ok ? "failed" : r.code === "not_configured" ? "unavailable" : "failed" };
}

export type BriefingRow = {
  id: string; briefing_date: string; kind: "scheduled" | "test"; data: BusinessBriefing; summary: string; ai_status: string; method: string; recipient_email: string;
  email_status: string; email_error: string | null; attempts: number; in_app_status: string; generated_at: string; delivered_at: string | null;
};
const MAX_EMAIL_ATTEMPTS = 3;

/** Sends one stored briefing by its chosen method(s) and records exactly what happened. Safe to repeat: the provider key is per briefing. */
async function deliver(supabase: SupabaseClient, row: BriefingRow): Promise<{ email: string; inApp: string }> {
  const path = `/briefing/${row.id}`;
  const patch: Record<string, unknown> = {};
  let email = row.email_status;
  if (row.method !== "in_app" && email !== "sent") {
    if (!row.recipient_email) { email = "failed"; patch.email_error = "No recipient email address is set."; }
    else if (!emailConfigured()) { email = "not_configured"; patch.email_error = "Email is not configured on this server (RESEND_API_KEY / EMAIL_FROM)."; }
    else {
      const { html, text } = renderBriefingEmail(row.data, row.summary, process.env.NEXT_PUBLIC_APP_URL, path);
      const res = await sendEmailWithPdf({ to: row.recipient_email, subject: `${row.kind === "test" ? "[Test] " : ""}${briefingSubject(row.briefing_date)}`, text, html, idempotencyKey: `briefing-${row.id}` });
      patch.attempts = row.attempts + 1;
      if (res.ok) { email = "sent"; patch.provider_id = res.providerId; patch.email_error = null; }
      // A temporary failure stays "pending" so the next scheduler run retries it; anything else, or too many tries, is final.
      else { email = res.temporary && row.attempts + 1 < MAX_EMAIL_ATTEMPTS ? "pending" : "failed"; patch.email_error = res.error; }
    }
    patch.email_status = email;
  }
  let inApp = row.in_app_status;
  if (row.method !== "email" && inApp !== "sent") {
    try {
      await notify("admins", { type: "bdm_briefing", title: `${row.kind === "test" ? "Test: " : ""}Your daily business briefing is ready`, body: row.summary.split("\n")[0].slice(0, 200), url: path, tag: "daily-briefing", dedupeKey: `daily-briefing:${row.id}` });
      inApp = "sent";
    } catch { inApp = "failed"; }
    patch.in_app_status = inApp;
  }
  if (email === "sent" || (row.method === "in_app" && inApp === "sent")) patch.delivered_at = new Date().toISOString();
  if (Object.keys(patch).length) await supabase.from("daily_briefings").update(patch).eq("id", row.id);
  return { email, inApp };
}

async function createBriefing(supabase: SupabaseClient, s: BriefingSettings, kind: "scheduled" | "test", date: string | null, now: Date, userId?: string) {
  const data = await collectBusinessBriefing(supabase, now);
  const ai = await aiBriefingSummary(data);
  return supabase.from("daily_briefings").insert({
    briefing_date: date ?? data.date, kind, data, summary: ai.summary ?? plainBriefingSummary(data), ai_status: ai.status, method: s.method, recipient_email: s.recipient_email,
    email_status: s.method === "in_app" ? "not_requested" : "pending", ...(userId ? { created_by: userId } : {}),
  }).select("*").single();
}

export async function loadBriefingSettings(supabase: SupabaseClient): Promise<BriefingSettings | null> {
  const { data } = await supabase.from("daily_briefing_settings").select("enabled, delivery_time, timezone, method, recipient_email, days, custom_days").maybeSingle();
  return data ? ({ ...data, delivery_time: String(data.delivery_time).slice(0, 5) } as BriefingSettings) : null;
}

export type BriefingRun = { ok: true; skipped?: string; briefingId?: string; email?: string; inApp?: string };

/**
 * One scheduler tick (service-role client). Idempotent: the unique index allows one scheduled briefing per day, so a second
 * tick finds it and at most retries an email that failed temporarily. Never sends twice.
 */
export async function runDailyBriefing(supabase: SupabaseClient, now = new Date()): Promise<BriefingRun> {
  const s = await loadBriefingSettings(supabase);
  if (!s) return { ok: true, skipped: "Daily briefing is not set up (migration 20261121000001 not applied)" };
  const due = briefingDue(s, now);
  if (!due.due) return { ok: true, skipped: due.reason };

  const { data: existing } = await supabase.from("daily_briefings").select("*").eq("kind", "scheduled").eq("briefing_date", due.date).maybeSingle();
  if (existing) {
    const row = existing as BriefingRow;
    if (row.email_status !== "pending") return { ok: true, skipped: "Today's briefing was already delivered", briefingId: row.id };
    const r = await deliver(supabase, row);
    return { ok: true, briefingId: row.id, ...r };
  }
  const { data: created, error } = await createBriefing(supabase, s, "scheduled", due.date, now);
  // 23505: another tick created today's briefing a moment ago and is delivering it.
  if (error) { if (error.code === "23505") return { ok: true, skipped: "Today's briefing is being delivered by another run" }; throw new Error(`Could not save the briefing: ${error.message}`); }
  const r = await deliver(supabase, created as BriefingRow);
  return { ok: true, briefingId: (created as BriefingRow).id, ...r };
}

/** "Send Test Briefing": builds a report from live data and delivers it now, without touching the daily schedule. */
export async function runTestBriefing(supabase: SupabaseClient, s: BriefingSettings, userId: string): Promise<{ id: string; email: string; inApp: string; error?: string | null }> {
  const { data: created, error } = await createBriefing(supabase, s, "test", null, new Date(), userId);
  if (error || !created) throw new Error(error?.message ?? "Could not create the test briefing");
  const r = await deliver(supabase, created as BriefingRow);
  const { data: after } = await supabase.from("daily_briefings").select("email_error").eq("id", (created as BriefingRow).id).maybeSingle();
  return { id: (created as BriefingRow).id, ...r, error: after?.email_error as string | null | undefined };
}
