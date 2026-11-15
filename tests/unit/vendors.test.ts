import { describe, expect, it } from "vitest";
import { renderQuotationHtml } from "@/lib/documents/templates/quotation";
import { sampleQuotation } from "@/lib/documents/samples";
import {
  estimatedCost, IMPORT_COLUMNS, importTemplateCsv, overallRating, parseImportRows, sellingPrice, sortComparison, vendorProfileSchema, vendorRateSchema,
} from "@/lib/vendors/core";

describe("vendor cost and pricing", () => {
  it("estimates one unit plus fixed charges, with GST on top", () => {
    expect(estimatedCost({ rate: 45000, setup_charges: 3000, transport_charges: 2500, other_charges: 0, gst_percent: 18 })).toBe(59590);
    expect(estimatedCost({ rate: "42000", gst_percent: 0 })).toBe(42000);
    expect(estimatedCost({ rate: 99.995, gst_percent: 18 })).toBe(117.99);
    expect(estimatedCost({ rate: "junk" })).toBe(0);
  });
  it("prices from cost by markup or by margin", () => {
    expect(sellingPrice(45000, 20, "markup")).toBe(54000);
    expect(sellingPrice(45000, 20, "margin")).toBe(56250);      // 20% of 56,250 is the 11,250 profit
    expect(sellingPrice(1000, 0)).toBe(1000);
    expect(sellingPrice(1000, 100, "margin")).toBeNull();        // no finite price
    expect(sellingPrice(1000, -5)).toBeNull();
    expect(sellingPrice(333.33, 12.5)).toBe(375);
  });
  it("averages only the ratings that were entered", () => {
    expect(overallRating({ rating_quality: 5, rating_pricing: 3, rating_reliability: null, rating_timeliness: null })).toBe(4);
    expect(overallRating({ rating_quality: 4, rating_pricing: 4, rating_reliability: 5, rating_timeliness: 4 })).toBe(4.3);
    expect(overallRating({})).toBeNull();
  });
  it("sorts a comparison without dropping or choosing anyone", () => {
    const rows = [
      { v: "A", rate: 45000, estimated_cost: 53100, vendor_rating: 4.5 },
      { v: "B", rate: 48000, estimated_cost: 56640, vendor_rating: null },
      { v: "C", rate: 42000, estimated_cost: 49560, vendor_rating: 3 },
    ];
    expect(sortComparison(rows, "lowest").map((r) => r.v)).toEqual(["C", "A", "B"]);
    expect(sortComparison(rows, "highest").map((r) => r.v)).toEqual(["B", "A", "C"]);
    expect(sortComparison(rows, "rating").map((r) => r.v)).toEqual(["A", "C", "B"]);   // unrated last
    expect(rows.map((r) => r.v)).toEqual(["A", "B", "C"]);                              // input untouched
  });
});

describe("vendor and rate validation", () => {
  it("accepts a full vendor and normalises identifiers", () => {
    const v = vendorProfileSchema.parse({ name: " Bright AV ", email: " Sales@Example.com ", gstin: "27abcde1234f1z5", pan: "abcde1234f", credit_period_days: "30", rating_quality: "5", status: "active" });
    expect(v).toMatchObject({ name: "Bright AV", email: "sales@example.com", gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F", credit_period_days: 30, rating_quality: 5, rating_pricing: null, is_preferred: false });
  });
  it("rejects bad vendor data", () => {
    expect(vendorProfileSchema.safeParse({ name: "" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", email: "nope" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", gstin: "123" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", pan: "12345ABCDE" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", rating_quality: "6" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", status: "banned" }).success).toBe(false);
    expect(vendorProfileSchema.safeParse({ name: "X", credit_period_days: "400" }).success).toBe(false);
  });
  it("validates a rate and needs either an existing or a new service", () => {
    const base = { vendor_id: "00000000-0000-4000-8000-000000000001", unit: "Per Day", rate: "₹45,000" };
    const r = vendorRateSchema.parse({ ...base, product_name: "LED Screen", gst_percent: "18%", valid_until: "2027-03-31" });
    expect(r).toMatchObject({ rate: 45000, gst_percent: 18, rate_type: "purchase", setup_charges: 0, min_order_qty: null, valid_until: "2027-03-31" });
    expect(vendorRateSchema.safeParse(base).success).toBe(false);                                   // no service at all
    expect(vendorRateSchema.safeParse({ ...base, product_name: "X", rate: "-5" }).success).toBe(false);
    expect(vendorRateSchema.safeParse({ ...base, product_name: "X", gst_percent: "140" }).success).toBe(false);
    expect(vendorRateSchema.safeParse({ ...base, product_name: "X", unit: "" }).success).toBe(false);
    expect(vendorRateSchema.safeParse({ ...base, product_name: "X", rate_type: "barter" }).success).toBe(false);
    expect(vendorRateSchema.safeParse({ ...base, product_name: "X", valid_until: "31/03/2027" }).success).toBe(false);
    expect(vendorRateSchema.safeParse({ ...base, vendor_id: "nope", product_name: "X" }).success).toBe(false);
  });
});

describe("spreadsheet import", () => {
  const good = { "Vendor Name": "Bright AV", "Service Name": "LED Screen 24x12", Unit: "Per Day", Rate: "45,000", "Rate Type": "Per Day", "GST Percent": "18", "Valid Until": "31/03/2027", City: "Mumbai" };
  it("reads a valid row, tolerating heading case, commas and Indian dates", () => {
    const { rows, missingColumns, unknownColumns } = parseImportRows([good]);
    expect(missingColumns).toEqual([]);
    expect(unknownColumns).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0]).toMatchObject({ line: 2, vendor: { name: "Bright AV", city: "Mumbai" }, service: { name: "LED Screen 24x12" }, rate: { rate_type: "per_day", unit: "Per Day", rate: 45000, gst_percent: 18, valid_until: "2027-03-31", setup_charges: 0 } });
  });
  it("reports every problem on the row it belongs to and never guesses a price", () => {
    const { rows } = parseImportRows([
      good,
      { ...good, "Service Name": "Truss", Rate: "call for price" },
      { ...good, "Vendor Name": "", "Service Name": "Stage" },
      { ...good, "Service Name": "Sound", "Rate Type": "barter", "Valid Until": "31/02/2027", "GST Percent": "140" },
      good,                                                    // exact duplicate of row 2
      { "Vendor Name": "", "Service Name": "", Unit: "", Rate: "" },   // blank spreadsheet row: ignored
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors.join()).toMatch(/Rate "call for price" is not a valid amount/);
    expect(rows[1].rate.rate).toBe(0);
    expect(rows[2].errors).toContain("Vendor name is required");
    expect(rows[3].errors.join()).toMatch(/Rate type "barter"/);
    expect(rows[3].errors.join()).toMatch(/not a date/);
    expect(rows[3].errors.join()).toMatch(/GST % cannot be more than 100/);
    expect(rows[4].errors.join()).toMatch(/Duplicate of an earlier row/);
    expect(rows[4].line).toBe(6);
  });
  it("flags missing required columns and lists ignored ones", () => {
    const r = parseImportRows([{ Vendor: "X", "Service Name": "Y", Colour: "red" }]);
    expect(r.missingColumns).toEqual(["vendor_name", "unit", "rate"]);
    expect(r.unknownColumns).toEqual(["vendor", "colour"]);
  });
  it("ships a template that the importer itself accepts", () => {
    const [head, sample] = importTemplateCsv().trim().split("\r\n");
    expect(head.split(",")).toEqual([...IMPORT_COLUMNS]);
    const cells = sample.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, IMPORT_COLUMNS.length);
    const row = Object.fromEntries(IMPORT_COLUMNS.map((c, i) => [c, cells[i]]));
    const parsed = parseImportRows([row]);
    expect(parsed.rows[0].errors).toEqual([]);
    expect(parsed.rows[0].rate).toMatchObject({ rate: 45000, rate_type: "per_day", valid_until: "2027-03-31" });
  });
});

describe("confidentiality", () => {
  it("has no field on a quotation that could carry a vendor or a purchase cost", () => {
    const q = sampleQuotation();
    const keys = JSON.stringify(q).toLowerCase();
    for (const word of ["vendor", "purchase", "cost_price", "markup", "margin"]) expect(keys, word).not.toContain(`"${word}`);
    const html = renderQuotationHtml(q).replace(/src:url\(data:[^)]*\)/g, "").replace(/src="data:[^"]*"/g, "");
    for (const word of ["Vendor", "Purchase rate", "Markup", "Cost price"]) expect(html, word).not.toContain(word);
  });
});
