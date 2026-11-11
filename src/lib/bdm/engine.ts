import { OPEN_STATUSES, type LeadStatus } from "@/lib/constants";
import { istDayBounds } from "@/lib/datetime";
import { classifySegment, recommendService } from "@/lib/bdm/services";
import type {
  BdmInput, BriefingData, Channel, DealAssessment, DealTier, FollowUpItem, LeadFact, LeadRef, MeetingItem,
  PlanItem, ProposalIntel, ProspectRec,
} from "@/lib/bdm/types";

/**
 * Deterministic analysis of CRM facts. No AI and no randomness here: every score, reason and risk
 * flag is computed from CRM rows and cites the fact it came from. Gemini only turns these results
 * into prose and drafts (see gemini.ts / briefing.ts), so predictions are never presented as facts.
 */

const DAY = 24 * 3600 * 1000;
const PROSPECT_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "brief_received"];
const DEAL_STATUSES: LeadStatus[] = ["qualified", "brief_received", "proposal_in_progress", "proposal_sent", "negotiation"];

export const daysSince = (iso: string | null | undefined, now: Date): number | null =>
  iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : null;

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, "")} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const dealValue = (l: LeadFact) => l.expectedRevenue ?? l.budget ?? null;

function ref(l: LeadFact, now: Date): LeadRef {
  return {
    leadId: l.id,
    leadNumber: l.number,
    company: l.companyName ?? l.title,
    contact: l.contactName,
    industry: l.industry,
    city: l.city,
    status: l.status,
    priority: l.priority,
    assignedName: l.assignedName,
    lastContactAt: l.lastContactAt,
    daysSinceContact: daysSince(l.lastContactAt, now),
    value: dealValue(l),
  };
}

function suggestChannel(l: LeadFact): Channel {
  const email = !!l.contactEmail;
  const wa = !!(l.contactWhatsapp || (l.source === "whatsapp" && l.contactPhone));
  if (l.source === "whatsapp" && wa) return "whatsapp";
  if (l.status === "negotiation" || l.status === "qualified") return l.contactPhone ? "call" : email ? "email" : "general_task";
  if (l.status === "new" && email) return "email";
  if (wa) return "whatsapp";
  if (email) return "email";
  if (l.contactPhone) return "call";
  return "general_task";
}

type Engagement = { replies: number; messages: number; lastReplyAt: string | null; lastMessageAt: string | null; interactions: number };

function engagementByLead(input: BdmInput): Map<string, Engagement> {
  const map = new Map<string, Engagement>();
  const get = (id: string) => {
    let e = map.get(id);
    if (!e) map.set(id, (e = { replies: 0, messages: 0, lastReplyAt: null, lastMessageAt: null, interactions: 0 }));
    return e;
  };
  for (const a of input.activities) {
    const e = get(a.leadId);
    if (a.type === "reply_received") {
      e.replies++; e.interactions++;
      if (!e.lastReplyAt || a.createdAt > e.lastReplyAt) e.lastReplyAt = a.createdAt;
    } else if (a.type === "message_sent") {
      e.messages++; e.interactions++;
      if (!e.lastMessageAt || a.createdAt > e.lastMessageAt) e.lastMessageAt = a.createdAt;
    } else if (a.type === "follow_up_completed") {
      e.interactions++;
    }
  }
  return map;
}

export function analyse(input: BdmInput): BriefingData {
  const { now, settings } = input;
  const { start: dayStart, end: dayEnd } = istDayBounds(now);
  const istDate = new Date(dayStart.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const open = input.leads.filter((l) => OPEN_STATUSES.includes(l.status));
  const eng = engagementByLead(input);
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const dataNotes: string[] = [];

  const wonByCompany = new Map<string, number>();
  for (const l of input.leads) if (l.status === "won" && l.companyId) wonByCompany.set(l.companyId, (wonByCompany.get(l.companyId) ?? 0) + 1);

  // Historical conversion per service category (only trusted with enough closed deals).
  const hist = new Map<string, { won: number; lost: number }>();
  for (const l of input.leads) {
    if (l.status !== "won" && l.status !== "lost") continue;
    const h = hist.get(l.serviceCategory) ?? { won: 0, lost: 0 };
    h[l.status === "won" ? "won" : "lost"]++;
    hist.set(l.serviceCategory, h);
  }

  const pendingByLead = new Map<string, { id: string; type: string; title: string; dueAt: string }[]>();
  for (const f of input.followUps) {
    const arr = pendingByLead.get(f.leadId) ?? [];
    arr.push(f);
    pendingByLead.set(f.leadId, arr);
  }

  // ---- simple lists ---------------------------------------------------------------------------
  const newLeads = open.filter((l) => now.getTime() - new Date(l.createdAt).getTime() <= 7 * DAY)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => ref(l, now));
  const highPriority = open.filter((l) => l.priority === "high").map((l) => ref(l, now));
  const notContactedLeads = open.filter((l) => !l.lastContactAt && l.status !== "won");
  const notContacted = notContactedLeads.map((l) => ref(l, now));

  const fuItem = (f: { id: string; leadId: string; type: string; title: string; dueAt: string }): FollowUpItem | null => {
    const l = leadById.get(f.leadId);
    if (!l || !OPEN_STATUSES.includes(l.status)) return null;
    return { followUpId: f.id, dueAt: f.dueAt, title: f.title, type: f.type, ...ref(l, now) };
  };
  const followUpsToday = input.followUps
    .filter((f) => f.dueAt >= dayStart.toISOString() && f.dueAt < dayEnd.toISOString())
    .map(fuItem).filter((x): x is FollowUpItem => !!x).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdueFollowUps = input.followUps
    .filter((f) => f.dueAt < dayStart.toISOString())
    .map(fuItem).filter((x): x is FollowUpItem => !!x).sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const meetings: MeetingItem[] = input.followUps
    .filter((f) => f.type === "meeting" && f.dueAt >= dayStart.toISOString() && f.dueAt < new Date(dayStart.getTime() + 8 * DAY).toISOString())
    .map((f) => {
      const l = leadById.get(f.leadId);
      return l && OPEN_STATUSES.includes(l.status) ? { followUpId: f.id, at: f.dueAt, title: f.title, ...ref(l, now) } : null;
    })
    .filter((x): x is MeetingItem => !!x).sort((a, b) => a.at.localeCompare(b.at));

  const awaitingResponse = open.flatMap((l) => {
    const e = eng.get(l.id);
    if (!e?.lastReplyAt) return [];
    const lastOut = [e.lastMessageAt, l.lastContactAt].filter(Boolean).sort().pop() ?? null;
    return !lastOut || e.lastReplyAt > lastOut ? [{ ...ref(l, now), repliedAt: e.lastReplyAt }] : [];
  }).sort((a, b) => a.repliedAt.localeCompare(b.repliedAt));
  const awaitingIds = new Set(awaitingResponse.map((a) => a.leadId));

  const inactiveLeads = open.filter((l) => {
    const last = l.lastContactAt ?? l.createdAt;
    const d = daysSince(last, now) ?? 0;
    const hasPending = (pendingByLead.get(l.id) ?? []).length > 0;
    return d >= settings.inactiveDays && !(hasPending && l.nextFollowUpAt && l.nextFollowUpAt > now.toISOString());
  });
  const inactive = inactiveLeads.map((l) => ref(l, now));

  // ---- proposal intelligence ------------------------------------------------------------------
  const proposals: ProposalIntel[] = [];
  const revisedLeads = new Set(input.docs.filter((d) => d.status === "revised" && d.leadId).map((d) => d.leadId!));
  for (const d of input.docs) {
    if (d.status !== "sent" || !d.leadId) continue;
    const l = leadById.get(d.leadId);
    if (!l || !OPEN_STATUSES.includes(l.status)) continue;
    const e = eng.get(l.id);
    const dsSent = daysSince(d.sentAt, now);
    const toExpiry = d.validUntil ? Math.ceil((new Date(`${d.validUntil}T23:59:59+05:30`).getTime() - now.getTime()) / DAY) : null;
    const contactedSince = !!(d.sentAt && l.lastContactAt && l.lastContactAt > d.sentAt);
    const interestShown = !!(e?.lastReplyAt && d.sentAt && e.lastReplyAt > d.sentAt);
    const expired = toExpiry !== null && toExpiry < 0;
    const expiringSoon = toExpiry !== null && toExpiry >= 0 && toExpiry <= 3;
    const needsFollowUp = expired || expiringSoon || (dsSent !== null && dsSent >= settings.proposalFollowupDays && !contactedSince);
    const hadMeeting = input.completedMeetings.some((m) => m.leadId === l.id);
    const highConversion = interestShown && (l.status === "negotiation" || hadMeeting);
    const needsNegotiation = l.status === "negotiation" || revisedLeads.has(l.id) || (interestShown && (dsSent ?? 0) >= 7);
    const reasons: string[] = [];
    if (dsSent !== null) reasons.push(`${d.kind === "quotation" ? "Quotation" : "Proposal"} ${d.number ?? ""} sent ${dsSent} day${dsSent === 1 ? "" : "s"} ago`.replace("  ", " "));
    if (!contactedSince && dsSent !== null) reasons.push("no logged contact since it was sent");
    if (interestShown) reasons.push("client replied after it was sent");
    if (expired) reasons.push(`validity ended ${Math.abs(toExpiry!)} day(s) ago`);
    else if (expiringSoon) reasons.push(`validity ends in ${toExpiry} day(s)`);
    if (hadMeeting) reasons.push("a meeting has been held");
    let nextAction = "Monitor — no action needed yet";
    if (expired) nextAction = "Offer to revalidate or revise the quotation";
    else if (needsNegotiation && interestShown) nextAction = "Discuss pricing / scope and share a revised quotation if needed";
    else if (expiringSoon) nextAction = "Remind the client the quotation expires soon and ask for a decision";
    else if (needsFollowUp) nextAction = "Send a polite follow-up asking for feedback and a decision date";
    proposals.push({
      ...ref(l, now), docKind: d.kind, docId: d.id, docNumber: d.number, sentAt: d.sentAt, daysSinceSent: dsSent,
      validUntil: d.validUntil, daysToExpiry: toExpiry, amount: d.amount ?? dealValue(l), needsFollowUp, expiringSoon, expired,
      interestShown, highConversion, needsNegotiation, nextAction, reasons, channel: suggestChannel(l),
    });
  }
  proposals.sort((a, b) => Number(b.needsFollowUp) - Number(a.needsFollowUp) || (b.daysSinceSent ?? 0) - (a.daysSinceSent ?? 0));
  const proposalLeadIds = new Set(proposals.map((p) => p.leadId));

  // ---- deal assessment ------------------------------------------------------------------------
  const deals: DealAssessment[] = open.filter((l) => DEAL_STATUSES.includes(l.status)).map((l) => {
    const e = eng.get(l.id);
    const value = dealValue(l);
    const reasons: string[] = [];
    const riskReasons: string[] = [];
    const missing: string[] = [];
    let score = 0;
    let known = 0;
    const TOTAL = 6;

    // stage
    const stageScore: Record<string, number> = { qualified: 12, brief_received: 20, proposal_in_progress: 28, proposal_sent: 35, negotiation: 50 };
    score += stageScore[l.status] ?? 0;
    reasons.push(`Pipeline stage: ${l.status.replace(/_/g, " ")}`);
    known++;

    // value
    if (value !== null) { known++; reasons.push(`Estimated value ${inr(value)}`); if (value >= 5e5) score += 5; } else missing.push("No budget / expected revenue recorded");

    // engagement
    const interactions = e?.interactions ?? 0;
    if (interactions > 0 || l.lastContactAt) {
      known++;
      if (interactions >= 3) { score += 12; reasons.push(`${interactions} logged interactions`); }
      else if (interactions > 0) { score += 6; reasons.push(`${interactions} logged interaction(s)`); }
      if (e?.replies) { score += 12; reasons.push(`Client has replied ${e.replies} time(s)`); }
    } else missing.push("No communication logged");

    // meeting
    const met = input.completedMeetings.some((m) => m.leadId === l.id);
    const meetingPlanned = (pendingByLead.get(l.id) ?? []).some((f) => f.type === "meeting");
    if (met) { known++; score += 10; reasons.push("A meeting has been completed"); }
    else if (meetingPlanned) { known++; score += 4; reasons.push("A meeting is scheduled"); }
    else missing.push("No meeting recorded");

    // proposal status
    const props = proposals.filter((p) => p.leadId === l.id);
    if (props.length) {
      known++;
      reasons.push(`${props.length} proposal/quotation awaiting decision`);
      if (props.some((p) => p.interestShown)) score += 8;
    } else if (["proposal_sent", "negotiation"].includes(l.status)) missing.push("Status says proposal sent but no sent quotation/proposal is linked");

    // history
    const h = hist.get(l.serviceCategory);
    if (h && h.won + h.lost >= 5) {
      known++;
      const rate = h.won / (h.won + h.lost);
      score += Math.round(rate * 10);
      reasons.push(`Historical win rate for this service: ${Math.round(rate * 100)}% of ${h.won + h.lost} closed deals`);
    } else missing.push("Not enough closed deals for a historical win rate");
    const repeat = l.companyId ? wonByCompany.get(l.companyId) ?? 0 : 0;
    if (repeat) { score += 8; reasons.push(`Repeat client — ${repeat} previous won deal(s)`); }

    // risks
    const dsc = daysSince(l.lastContactAt ?? l.createdAt, now) ?? 0;
    if (dsc >= 10 && ["proposal_sent", "negotiation", "proposal_in_progress"].includes(l.status)) { riskReasons.push(`No contact for ${dsc} days`); score -= 15; }
    if ((pendingByLead.get(l.id) ?? []).some((f) => f.dueAt < dayStart.toISOString())) { riskReasons.push("Has an overdue follow-up"); score -= 5; }
    if (props.some((p) => p.expired)) riskReasons.push("A quotation has expired");
    else if (props.some((p) => p.expiringSoon)) riskReasons.push("A quotation expires within 3 days");
    if (awaitingIds.has(l.id)) riskReasons.push("Client replied and is waiting for a response");
    let expectedClose: string | null = null;
    if (l.eventDate) {
      expectedClose = l.eventDate;
      const daysToEvent = Math.ceil((new Date(`${l.eventDate}T00:00:00+05:30`).getTime() - now.getTime()) / DAY);
      if (daysToEvent < 0) riskReasons.push("Event date has passed");
      else if (daysToEvent <= 14 && !["negotiation"].includes(l.status)) riskReasons.push(`Event is in ${daysToEvent} day(s) and the deal is not yet at negotiation`);
      known++;
    } else missing.push("No event / expected closing date");

    score = Math.max(0, Math.min(100, score));
    const completeness = known / TOTAL;
    const dataConfidence: DealAssessment["dataConfidence"] = completeness >= 0.75 ? "high" : completeness >= 0.5 ? "medium" : "low";
    const tier: DealTier = known < 3 ? "needs_data" : score >= 65 ? "high" : score >= 40 ? "medium" : "low";
    const atRisk = riskReasons.length > 0 && (riskReasons.length >= 2 || dsc >= 10 || props.some((p) => p.expired));
    const needsManagement = (value ?? 0) >= 5e5 && (atRisk || l.status === "negotiation") || props.some((p) => p.needsNegotiation && (value ?? 0) >= 2e5);
    return {
      ...ref(l, now), tier, score: tier === "needs_data" ? null : score, dataConfidence, atRisk, needsManagement,
      reasons, riskReasons, missing, expectedCloseDate: expectedClose,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  // ---- prospect ranking -----------------------------------------------------------------------
  const prospects: ProspectRec[] = open.filter((l) => PROSPECT_STATUSES.includes(l.status) && !proposalLeadIds.has(l.id)).map((l) => {
    const r = ref(l, now);
    const reasons: string[] = [];
    const missing: string[] = [];
    let score = 0;
    const value = dealValue(l);
    if (l.priority === "high") { score += 25; reasons.push("High-priority lead"); } else if (l.priority === "medium") score += 12;
    if (awaitingIds.has(l.id)) { score += 35; reasons.push("Client replied and has not received a response"); }
    const age = daysSince(l.createdAt, now) ?? 0;
    if (!l.lastContactAt) { score += age >= 1 ? 22 : 14; reasons.push(`Never contacted (added ${age} day${age === 1 ? "" : "s"} ago)`); }
    else if ((r.daysSinceContact ?? 0) >= settings.inactiveDays) { score += 15; reasons.push(`No contact for ${r.daysSinceContact} days`); }
    else if ((r.daysSinceContact ?? 0) >= 14) { score += 8; reasons.push(`Last contacted ${r.daysSinceContact} days ago`); }
    if (value !== null) {
      if (value >= 1e6) { score += 15; reasons.push(`Large opportunity (${inr(value)})`); }
      else if (value >= 2e5) { score += 8; reasons.push(`Estimated value ${inr(value)}`); }
    } else missing.push("No budget / expected revenue recorded");
    if (["qualified", "brief_received"].includes(l.status)) { score += 15; reasons.push(`Already ${l.status.replace(/_/g, " ")}`); }
    if (l.eventDate) {
      const d = Math.ceil((new Date(`${l.eventDate}T00:00:00+05:30`).getTime() - now.getTime()) / DAY);
      if (d >= 0 && d <= 45) { score += 15; reasons.push(`Event date is in ${d} day(s)`); }
    } else missing.push("No event date");
    if (l.source === "referral" || l.source === "existing_client") { score += 8; reasons.push(`Source: ${l.source.replace(/_/g, " ")}`); }
    const repeat = l.companyId ? wonByCompany.get(l.companyId) ?? 0 : 0;
    if (repeat) { score += 10; reasons.push(`Previous client — ${repeat} won project(s)`); }
    if ((pendingByLead.get(l.id) ?? []).some((f) => f.dueAt < dayStart.toISOString())) { score += 12; reasons.push("Has an overdue follow-up"); }
    if (!l.industry) missing.push("Company industry not recorded");
    if (!l.contactName) missing.push("No contact person");
    if (!l.contactEmail && !l.contactPhone && !l.contactWhatsapp) missing.push("No contact details");

    let nextAction = "Follow up and move the lead to the next stage";
    if (awaitingIds.has(l.id)) nextAction = "Reply to the client's message";
    else if (!l.lastContactAt) nextAction = "Make first contact and qualify the requirement";
    else if ((r.daysSinceContact ?? 0) >= settings.inactiveDays) nextAction = "Reconnect and check if the requirement is still live";
    else if (l.status === "brief_received") nextAction = "Prepare and send a proposal / quotation";
    else if (l.status === "qualified") nextAction = "Schedule a discovery meeting or call";
    return {
      ...r, score: Math.min(100, score), nextAction, reasons, missing, channel: suggestChannel(l),
      service: recommendService({ serviceCategory: l.serviceCategory, industry: l.industry, companyName: l.companyName, title: l.title, eventName: l.eventName }),
      segment: classifySegment({ industry: l.industry, companyName: l.companyName, title: l.title }),
    };
  }).sort((a, b) => b.score - a.score);

  // ---- industries -----------------------------------------------------------------------------
  const byIndustry = new Map<string, { openLeads: number; value: number }>();
  for (const l of open) {
    const k = l.industry?.trim() || "Not recorded";
    const e = byIndustry.get(k) ?? { openLeads: 0, value: 0 };
    e.openLeads++; e.value += dealValue(l) ?? 0;
    byIndustry.set(k, e);
  }
  const industries = [...byIndustry].map(([industry, v]) => ({ industry, ...v })).sort((a, b) => b.openLeads - a.openLeads).slice(0, 10);

  // ---- action plan (one item per lead, highest priority wins) ---------------------------------
  const cand: PlanItem[] = [];
  const add = (l: LeadRef, p: Omit<PlanItem, "leadId" | "title" | "dedupeKey" | "quotationId" | "proposalId"> & { quotationId?: string; proposalId?: string }) =>
    cand.push({ leadId: l.leadId, title: l.company, dedupeKey: `lead:${l.leadId}`, quotationId: p.quotationId ?? null, proposalId: p.proposalId ?? null, ...p });
  for (const a of awaitingResponse) add(a, { kind: "reply", action: "Reply to the client's message", reason: `Client replied ${daysSince(a.repliedAt, now)} day(s) ago; no response logged`, channel: "call", suggestedService: null, priority: 95 });
  for (const f of overdueFollowUps) add(f, { kind: "general", action: `Complete overdue follow-up: ${f.title}`, reason: `Due ${Math.abs(daysSince(f.dueAt, now) ?? 0)} day(s) ago and still pending`, channel: f.type as Channel, suggestedService: null, priority: 88 });
  for (const p of proposals) {
    add(p, { kind: "proposal", action: p.nextAction, reason: p.reasons.join("; "), channel: p.channel, suggestedService: null, priority: !p.needsFollowUp ? 45 : p.highConversion ? 92 : p.expired || p.expiringSoon ? 86 : 78, ...(p.docKind === "quotation" ? { quotationId: p.docId } : { proposalId: p.docId }) });
  }
  for (const m of meetings.filter((x) => x.at < dayEnd.toISOString())) add(m, { kind: "meeting", action: `Prepare for meeting: ${m.title}`, reason: "Meeting scheduled today", channel: "meeting", suggestedService: null, priority: 90 });
  for (const f of followUpsToday) add(f, { kind: "general", action: f.title, reason: "Follow-up due today", channel: f.type as Channel, suggestedService: null, priority: 75 });
  for (const p of prospects.slice(0, 15)) add(p, { kind: "prospect", action: p.nextAction, reason: p.reasons.slice(0, 3).join("; ") || "Open lead", channel: p.channel, suggestedService: p.service?.name ?? null, priority: Math.min(74, 30 + Math.round(p.score / 2)) });
  for (const l of inactive.slice(0, 5)) if (!prospects.some((p) => p.leadId === l.leadId)) add(l, { kind: "reconnect", action: "Reconnect and check if the requirement is still live", reason: `No contact for ${l.daysSinceContact ?? "30+"} days`, channel: "email", suggestedService: null, priority: 40 });

  const best = new Map<string, PlanItem>();
  for (const c of cand.sort((a, b) => b.priority - a.priority)) if (!best.has(c.leadId!)) best.set(c.leadId!, c);
  const recommendations = [...best.values()].sort((a, b) => b.priority - a.priority);
  const actionPlan = recommendations.slice(0, 10);

  if (!input.activities.some((a) => a.type === "reply_received")) dataNotes.push("No client replies are logged yet. “Replied but not answered” only works for replies logged on a lead (Lead → Log reply).");
  if (!input.docs.length) dataNotes.push("No sent quotations or proposals found, so proposal intelligence is empty.");
  const noIndustry = open.filter((l) => !l.industry).length;
  if (noIndustry) dataNotes.push(`${noIndustry} open lead(s) have no company industry, which limits service recommendations.`);
  const noValue = open.filter((l) => dealValue(l) === null).length;
  if (noValue) dataNotes.push(`${noValue} open lead(s) have no budget or expected revenue.`);

  return {
    generatedAt: now.toISOString(),
    istDate,
    metrics: {
      activeLeads: open.length,
      newLeads: newLeads.length,
      hotProspects: prospects.filter((p) => p.score >= 60).length,
      followUpsToday: followUpsToday.length,
      overdue: overdueFollowUps.length,
      pendingProposals: proposals.length,
      highPotentialDeals: deals.filter((d) => d.tier === "high").length,
      dealsAtRisk: deals.filter((d) => d.atRisk).length,
      meetings: meetings.length,
      awaitingResponse: awaitingResponse.length,
      notContacted: notContacted.length,
      inactive: inactive.length,
    },
    newLeads: newLeads.slice(0, 10),
    highPriority: highPriority.slice(0, 15),
    notContacted: notContacted.slice(0, 15),
    followUpsToday,
    overdueFollowUps: overdueFollowUps.slice(0, 20),
    awaitingResponse,
    inactive: inactive.slice(0, 15),
    meetings,
    prospects: prospects.slice(0, 15),
    proposals,
    deals,
    industries,
    actionPlan,
    recommendations,
    dataNotes,
  };
}
