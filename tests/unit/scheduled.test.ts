import { describe, expect, it } from "vitest";
import { activeHref, NAV_GROUPS } from "@/components/layout/sidebar-nav";
import {
  addDays, dueOffset, fillReminderTemplate, followUpDraft, invoiceOpen, isoToZoned, offsetLabel, reminderSettingsSchema, retryDelayMinutes,
  scheduledEmailSchema, zonedToIso,
} from "@/lib/scheduled/core";

describe("time zones", () => {
  it("converts a local date and time to the right instant", () => {
    expect(zonedToIso("2026-11-20", "10:30", "Asia/Kolkata")).toBe("2026-11-20T05:00:00.000Z");
    expect(zonedToIso("2026-11-20", "00:15", "Asia/Kolkata")).toBe("2026-11-19T18:45:00.000Z");
    expect(zonedToIso("2026-11-20", "10:30", "UTC")).toBe("2026-11-20T10:30:00.000Z");
    expect(zonedToIso("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z");   // summer time
    expect(zonedToIso("2026-12-01", "09:00", "Europe/London")).toBe("2026-12-01T09:00:00.000Z");
    expect(zonedToIso("2026-12-01", "09:00", "America/New_York")).toBe("2026-12-01T14:00:00.000Z");
  });
  it("round-trips and rejects nonsense", () => {
    expect(isoToZoned("2026-11-20T05:00:00.000Z", "Asia/Kolkata")).toEqual({ date: "2026-11-20", time: "10:30" });
    expect(zonedToIso("2026-13-45", "10:30", "Asia/Kolkata")).toBeNull();
    expect(zonedToIso("2026-11-20", "25:99", "Asia/Kolkata")).toBeNull();
    expect(zonedToIso("2026-11-20", "10:30", "Mars/Olympus")).toBeNull();
    expect(zonedToIso("", "", "Asia/Kolkata")).toBeNull();
  });
});

describe("scheduled email validation", () => {
  const base = { to: "client@example.com", subject: "Hello", body: "Message" };
  it("accepts a valid email and normalises it", () => {
    const r = scheduledEmailSchema.parse({ ...base, to: " Client@Example.com ", cc: "a@x.com; b@y.com" });
    expect(r).toMatchObject({ to: "client@example.com", cc: ["a@x.com", "b@y.com"], kind: "follow_up", related_type: null, timezone: "Asia/Kolkata", attach_document: false });
  });
  it("rejects bad recipients, header injection, unknown record types and time zones", () => {
    expect(scheduledEmailSchema.safeParse({ ...base, to: "nope" }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, to: "a@x.com\nBcc: evil@x.com" }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, cc: "ok@x.com, bad" }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, subject: "  " }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, related_type: "payroll", related_id: null }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, related_id: "not-a-uuid" }).success).toBe(false);
    expect(scheduledEmailSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("payment reminder rules", () => {
  const offsets = [-7, -3, -1, 0, 3, 7, 15];
  it("fires only on the configured days around the due date", () => {
    expect(dueOffset("2026-11-20", "2026-11-13", offsets)).toBe(-7);
    expect(dueOffset("2026-11-20", "2026-11-19", offsets)).toBe(-1);
    expect(dueOffset("2026-11-20", "2026-11-20", offsets)).toBe(0);
    expect(dueOffset("2026-11-20", "2026-12-05", offsets)).toBe(15);
    expect(dueOffset("2026-11-20", "2026-11-18", offsets)).toBeNull();
    expect(dueOffset("2026-11-20", "2026-11-21", offsets)).toBeNull();
    expect(dueOffset(null, "2026-11-20", offsets)).toBeNull();
    expect(dueOffset("2026-11-20", "2026-11-20", [])).toBeNull();
  });
  it("stops for paid, cancelled and draft invoices", () => {
    expect(invoiceOpen("issued", 5000)).toBe(true);
    expect(invoiceOpen("issued", 0)).toBe(false);
    expect(invoiceOpen("issued", 0.001)).toBe(false);
    expect(invoiceOpen("cancelled", 5000)).toBe(false);
    expect(invoiceOpen("draft", 5000)).toBe(false);
  });
  it("fills the reminder wording from the invoice", () => {
    const inv = { number: "NAFA-INV-26-007", client_name: "Priya Shah", client_company: "Acme", project_name: "Dealer Meet", balance_due: 125000, due_date: "2026-11-20" };
    const out = fillReminderTemplate("Dear {{client_name}}, {{invoice_number}}{{project_clause}}: {{pending_amount}} due {{due_date}} {{unknown}}", inv);
    expect(out).toBe("Dear Priya Shah, NAFA-INV-26-007 for Dealer Meet: ₹1,25,000.00 due 20 November 2026 {{unknown}}");
    expect(fillReminderTemplate("Dear {{client_name}},{{project_clause}}", { ...inv, client_name: " ", project_name: "" })).toBe("Dear Acme,");
    expect(fillReminderTemplate("Dear {{client_name}}", { ...inv, client_name: null, client_company: null })).toBe("Dear Sir/Madam");
  });
  it("labels rules and validates settings", () => {
    expect(offsetLabel(-7)).toBe("7 days before the due date");
    expect(offsetLabel(-1)).toBe("1 day before the due date");
    expect(offsetLabel(0)).toBe("On the due date");
    expect(offsetLabel(15)).toBe("15 days after the due date");
    const ok = { enabled: true, offsets, send_hour: 10, subject: "S", body: "B" };
    expect(reminderSettingsSchema.safeParse(ok).success).toBe(true);
    expect(reminderSettingsSchema.safeParse({ ...ok, offsets: [2] }).success).toBe(false);
    expect(reminderSettingsSchema.safeParse({ ...ok, send_hour: 24 }).success).toBe(false);
    expect(reminderSettingsSchema.safeParse({ ...ok, body: "" }).success).toBe(false);
  });
  it("adds days across month ends and backs off retries", () => {
    expect(addDays("2026-11-28", 3)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect([1, 2, 3, 9].map(retryDelayMinutes)).toEqual([5, 30, 120, 120]);
  });
});

describe("follow-up wording", () => {
  it("is specific to the record and always signed", () => {
    const q = followUpDraft("quotation", { name: "Priya", label: "NAFA-QUO-26-014" });
    expect(q.subject).toBe("Following up: Quotation NAFA-QUO-26-014 – NAFA Events & Activations");
    expect(q.body).toMatch(/^Dear Priya,\n\n/);
    expect(q.body).toContain("quotation NAFA-QUO-26-014");
    expect(q.body.endsWith("+91 81695 12822")).toBe(true);
    expect(followUpDraft(null, {}).body).toMatch(/^Dear Sir\/Madam,/);
    expect(followUpDraft("invoice", { label: "INV-1" }).body).toContain("invoice INV-1");
  });
});

describe("sidebar", () => {
  const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
  it("lists every page once", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of ["/", "/leads", "/contacts", "/quotations", "/invoices", "/payments", "/payment-reminders", "/scheduled-emails", "/projects", "/finance", "/finance/reports", "/notifications", "/settings"]) {
      expect(hrefs, h).toContain(h);
    }
  });
  it("highlights the most specific entry", () => {
    expect(activeHref("/", hrefs)).toBe("/");
    expect(activeHref("/finance", hrefs)).toBe("/finance");
    expect(activeHref("/finance/reports", hrefs)).toBe("/finance/reports");
    expect(activeHref("/finance/vendors", hrefs)).toBe("/finance/vendors");
    expect(activeHref("/invoices/abc/edit", hrefs)).toBe("/invoices");
    expect(activeHref("/email-marketing/campaigns/new", hrefs)).toBe("/email-marketing/campaigns/new");
    expect(activeHref("/email-marketing/campaigns/123", hrefs)).toBe("/email-marketing/campaigns");
    expect(activeHref("/settings/documents", hrefs)).toBe("/settings/documents");
    expect(activeHref("/leadsX", hrefs)).toBeNull();
  });
});
