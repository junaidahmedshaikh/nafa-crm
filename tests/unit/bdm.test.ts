import { describe, expect, it } from "vitest";
import { analyse } from "@/lib/bdm/engine";
import { classifySegment, recommendService } from "@/lib/bdm/services";
import type { BdmInput, LeadFact } from "@/lib/bdm/types";

const NOW = new Date("2026-11-10T04:00:00Z"); // 09:30 IST
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

let seq = 0;
const lead = (o: Partial<LeadFact> = {}): LeadFact => ({
  id: `lead-${++seq}`, number: seq, title: "Annual meet", companyId: null, companyName: `Co ${seq}`, industry: null,
  contactName: "Asha", contactDesignation: null, contactEmail: "a@x.com", contactPhone: null, contactWhatsapp: null,
  source: "website", serviceCategory: "other", eventName: null, eventDate: null, city: "Mumbai", budget: null, expectedRevenue: null,
  status: "new", priority: "medium", assignedTo: null, assignedName: null, lastContactAt: null, nextFollowUpAt: null,
  createdAt: daysAgo(3), closedAt: null, ...o,
});
const input = (o: Partial<BdmInput> = {}): BdmInput => ({
  now: NOW, settings: { inactiveDays: 30, proposalFollowupDays: 3 }, leads: [], followUps: [], completedMeetings: [], activities: [], docs: [], ...o,
});

describe("BDM engine", () => {
  it("never invents data: an empty CRM gives empty lists and honest notes", () => {
    const d = analyse(input());
    expect(d.metrics.activeLeads).toBe(0);
    expect(d.actionPlan).toEqual([]);
    expect(d.dataNotes.join(" ")).toMatch(/No client replies are logged/);
  });

  it("ranks an uncontacted high-priority lead above a recently contacted low one and explains why", () => {
    const hot = lead({ priority: "high", expectedRevenue: 1_500_000 });
    const cold = lead({ priority: "low", lastContactAt: daysAgo(2) });
    const d = analyse(input({ leads: [cold, hot] }));
    expect(d.prospects[0].leadId).toBe(hot.id);
    expect(d.prospects[0].reasons.join(" ")).toMatch(/High-priority/);
    expect(d.prospects[0].reasons.join(" ")).toMatch(/Never contacted/);
    expect(d.prospects[1].missing).toContain("No budget / expected revenue recorded");
  });

  it("flags a client reply that has no later outbound contact, and clears it once we respond", () => {
    const l = lead({ status: "contacted", lastContactAt: daysAgo(6) });
    const waiting = analyse(input({ leads: [l], activities: [{ leadId: l.id, type: "reply_received", createdAt: daysAgo(2) }] }));
    expect(waiting.awaitingResponse.map((a) => a.leadId)).toEqual([l.id]);
    expect(waiting.actionPlan[0].kind).toBe("reply");
    const answered = analyse(input({
      leads: [l],
      activities: [{ leadId: l.id, type: "reply_received", createdAt: daysAgo(2) }, { leadId: l.id, type: "message_sent", createdAt: daysAgo(1) }],
    }));
    expect(answered.awaitingResponse).toEqual([]);
  });

  it("separates overdue from due-today follow-ups using IST days", () => {
    const l = lead({ status: "contacted", lastContactAt: daysAgo(1) });
    const d = analyse(input({
      leads: [l],
      followUps: [
        { id: "f1", leadId: l.id, type: "call", title: "old", dueAt: "2026-11-09T10:00:00Z" },
        { id: "f2", leadId: l.id, type: "call", title: "today", dueAt: "2026-11-10T11:00:00Z" },
        { id: "f3", leadId: l.id, type: "meeting", title: "later", dueAt: "2026-11-12T11:00:00Z" },
      ],
    }));
    expect(d.overdueFollowUps.map((f) => f.followUpId)).toEqual(["f1"]);
    expect(d.followUpsToday.map((f) => f.followUpId)).toEqual(["f2"]);
    expect(d.meetings.map((f) => f.followUpId)).toEqual(["f3"]);
  });

  it("flags sent quotations needing follow-up or expiring, and links interest to conversion signals", () => {
    const l = lead({ status: "proposal_sent", lastContactAt: daysAgo(8), expectedRevenue: 600_000 });
    const d = analyse(input({
      leads: [l],
      docs: [{ kind: "quotation", id: "q1", number: "NAFA-Q-001", leadId: l.id, companyName: "X", status: "sent", sentAt: daysAgo(6), validUntil: "2026-11-11", amount: 600_000 }],
      activities: [{ leadId: l.id, type: "reply_received", createdAt: daysAgo(3) }],
    }));
    const p = d.proposals[0];
    expect(p.needsFollowUp).toBe(true);
    expect(p.expiringSoon).toBe(true);
    expect(p.interestShown).toBe(true);
    expect(p.reasons.join(" ")).toMatch(/sent 6 days ago/);
  });

  it("marks a deal 'needs more data' instead of guessing, and never reports a probability", () => {
    const l = lead({ status: "qualified" });
    const d = analyse(input({ leads: [l] }));
    expect(d.deals[0].tier).toBe("needs_data");
    expect(d.deals[0].score).toBeNull();
    expect(d.deals[0].missing.length).toBeGreaterThan(0);
  });

  it("rates a well-evidenced deal high and surfaces stale-contact risk", () => {
    const l = lead({ status: "negotiation", expectedRevenue: 800_000, eventDate: "2026-12-20", lastContactAt: daysAgo(12), priority: "high" });
    const d = analyse(input({
      leads: [l],
      completedMeetings: [{ leadId: l.id, at: daysAgo(10) }],
      activities: [1, 2, 3].map((i) => ({ leadId: l.id, type: "message_sent", createdAt: daysAgo(10 + i) })).concat([{ leadId: l.id, type: "reply_received", createdAt: daysAgo(11) }]),
      docs: [{ kind: "quotation", id: "q", number: "Q", leadId: l.id, companyName: "X", status: "sent", sentAt: daysAgo(9), validUntil: "2026-11-30", amount: 800_000 }],
    }));
    expect(d.deals[0].tier).toBe("high");
    expect(d.deals[0].atRisk).toBe(true);
    expect(d.deals[0].riskReasons.join(" ")).toMatch(/No contact for 12 days/);
  });

  it("produces one recommendation per lead", () => {
    const l = lead({ priority: "high", status: "contacted", lastContactAt: daysAgo(40) });
    const d = analyse(input({
      leads: [l],
      followUps: [{ id: "f", leadId: l.id, type: "call", title: "t", dueAt: "2026-11-01T10:00:00Z" }],
      activities: [{ leadId: l.id, type: "reply_received", createdAt: daysAgo(1) }],
    }));
    expect(d.recommendations.filter((r) => r.leadId === l.id)).toHaveLength(1);
    expect(d.recommendations[0].kind).toBe("reply"); // highest priority wins
  });

  it("ignores closed leads", () => {
    const d = analyse(input({ leads: [lead({ status: "won" }), lead({ status: "lost" })] }));
    expect(d.metrics.activeLeads).toBe(0);
  });
});

describe("NAFA service mapping", () => {
  it("uses the recorded service category first", () => {
    expect(recommendService({ serviceCategory: "exhibition" })?.name).toBe("Exhibitions and Trade Shows");
  });
  it("infers from the business profile, and returns null when there is nothing to go on", () => {
    expect(recommendService({ serviceCategory: "other", industry: "Wedding planner" })?.name).toBe("Wedding and Social Events");
    expect(recommendService({ serviceCategory: "other", industry: "Advertising agency" })?.name).toBe("BTL Marketing");
    expect(recommendService({ serviceCategory: "other" })).toBeNull();
    expect(classifySegment({ industry: "Hotel & banquet" })).toBe("Hotel / banquet venue");
  });
});
