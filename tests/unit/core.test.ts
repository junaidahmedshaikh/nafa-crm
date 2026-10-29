import { describe, expect, it } from "vitest";
import { normalizeCompanyName, normalizeEmail, parsePhone, phoneDigits, websiteDomain } from "@/lib/normalize";
import { defaultFollowUpLocal, isoToIstLocal, istDateStart, istDayBounds, istLocalToIso, istMonthStart } from "@/lib/datetime";
import { formatINR, formatLeadNumber } from "@/lib/format";
import { safeNextPath } from "@/lib/safe-redirect";
import { buildSearchOr, parseLeadFilters, sanitizeSearch } from "@/lib/lead-filters";
import { leadSchema, statusChangeSchema, settingsSchema, companySchema, followUpSchema } from "@/lib/validation/schemas";

describe("normalisation", () => {
  it("normalises company names the same regardless of legal suffix and punctuation", () => {
    expect(normalizeCompanyName("Acme Pvt. Ltd.")).toBe("acme");
    expect(normalizeCompanyName("ACME   Private Limited")).toBe("acme");
    expect(normalizeCompanyName("Zee & Co LLP")).toBe("zee co");
  });
  it("normalises emails and phone digits", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail("  ")).toBeNull();
    expect(phoneDigits("+91 98765-43210")).toBe("919876543210");
  });
  it("parses phone numbers with and without a country code", () => {
    expect(parsePhone("+91 98765 43210")).toBe("+919876543210");
    expect(parsePhone("98765 43210")).toBe("+919876543210");
    expect(parsePhone("098765 43210")).toBe("+919876543210");
    expect(parsePhone("919876543210")).toBe("+919876543210");
    expect(parsePhone("+1 (415) 555-0132")).toBe("+14155550132");
    expect(parsePhone("00971501234567")).toBe("+971501234567");
    expect(parsePhone("12345")).toBeNull();
    expect(parsePhone("call me")).toBeNull();
    expect(parsePhone("")).toBeNull();
  });
  it("extracts website domains", () => {
    expect(websiteDomain("https://www.nafaevents.in/about")).toBe("nafaevents.in");
    expect(websiteDomain("nafaevents.in")).toBe("nafaevents.in");
    expect(websiteDomain("not a url")).toBeNull();
  });
});

describe("IST date handling", () => {
  it("round-trips IST wall-clock values through UTC", () => {
    expect(istLocalToIso("2026-11-03T15:30")).toBe("2026-11-03T10:00:00.000Z");
    expect(isoToIstLocal("2026-11-03T10:00:00.000Z")).toBe("2026-11-03T15:30");
  });
  it("rejects impossible dates", () => {
    expect(istLocalToIso("2026-02-31T10:00")).toBeNull();
    expect(istLocalToIso("garbage")).toBeNull();
  });
  it("computes IST day bounds across the UTC date line", () => {
    // 2026-11-03 20:00 UTC is already 2026-11-04 01:30 IST
    const { start, end } = istDayBounds(new Date("2026-11-03T20:00:00Z"));
    expect(start.toISOString()).toBe("2026-11-03T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-04T18:30:00.000Z");
  });
  it("computes the IST month start", () => {
    expect(istMonthStart(new Date("2026-11-15T12:00:00Z")).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(istDateStart("2026-11-01")?.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
  it("builds default follow-up values", () => {
    expect(defaultFollowUpLocal(3, "10:00:00", new Date("2026-11-03T05:00:00Z"))).toBe("2026-11-06T10:00");
  });
});

describe("formatting", () => {
  it("formats rupees in the Indian digit-grouping system", () => {
    expect(formatINR(1500000)).toContain("15,00,000");
    expect(formatINR(null)).toBe("—");
  });
  it("formats lead numbers", () => expect(formatLeadNumber(7)).toBe("L-0007"));
});

describe("safeNextPath", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/leads?status=new")).toBe("/leads?status=new");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});

describe("lead filters", () => {
  it("parses and validates query parameters", () => {
    const f = parseLeadFilters({ q: " acme ", status: "new,bogus,won", sort: "revenue", page: "3", from: "2026-13-45", owner: "nope" });
    expect(f.q).toBe("acme");
    expect(f.status).toEqual(["new", "won"]);
    expect(f.sort).toBe("revenue");
    expect(f.dir).toBe("desc");
    expect(f.page).toBe(3);
    expect(f.from).toBeNull();
    expect(f.owner).toBeNull();
  });
  it("defaults safely", () => {
    const f = parseLeadFilters({ sort: "drop table", page: "-4" });
    expect(f.sort).toBe("created");
    expect(f.page).toBe(1);
  });
  it("strips characters that could break out of a PostgREST filter", () => {
    expect(sanitizeSearch("a,b)(c*%\"")).toBe("a b c");
    expect(buildSearchOr("o'brien, events)")).not.toMatch(/[()'].*ilike/);
    expect(buildSearchOr("98765")).toContain("contact_phone_digits");
    expect(buildSearchOr("   ")).toBeNull();
  });
});

const validLead = {
  title: "Dealer Meet", company_name: "Acme", website: "", contact_name: "Asha", designation: "", email: "ASHA@Acme.com",
  phone: "98765 43210", whatsapp: "", source: "referral", service_category: "corporate_event", event_name: "", event_date: "",
  city: "", venue: "", budget_inr: "15,00,000", expected_revenue_inr: "3,00,000.50", status: "new", priority: "high",
  assigned_to: "", last_contact_date: "", notes: "", lost_reason: "", first_follow_up_at: "",
} as const;

describe("lead validation", () => {
  const schema = leadSchema("+91");
  it("normalises valid input", () => {
    const r = schema.safeParse(validLead);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("asha@acme.com");
      expect(r.data.phone).toBe("+919876543210");
      expect(r.data.budget_inr).toBe(1500000);
      expect(r.data.expected_revenue_inr).toBe(300000.5);
      expect(r.data.website).toBeNull();
      expect(r.data.assigned_to).toBeNull();
    }
  });
  it("requires a title and a company or contact", () => {
    expect(schema.safeParse({ ...validLead, title: "  " }).success).toBe(false);
    const r = schema.safeParse({ ...validLead, company_name: "", contact_name: "", email: "", phone: "" });
    expect(r.success).toBe(false);
  });
  it("rejects bad email, phone, money, dates and enums", () => {
    for (const patch of [
      { email: "nope" }, { phone: "abc" }, { budget_inr: "12x" }, { budget_inr: "-5" }, { event_date: "2026-02-30" },
      { status: "hot" }, { priority: "urgent" }, { first_follow_up_at: "tomorrow" }, { website: "not a url" },
    ]) {
      expect(schema.safeParse({ ...validLead, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
  it("requires a lost reason when the status is lost", () => {
    const r = schema.safeParse({ ...validLead, status: "lost", lost_reason: "" });
    expect(r.success).toBe(false);
    expect(schema.safeParse({ ...validLead, status: "lost", lost_reason: "Budget" }).success).toBe(true);
  });
  it("requires a contact name when contact details are given", () => {
    expect(schema.safeParse({ ...validLead, contact_name: "" }).success).toBe(false);
  });
  it("applies the configured default country code", () => {
    const r = leadSchema("+971").safeParse({ ...validLead, phone: "501234567" });
    expect(r.success && r.data.phone).toBe("+971501234567");
  });
});

describe("other schemas", () => {
  it("status change needs a reason for lost", () => {
    expect(statusChangeSchema.safeParse({ status: "lost" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "lost", lost_reason: "x" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ status: "won" }).success).toBe(true);
  });
  it("company needs a name", () => {
    expect(companySchema.safeParse({ name: " " }).success).toBe(false);
    expect(companySchema.safeParse({ name: "Acme", website: "acme.com" }).success).toBe(true);
  });
  it("follow-up converts IST input to UTC", () => {
    const r = followUpSchema.safeParse({ title: "Call", due_at: "2026-11-03T15:30", type: "call" });
    expect(r.success && r.data.due_at).toBe("2026-11-03T10:00:00.000Z");
    expect(followUpSchema.safeParse({ title: "Call", due_at: "", type: "call" }).success).toBe(false);
    expect(followUpSchema.safeParse({ title: "Call", due_at: "2026-11-03T15:30", type: "fax" }).success).toBe(false);
  });
  it("settings validate country code and follow-up fields", () => {
    const ok = { business_name: "NAFA", website: "", business_email: "", default_country_code: "+91", default_follow_up_days: "3", default_follow_up_time: "10:00", default_follow_up_type: "call" };
    expect(settingsSchema.safeParse(ok).success).toBe(true);
    expect(settingsSchema.safeParse({ ...ok, default_country_code: "91" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, default_follow_up_days: "999" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, default_follow_up_time: "25:00" }).success).toBe(false);
  });
});
