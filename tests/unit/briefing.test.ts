import { describe, expect, it } from "vitest";
import { plainBriefingSummary } from "@/lib/briefing/build";
import { briefingDue, briefingSettingsSchema, briefingSubject, renderBriefingEmail, zonedNow, type BriefingSettings, type BusinessBriefing } from "@/lib/briefing/core";

const settings = (patch: Partial<BriefingSettings> = {}): BriefingSettings => ({
  enabled: true, delivery_time: "08:30", timezone: "Asia/Kolkata", method: "both", recipient_email: "owner@example.com", days: "all", custom_days: [0, 1, 2, 3, 4, 5, 6], ...patch,
});
// 2026-11-16 is a Monday. 03:00 UTC = 08:30 IST.
const at = (iso: string) => new Date(iso);

describe("delivery schedule", () => {
  it("reads the wall clock of the chosen time zone", () => {
    expect(zonedNow(at("2026-11-16T03:00:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-16", minutes: 510, weekday: 1 });
    expect(zonedNow(at("2026-11-15T20:00:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-16", minutes: 90, weekday: 1 });   // already Monday in India
    expect(zonedNow(at("2026-11-16T03:00:00Z"), "America/New_York")).toMatchObject({ date: "2026-11-15", weekday: 0 });
  });
  it("is due from the delivery time onwards, on a delivery day, only when enabled", () => {
    expect(briefingDue(settings(), at("2026-11-16T02:59:00Z"))).toEqual({ due: false, reason: "Before the delivery time" });
    expect(briefingDue(settings(), at("2026-11-16T03:00:00Z"))).toEqual({ due: true, date: "2026-11-16" });
    expect(briefingDue(settings(), at("2026-11-16T04:30:00Z"))).toEqual({ due: true, date: "2026-11-16" });      // the 10:00 catch-up run
    expect(briefingDue(settings({ enabled: false }), at("2026-11-16T04:30:00Z"))).toMatchObject({ due: false, reason: "Daily briefing is switched off" });
    expect(briefingDue(settings({ delivery_time: "18:00" }), at("2026-11-16T04:30:00Z"))).toMatchObject({ due: false });
  });
  it("respects weekdays-only and custom days", () => {
    const sunday = at("2026-11-15T04:30:00Z");
    expect(briefingDue(settings(), sunday)).toMatchObject({ due: true });
    expect(briefingDue(settings({ days: "weekdays" }), sunday)).toEqual({ due: false, reason: "Not a delivery day (Sunday)" });
    expect(briefingDue(settings({ days: "custom", custom_days: [0] }), sunday)).toMatchObject({ due: true });
    expect(briefingDue(settings({ days: "custom", custom_days: [2, 4] }), at("2026-11-16T04:30:00Z"))).toMatchObject({ due: false });
  });
  it("validates the settings", () => {
    const ok = settings();
    expect(briefingSettingsSchema.safeParse(ok).success).toBe(true);
    expect(briefingSettingsSchema.safeParse({ ...ok, delivery_time: "25:00" }).success).toBe(false);
    expect(briefingSettingsSchema.safeParse({ ...ok, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(briefingSettingsSchema.safeParse({ ...ok, recipient_email: "nope" }).success).toBe(false);
    expect(briefingSettingsSchema.safeParse({ ...ok, recipient_email: "" }).success).toBe(false);                    // email delivery needs an address
    expect(briefingSettingsSchema.safeParse({ ...ok, recipient_email: "", method: "in_app" }).success).toBe(true);
    expect(briefingSettingsSchema.safeParse({ ...ok, recipient_email: "", enabled: false }).success).toBe(true);     // may be saved while off
    expect(briefingSettingsSchema.safeParse({ ...ok, days: "custom", custom_days: [] }).success).toBe(false);
    expect(briefingSettingsSchema.safeParse({ ...ok, custom_days: [7] }).success).toBe(false);
  });
});

const briefing: BusinessBriefing = {
  date: "2026-11-16", generatedAt: "2026-11-16T03:00:00.000Z",
  headline: [{ label: "Meetings today", value: "1" }, { label: "Tasks due / overdue", value: "2 / 1", tone: "bad" }, { label: "Overdue invoices", value: "1 · ₹50,000.00", tone: "bad" }, { label: "Outstanding", value: "₹1,25,000.00" }],
  sections: [
    { key: "meetings", title: "Today's Meetings & Schedule", items: [{ title: "11:00 am · Acme <Events>", detail: "Venue walkthrough", href: "/leads/abc", priority: "high" }], note: "Calendar events are not recorded." },
    { key: "followups", title: "Client Follow-ups", items: [{ title: "Reply waiting: Zed", href: "/leads/zed" }] },
    { key: "vendors", title: "Vendor & Procurement Updates", items: [] },
  ],
  actionPlan: [{ title: "Acme · NAFA-INV-26-004", action: "Chase the overdue payment", reason: "₹50,000.00 has been due since 2026-11-10", href: "/invoices/i1" }],
};

describe("briefing email", () => {
  it("has the subject and every section, with 'No updates' for an empty one", () => {
    expect(briefingSubject("2026-11-16")).toBe("NAFA Daily Business Briefing | 16 Nov 2026");
    const { html, text } = renderBriefingEmail(briefing, "Good morning.\nTop priorities:", "https://crm.example.com/", "/briefing/b1");
    for (const t of ["Good Morning – Executive Summary", "Today&#39;s Meetings", "Client Follow-ups", "Vendor &amp; Procurement Updates", "Recommended Action Plan"]) {
      expect(html.replace(/'/g, "&#39;"), t).toContain(t);
    }
    expect(html).toContain("No updates");
    expect(html.match(/color:#888">No updates</g)).toHaveLength(1);            // only the empty section (the footer also explains the phrase)
    expect(html).toContain('href="https://crm.example.com/leads/abc"');
    expect(html).toContain('href="https://crm.example.com/invoices/i1"');
    expect(html).toContain('href="https://crm.example.com/briefing/b1"');
    expect(html).toContain("Chase the overdue payment");
    expect(html).toContain("Why: ₹50,000.00 has been due since 2026-11-10");
    expect(html).toContain("Calendar events are not recorded.");
    expect(text).toContain("VENDOR & PROCUREMENT UPDATES\nNo updates");
    expect(text).toContain("1. Acme · NAFA-INV-26-004 — Chase the overdue payment");
  });
  it("escapes CRM text and never links outside the CRM", () => {
    const evil: BusinessBriefing = { ...briefing, sections: [{ key: "x", title: "T", items: [{ title: "<script>alert(1)</script>", href: "https://evil.example/x" }, { title: "Slash", href: "//evil.example" }] }], actionPlan: [] };
    const { html } = renderBriefingEmail(evil, "<b>hi</b>", "https://crm.example.com");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("evil.example/x\"");
    expect(html).toContain("https://crm.example.com//evil.example");            // a path, on the CRM's own host
  });
  it("still reads properly without an app URL (no links)", () => {
    const { html } = renderBriefingEmail(briefing, "Summary");
    expect(html).not.toContain("href=");
    expect(html).toContain("Acme &lt;Events&gt;");
  });
  it("has a rule-based summary for when the AI is unavailable", () => {
    const s = plainBriefingSummary(briefing);
    expect(s).toContain("You have 1 meeting(s) today.");
    expect(s).toContain("Overdue invoices: 1 · ₹50,000.00");
    expect(s).toContain("Start with: Acme · NAFA-INV-26-004 (chase the overdue payment).");
    expect(plainBriefingSummary({ ...briefing, headline: [{ label: "Meetings today", value: "0" }], actionPlan: [] })).toContain("No meetings are recorded for today.");
  });
});
