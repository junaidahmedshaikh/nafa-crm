import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import {
  analyzeImport, importTemplateCsv, leadDuplicateKey, mapHeaders, normalizeDateInput, sanitizeCsvCell, toCsv,
} from "@/lib/csv";

describe("CSV export safety", () => {
  it("neutralises spreadsheet formulas but leaves phone numbers and amounts alone", () => {
    expect(sanitizeCsvCell("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCsvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("+91 98765 43210")).toBe("+91 98765 43210");
    expect(sanitizeCsvCell("-1500")).toBe("-1500");
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(42)).toBe("42");
  });
  it("escapes commas, quotes and newlines (round-trips through a CSV parser)", () => {
    const rows = [{ a: 'He said "hi", ok', b: "line1\nline2", c: "=1+1" }];
    const csv = toCsv(rows, [
      { header: "a", value: (r) => r.a }, { header: "b", value: (r) => r.b }, { header: "c", value: (r) => r.c },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
    expect(parsed.data[0]).toEqual({ a: 'He said "hi", ok', b: "line1\nline2", c: "'=1+1" });
  });
});

describe("import header mapping", () => {
  it("maps aliases flexibly and reports unknown columns", () => {
    const { mapping, unknown, missingRequired } = mapHeaders(["Lead Title", "Company Name", "Budget", "Mobile", "Favourite Colour", "lead_id"]);
    expect(Object.values(mapping)).toEqual(["title", "company", "budget_inr", "phone"]);
    expect(unknown).toEqual(["Favourite Colour"]);
    expect(missingRequired).toBe(false);
    expect(mapHeaders(["Company"]).missingRequired).toBe(true);
  });
  it("normalises dd/mm/yyyy dates", () => {
    expect(normalizeDateInput("5/11/2026")).toBe("2026-11-05");
    expect(normalizeDateInput("2026-11-05")).toBe("2026-11-05");
  });
});

const HEADERS = ["title", "company", "contact_name", "email", "phone", "status", "priority", "source", "budget_inr", "event_date", "next_follow_up", "lost_reason"];
const row = (o: Record<string, string>) => Object.fromEntries(HEADERS.map((h) => [h, o[h] ?? ""]));

describe("import analysis", () => {
  it("classifies every row and never drops one silently", () => {
    const rows = [
      row({ title: "Good lead", company: "Acme", contact_name: "Asha", email: "asha@acme.com", phone: "9876543210", status: "Qualified", priority: "High", source: "Referral", budget_inr: "1,50,000", event_date: "15/02/2027", next_follow_up: "2026-11-05 11:00" }),
      row({ title: "", company: "NoTitle Co" }),
      row({ title: "Bad email", company: "X", contact_name: "Y", email: "nope" }),
      row({ title: "Bad status", company: "X", status: "Hot" }),
      row({ title: "Lost no reason", company: "X", status: "Lost" }),
      row({ title: "Bad money", company: "X", budget_inr: "lots" }),
      row({ title: "good lead", company: "Acme", contact_name: "Asha", email: "ASHA@acme.com" }), // same as row 1 (case-insensitive)
      row({ title: "Another", company: "Beta" }),
    ];
    const { results } = analyzeImport(rows, HEADERS, "+91", new Set());
    expect(results).toHaveLength(rows.length);
    expect(results.map((r) => r.status)).toEqual(["valid", "invalid", "invalid", "invalid", "invalid", "invalid", "duplicate", "valid"]);
    expect(results.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]); // spreadsheet row numbers (header = 1)

    const first = results[0];
    expect(first.status === "valid" && first.data.phone).toBe("+919876543210");
    expect(first.status === "valid" && first.data.budget_inr).toBe(150000);
    expect(first.status === "valid" && first.data.event_date).toBe("2027-02-15");
    expect(first.status === "valid" && first.data.first_follow_up_at).toBe("2026-11-05T05:30:00.000Z");

    const errors = (i: number) => (results[i].status === "invalid" ? (results[i] as { errors: string[] }).errors.join(" ") : "");
    expect(errors(1)).toMatch(/title/i);
    expect(errors(2)).toMatch(/email/i);
    expect(errors(3)).toMatch(/status/i);
    expect(errors(4)).toMatch(/lost_reason|lost reason/i);
    expect(errors(5)).toMatch(/budget/i);
  });

  it("flags duplicates of leads that already exist in the CRM", () => {
    const existing = new Set([leadDuplicateKey("Good lead", "asha@acme.com", null, "Acme")]);
    const { results } = analyzeImport(
      [row({ title: "Good lead", company: "Acme", contact_name: "Asha", email: "asha@acme.com" })], HEADERS, "+91", existing,
    );
    expect(results[0].status).toBe("duplicate");
  });

  it("does not treat the same title for different people as a duplicate", () => {
    const { results } = analyzeImport(
      [row({ title: "Annual meet", company: "A", contact_name: "P", email: "p@a.com" }), row({ title: "Annual meet", company: "B", contact_name: "Q", email: "q@b.com" })],
      HEADERS, "+91", new Set(),
    );
    expect(results.map((r) => r.status)).toEqual(["valid", "valid"]);
  });

  it("reports a missing title column", () => {
    expect(analyzeImport([{ Company: "A" }], ["Company"], "+91", new Set()).missingRequiredHeader).toBe(true);
  });

  it("the downloadable template imports cleanly", () => {
    const parsed = Papa.parse<Record<string, string>>(importTemplateCsv(), { header: true, skipEmptyLines: true });
    const { results } = analyzeImport(parsed.data, parsed.meta.fields ?? [], "+91", new Set());
    expect(results.map((r) => r.status)).toEqual(["valid"]);
  });
});
