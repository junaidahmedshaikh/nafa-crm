import { describe, expect, it } from "vitest";
import { applyFilters, classifyContacts, type ContactRow } from "@/lib/email/audience";
import { composeEmail } from "@/lib/email/compose";
import { hasUnresolvedPlaceholder, renderTemplate } from "@/lib/email/personalize";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";

const contact = (o: Partial<ContactRow> = {}): ContactRow => ({
  id: Math.random().toString(36).slice(2), fullName: "Priya Sharma", email: "priya@example.com", emailStatus: "valid", designation: null,
  companyName: "Sharma Weddings", industry: "Wedding planning", city: "Mumbai", state: "Maharashtra", website: null, categories: [], lastContactAt: null, leadStatuses: [], leadPriorities: [], ...o,
});

describe("personalisation", () => {
  it("fills variables, supports inline and campaign fallbacks, and reports anything unresolved", () => {
    const r = renderTemplate("Hi {{first_name|there}}, {{company_name}} in {{city}} {{designation}}", { first_name: "", company_name: "Acme", city: "Pune" }, { city: "India" });
    expect(r.text).toBe("Hi there, Acme in Pune ");
    expect(r.missing).toEqual(["designation"]);
  });
  it("escapes values placed into HTML", () => {
    expect(renderTemplate("{{company_name}}", { company_name: "A <b>&</b>" }, {}, { escape: true }).text).toBe("A &lt;b&gt;&amp;&lt;/b&gt;");
  });
});

describe("sanitiser", () => {
  it("removes scripts, handlers and unsafe links but keeps formatting", () => {
    const out = sanitizeEmailHtml(`<p onclick="x()">Hi <strong>you</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://nafaevents.in">ok</a><img src="data:x"><iframe src="x"></iframe>`);
    expect(out).not.toMatch(/script|onclick|javascript|iframe|data:/i);
    expect(out).toContain("<strong>you</strong>");
    expect(out).toContain('href="https://nafaevents.in"');
  });
});

describe("eligibility", () => {
  it("excludes missing, invalid, duplicate, unsubscribed, bounced and suppressed addresses", () => {
    const rows = [
      contact({ email: "ok@x.com" }), contact({ email: "OK@x.com " }), contact({ email: null }), contact({ email: "not-an-email" }),
      contact({ email: "u@x.com", emailStatus: "unsubscribed" }), contact({ email: "b@x.com", emailStatus: "bounced" }), contact({ email: "s@x.com" }),
    ];
    const r = classifyContacts(rows, new Map([["s@x.com", "manual"]]));
    expect(r.eligible).toHaveLength(1);
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(["bounced", "duplicate", "invalid", "no_email", "suppressed", "unsubscribed"]);
  });
  it("treats a suppression-list unsubscribe as unsubscribed even if the contact row says valid", () => {
    const r = classifyContacts([contact({ email: "a@x.com" })], new Map([["a@x.com", "unsubscribed"]]));
    expect(r.excluded[0].reason).toBe("unsubscribed");
  });
  it("applies city, category and not-contacted filters", () => {
    const now = new Date("2026-11-11T00:00:00Z");
    const rows = [
      contact({ city: "Mumbai", categories: ["wedding_planners"] }),
      contact({ city: "Delhi", categories: ["wedding_planners"] }),
      contact({ city: "Mumbai", industry: "Banking", lastContactAt: "2026-11-10T00:00:00Z" }),
    ];
    expect(applyFilters(rows, { cities: ["mumbai"], categories: ["wedding_planners"] }, now)).toHaveLength(1);
    expect(applyFilters(rows, { notContactedDays: 30, industries: ["bank"] }, now)).toHaveLength(0);
  });
});

describe("composeEmail", () => {
  const settings = { postalAddress: "1 Test Road, Mumbai 400001", signatureHtml: "<p>Team NAFA</p>" };
  const base = { subject: "Hello {{company_name}}", bodyHtml: "<p>Hi {{first_name|there}}</p>", fallbacks: {}, salespersonName: "Asha", senderName: "NAFA" };
  it("adds signature, postal address and a working unsubscribe link, and leaves no placeholders", () => {
    const m = composeEmail(base, settings, { fullName: "Priya Sharma", companyName: "Sharma Weddings" }, "11111111-1111-1111-1111-111111111111");
    expect(m.missing).toEqual([]);
    expect(m.subject).toBe("Hello Sharma Weddings");
    expect(m.html).toContain("1 Test Road");
    expect(m.html).toContain("/unsubscribe/11111111-1111-1111-1111-111111111111");
    expect(m.text).toContain("Unsubscribe:");
    expect(hasUnresolvedPlaceholder(m.html + m.subject)).toBe(false);
  });
  it("reports a missing field so the contact is excluded instead of emailed", () => {
    const m = composeEmail({ ...base, subject: "About {{industry}}" }, settings, { fullName: "A B", companyName: "X" }, "t");
    expect(m.missing).toEqual(["industry"]);
  });
});
