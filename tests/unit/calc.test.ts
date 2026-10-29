import { describe, expect, it } from "vitest";
import {
  calculateDocument, computeMilestones, DEFAULT_CALC_CONFIG, invoicePaymentStatus, outstandingBalance, sumAmounts,
  type CalcConfig,
} from "@/lib/documents/calc";
import { amountInWords, integerToIndianWords } from "@/lib/documents/words";

const cfg = (patch: Partial<CalcConfig> = {}): CalcConfig => ({ ...DEFAULT_CALC_CONFIG, ...patch });

describe("calculation engine", () => {
  it("uses decimal-safe arithmetic (no 0.1 + 0.2 drift)", () => {
    const r = calculateDocument([{ qty: "3", rate: "0.1" }, { qty: "3", rate: "0.2" }], cfg());
    expect(r.subtotal).toBe(0.9);
    expect(calculateDocument([{ qty: "0.1", rate: "3" }, { qty: "0.2", rate: "3" }], cfg()).subtotal).toBe(0.9);
    expect(calculateDocument([{ qty: "1.005", rate: "1000" }], cfg()).subtotal).toBe(1005);
  });

  it("handles decimal quantities and prices with half-up rounding per line", () => {
    const r = calculateDocument([{ qty: "2.5", rate: "333.33" }, { qty: "0.333", rate: "10.01" }], cfg());
    expect(r.lines.map((l) => l.amount)).toEqual([833.33, 3.33]); // 833.325 → 833.33 ; 3.33333 → 3.33
    expect(r.subtotal).toBe(836.66);
  });

  it("applies item-level discounts and caps them at the line amount", () => {
    const r = calculateDocument(
      [
        { qty: 2, rate: 1000, discount: { type: "percent", value: 10 } },
        { qty: 1, rate: 500, discount: { type: "fixed", value: 9999 } },
      ],
      cfg(),
    );
    expect(r.lines).toEqual([{ amount: 2000, discount: 200, net: 1800 }, { amount: 500, discount: 500, net: 0 }]);
    expect(r.subtotal).toBe(1800);
  });

  it("reproduces the reference structure: subtotal + 15% agency fee + 18% GST", () => {
    const r = calculateDocument(
      [{ qty: 1, rate: 100000 }],
      cfg({ agency_fee: { enabled: true, rate: 15, base: "after_discount" }, tax: { mode: "cgst_sgst", rate: 18 } }),
    );
    expect(r).toMatchObject({ subtotal: 100000, agency_fee: 15000, taxable_value: 115000, cgst: 10350, sgst: 10350, igst: 0, tax_total: 20700, grand_total: 135700 });
  });

  it("agency fee and tax can each be disabled or changed per document", () => {
    const base = [{ qty: 1, rate: 100000 }];
    expect(calculateDocument(base, cfg()).grand_total).toBe(100000);
    expect(calculateDocument(base, cfg({ agency_fee: { enabled: true, rate: 10, base: "after_discount" } })).grand_total).toBe(110000);
    expect(calculateDocument(base, cfg({ agency_fee: { enabled: false, rate: 15, base: "after_discount" }, tax: { mode: "igst", rate: 12 } })).grand_total).toBe(112000);
  });

  it("IGST uses the full rate, CGST+SGST split it, and the rate is configurable", () => {
    const base = [{ qty: 1, rate: 1000 }];
    const igst = calculateDocument(base, cfg({ tax: { mode: "igst", rate: 18 } }));
    expect(igst).toMatchObject({ igst: 180, cgst: 0, sgst: 0, grand_total: 1180 });
    const split = calculateDocument(base, cfg({ tax: { mode: "cgst_sgst", rate: 5 } }));
    expect(split).toMatchObject({ cgst: 25, sgst: 25, igst: 0, grand_total: 1050 });
    expect(calculateDocument(base, cfg({ tax: { mode: "none", rate: 18 } })).tax_total).toBe(0);
  });

  it("applies the document discount before agency fee and tax, with a selectable fee base", () => {
    const lines = [{ qty: 1, rate: 100000 }];
    const after = calculateDocument(lines, cfg({ discount: { type: "percent", value: 10 }, agency_fee: { enabled: true, rate: 15, base: "after_discount" }, tax: { mode: "igst", rate: 18 } }));
    expect(after).toMatchObject({ discount: 10000, agency_fee: 13500, taxable_value: 103500, igst: 18630, grand_total: 122130 });
    const gross = calculateDocument(lines, cfg({ discount: { type: "percent", value: 10 }, agency_fee: { enabled: true, rate: 15, base: "subtotal" }, tax: { mode: "igst", rate: 18 } }));
    expect(gross.agency_fee).toBe(15000);
    expect(gross.taxable_value).toBe(105000);
  });

  it("treats taxable other charges as taxable and non-taxable ones as post-tax", () => {
    const r = calculateDocument(
      [{ qty: 1, rate: 1000 }],
      cfg({
        tax: { mode: "igst", rate: 18 },
        other_charges: [{ label: "Travel", amount: 200, taxable: true }, { label: "Reimbursement", amount: 50, taxable: false }],
      }),
    );
    expect(r).toMatchObject({ taxable_value: 1200, igst: 216, other_charges: 250, other_charges_untaxable: 50, grand_total: 1466 });
  });

  it("caps a fixed discount at the subtotal and ignores negative discounts", () => {
    expect(calculateDocument([{ qty: 1, rate: 500 }], cfg({ discount: { type: "fixed", value: 9999 } })).grand_total).toBe(0);
    expect(calculateDocument([{ qty: 1, rate: 500 }], cfg({ discount: { type: "fixed", value: -5 } })).discount).toBe(0);
  });

  it("rounds every component half-up and the displayed parts always sum to the total", () => {
    const r = calculateDocument(
      [{ qty: 1, rate: "1234.56" }],
      cfg({ agency_fee: { enabled: true, rate: 15, base: "after_discount" }, tax: { mode: "cgst_sgst", rate: 18 } }),
    );
    expect(r.agency_fee).toBe(185.18); // 185.184
    const parts = sumAmounts([r.subtotal, -r.discount, r.agency_fee, r.cgst, r.sgst, r.other_charges_untaxable, r.round_off]);
    expect(parts).toBe(r.grand_total);
  });

  it("optionally rounds the grand total to the nearest rupee and exposes the round-off", () => {
    const r = calculateDocument([{ qty: 1, rate: "1000.60" }], cfg({ round_to_rupee: true }));
    expect(r.round_off).toBe(0.4);
    expect(r.grand_total).toBe(1001);
    const down = calculateDocument([{ qty: 1, rate: "1000.40" }], cfg({ round_to_rupee: true }));
    expect(down).toMatchObject({ round_off: -0.4, grand_total: 1000 });
  });

  it("copes with large crore-scale amounts and empty documents", () => {
    const big = calculateDocument([{ qty: 1, rate: "99999999.99" }], cfg({ tax: { mode: "igst", rate: 18 } }));
    expect(big.grand_total).toBe(117999999.99);
    expect(calculateDocument([], cfg()).grand_total).toBe(0);
    expect(calculateDocument([{ qty: "", rate: "abc" }], cfg()).grand_total).toBe(0);
  });
});

describe("payment milestones", () => {
  it("reconciles the default 50/30/20 schedule to the paisa", () => {
    const m = computeMilestones("100000.01", [{ kind: "percent", value: 50 }, { kind: "percent", value: 30 }, { kind: "percent", value: 20 }]);
    expect(m.amounts).toEqual([50000.01, 30000, 20000]); // 50000.005→50000.01, 30000.003→30000, last absorbs
    expect(m.sum).toBe(100000.01);
    expect(m.reconciled).toBe(true);
  });

  it("absorbs rounding remainders in the last milestone", () => {
    const m = computeMilestones("100", [{ kind: "percent", value: "33.33" }, { kind: "percent", value: "33.33" }, { kind: "percent", value: "33.34" }]);
    expect(m.sum).toBe(100);
    const third = computeMilestones("100.01", [{ kind: "percent", value: 33.33 }, { kind: "percent", value: 33.33 }, { kind: "percent", value: 33.34 }]);
    expect(third.difference).toBe(0.01 - 0.01); // not all-100% → no absorption but still reported
  });

  it("flags schedules that do not add up", () => {
    const m = computeMilestones(1000, [{ kind: "percent", value: 50 }, { kind: "fixed", value: 400 }]);
    expect(m.reconciled).toBe(false);
    expect(m.difference).toBe(100);
    const over = computeMilestones(1000, [{ kind: "percent", value: 60 }, { kind: "percent", value: 60 }]);
    expect(over.difference).toBe(-200);
  });

  it("supports fixed amounts that sum to the total", () => {
    expect(computeMilestones(1000, [{ kind: "fixed", value: 250 }, { kind: "fixed", value: 750 }]).reconciled).toBe(true);
  });
});

describe("payments and status", () => {
  it("sums multiple payments exactly and returns the outstanding balance", () => {
    expect(sumAmounts(["0.1", "0.2"])).toBe(0.3);
    expect(outstandingBalance("1180.00", sumAmounts([500, "300.50"]))).toBe(379.5);
  });

  const base = { state: "issued" as const, total: 1000, received: 0, dueDate: "2026-11-10", today: "2026-11-01" };
  it("derives status from state, amounts and dates", () => {
    expect(invoicePaymentStatus({ ...base, state: "draft" })).toBe("draft");
    expect(invoicePaymentStatus({ ...base, state: "cancelled", received: 1000 })).toBe("cancelled");
    expect(invoicePaymentStatus(base)).toBe("issued");
    expect(invoicePaymentStatus({ ...base, received: 400 })).toBe("partially_paid");
    expect(invoicePaymentStatus({ ...base, received: 1000 })).toBe("paid");
    expect(invoicePaymentStatus({ ...base, received: 1200 })).toBe("paid");
    expect(invoicePaymentStatus({ ...base, today: "2026-11-11" })).toBe("overdue");
    expect(invoicePaymentStatus({ ...base, received: 400, today: "2026-11-11" })).toBe("overdue");
    expect(invoicePaymentStatus({ ...base, received: 1000, today: "2026-12-01" })).toBe("paid");
    expect(invoicePaymentStatus({ ...base, dueDate: null, today: "2030-01-01" })).toBe("issued");
  });
});

describe("amount in words (Indian system)", () => {
  it("converts whole and fractional amounts", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(125000)).toBe("Rupees One Lakh Twenty-Five Thousand Only");
    expect(amountInWords("135700.00")).toBe("Rupees One Lakh Thirty-Five Thousand Seven Hundred Only");
    expect(amountInWords(12345678.5)).toBe("Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only");
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords("0.99")).toBe("Rupees Zero and Ninety-Nine Paise Only");
    expect(integerToIndianWords(1_00_00_000)).toBe("One Crore");
    expect(integerToIndianWords(100000)).toBe("One Lakh");
  });
});
