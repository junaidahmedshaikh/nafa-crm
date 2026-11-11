import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAnalytics, type AnalyticsInput } from "@/lib/email/analytics";
import { parseFromHeader, stripQuoted } from "@/lib/email/gmail";
import { verifySvix } from "@/lib/email/webhook";

describe("webhook signature", () => {
  const secretRaw = Buffer.from("super-secret-key-bytes").toString("base64");
  const secret = `whsec_${secretRaw}`;
  const body = JSON.stringify({ type: "email.delivered" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = (id: string, t: string, b: string) => `v1,${createHmac("sha256", Buffer.from(secretRaw, "base64")).update(`${id}.${t}.${b}`).digest("base64")}`;

  it("accepts a correctly signed, fresh request", () => {
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body)).toBe(true);
  });
  it("rejects tampered bodies, wrong signatures, missing headers and stale timestamps", () => {
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body + " ")).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: "v1,AAAA" }, body)).toBe(false);
    expect(verifySvix(secret, { id: null, timestamp: ts, signature: sign("msg_1", ts, body) }, body)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvix(secret, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, body)).toBe(false);
  });
});

describe("gmail parsing", () => {
  it("keeps only the new text of a reply", () => {
    const t = "Yes, interested. Call me Monday.\n\nOn Mon, 9 Nov 2026 at 10:00, NAFA <a@nafaevents.in> wrote:\n> Hello Priya\n> We help...";
    expect(stripQuoted(t)).toBe("Yes, interested. Call me Monday.");
  });
  it("extracts the sender address", () => {
    expect(parseFromHeader('"Priya S" <Priya@Example.com>')).toBe("priya@example.com");
    expect(parseFromHeader("plain@x.com")).toBe("plain@x.com");
  });
});

describe("analytics", () => {
  const rec = (i: number, campaign: string, variant: string | null, status = "sent", step = 0) => ({ id: `r${campaign}${i}${step}`, campaign_id: campaign, email_normalized: `p${i}@x.com`, contact_id: `c${i}`, status, step, variant });
  const base = (over: Partial<AnalyticsInput> = {}): AnalyticsInput => ({
    campaigns: [{ id: "k1", name: "Camp 1", subject: "Subject A", template_id: null }], variants: [{ campaign_id: "k1", label: "B", subject: "Subject B" }],
    recipients: [], events: [], replies: [], leads: [], contacts: Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, industry: i % 2 ? "Wedding" : "Hotels", city: "Mumbai", categories: [] })), templates: [], ...over,
  });

  it("counts people, emails, replies, positives and pipeline outcomes without double counting follow-ups", () => {
    const d = base({
      recipients: [rec(1, "k1", null), rec(1, "k1", null, "sent", 1), rec(2, "k1", null), rec(3, "k1", null, "failed")],
      events: [{ recipient_id: "rk1" + "1" + "0", type: "delivered" }, { recipient_id: "rk1" + "2" + "0", type: "bounced" }],
      replies: [{ campaign_id: "k1", from_normalized: "p1@x.com", category: "meeting_request", lead_id: "L1" }],
      leads: [{ id: "L1", status: "won" }],
    });
    const t = buildAnalytics(d).totals;
    expect(t.recipients).toBe(2);          // p3 failed, never sent
    expect(t.emailsSent).toBe(3);          // p1 twice (follow-up) + p2
    expect(t).toMatchObject({ delivered: 1, bounced: 1, replies: 1, positive: 1, meetings: 1, leads: 1, opportunities: 1, won: 1 });
  });

  it("does not name an A/B winner without enough data, and does with enough and a real gap", () => {
    const few = base({ recipients: [rec(1, "k1", "A"), rec(2, "k1", "B")], replies: [{ campaign_id: "k1", from_normalized: "p2@x.com", category: "interested", lead_id: null }] });
    expect(buildAnalytics(few).abTests[0]).toMatchObject({ enough: false, winner: null });

    const rows = Array.from({ length: 70 }, (_, i) => rec(i, "k1", i < 35 ? "A" : "B"));
    const replies = Array.from({ length: 10 }, (_, i) => ({ campaign_id: "k1", from_normalized: `p${35 + i}@x.com`, category: "interested", lead_id: null }));
    const many = buildAnalytics(base({ recipients: rows, replies }));
    expect(many.abTests[0]).toMatchObject({ enough: true, winner: "B" });
    expect(many.bySubject.map((s) => s.label).sort()).toEqual(["Subject A", "Subject B"]);
  });

  it("groups by industry and shows reply categories", () => {
    const d = base({ recipients: [rec(0, "k1", null), rec(1, "k1", null)], replies: [{ campaign_id: "k1", from_normalized: "p0@x.com", category: null, lead_id: null }] });
    const a = buildAnalytics(d);
    expect(a.byIndustry.map((r) => r.label).sort()).toEqual(["Hotels", "Wedding"]);
    expect(a.replyCategories.unclassified).toBe(1);
  });
});
