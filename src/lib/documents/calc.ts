import Decimal from "decimal.js";

/**
 * Financial calculation engine shared by quotations, proposals and invoices.
 * All arithmetic is decimal-safe (decimal.js); results are exact 2-dp values returned as numbers
 * purely for storage/display — never do further arithmetic on them with floating point.
 *
 * Order of operations (documented in the UI and README):
 *   1. line amount      = qty × rate                          (rounded to 2 dp)
 *      line net         = line amount − item discount         (item discount never exceeds the line)
 *   2. subtotal         = Σ line net
 *   3. discount         = document discount on the subtotal   (percent or fixed; capped at subtotal)
 *   4. agency fee       = rate × base, base = (subtotal − discount) by default, or the gross subtotal
 *   5. taxable value    = subtotal − discount + agency fee + taxable other charges
 *   6. tax              = CGST + SGST (each rate/2) or IGST (full rate) on the taxable value, or none
 *   7. grand total      = taxable value + tax + non-taxable other charges (+ optional round-off to ₹1)
 * Every component is rounded half-up to 2 dp on its own, and the total is the sum of the rounded
 * components, so the numbers printed on a document always add up exactly.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = number | string;
export type DiscountSpec = { type: "percent" | "fixed"; value: Num } | null;
export type TaxMode = "none" | "cgst_sgst" | "igst";

export type LineInput = {
  qty: Num;
  rate: Num;
  discount?: DiscountSpec;
};

export type CalcConfig = {
  discount: DiscountSpec;
  agency_fee: { enabled: boolean; rate: Num; base: "after_discount" | "subtotal" };
  tax: { mode: TaxMode; rate: Num };
  other_charges: { label: string; amount: Num; taxable: boolean }[];
  round_to_rupee: boolean;
};

export type LineResult = { amount: number; discount: number; net: number };

export type CalcResult = {
  lines: LineResult[];
  subtotal: number;
  discount: number;
  agency_fee: number;
  other_charges_taxable: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax_total: number;
  other_charges_untaxable: number;
  /** Sum of all other charges (taxable + non-taxable), for display. */
  other_charges: number;
  round_off: number;
  grand_total: number;
};

export const DEFAULT_CALC_CONFIG: CalcConfig = {
  discount: null,
  agency_fee: { enabled: false, rate: 15, base: "after_discount" },
  tax: { mode: "none", rate: 18 },
  other_charges: [],
  round_to_rupee: false,
};

const D = (v: Num | null | undefined) => {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  try {
    const d = new Decimal(String(v).replace(/,/g, ""));
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0); // unparseable input counts as zero; server-side validation rejects it earlier
  }
};
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const n = (d: Decimal) => r2(d).toNumber();

function discountAmount(base: Decimal, spec: DiscountSpec | undefined): Decimal {
  if (!spec) return new Decimal(0);
  const v = D(spec.value);
  if (v.lte(0)) return new Decimal(0);
  const raw = spec.type === "percent" ? base.mul(Decimal.min(v, 100)).div(100) : v;
  return Decimal.min(r2(raw), base);
}

export function calculateDocument(lines: LineInput[], config: CalcConfig): CalcResult {
  const lineResults = lines.map((l) => {
    const amount = r2(D(l.qty).mul(D(l.rate)));
    const discount = discountAmount(amount, l.discount);
    return { amount, discount, net: amount.minus(discount) };
  });
  const subtotal = lineResults.reduce((s, l) => s.plus(l.net), new Decimal(0));
  const discount = discountAmount(subtotal, config.discount);
  const afterDiscount = subtotal.minus(discount);

  let agencyFee = new Decimal(0);
  if (config.agency_fee.enabled) {
    const base = config.agency_fee.base === "subtotal" ? subtotal : afterDiscount;
    agencyFee = r2(base.mul(D(config.agency_fee.rate)).div(100));
  }

  const otherTaxable = config.other_charges.filter((c) => c.taxable).reduce((s, c) => s.plus(r2(D(c.amount))), new Decimal(0));
  const otherUntaxable = config.other_charges.filter((c) => !c.taxable).reduce((s, c) => s.plus(r2(D(c.amount))), new Decimal(0));

  const taxable = afterDiscount.plus(agencyFee).plus(otherTaxable);

  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  const rate = D(config.tax.rate);
  if (config.tax.mode === "cgst_sgst") {
    const half = rate.div(2);
    cgst = r2(taxable.mul(half).div(100));
    sgst = r2(taxable.mul(half).div(100));
  } else if (config.tax.mode === "igst") {
    igst = r2(taxable.mul(rate).div(100));
  }
  const taxTotal = cgst.plus(sgst).plus(igst);

  const exact = taxable.plus(taxTotal).plus(otherUntaxable);
  let roundOff = new Decimal(0);
  if (config.round_to_rupee) roundOff = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).minus(exact);
  const grand = exact.plus(roundOff);

  return {
    lines: lineResults.map((l) => ({ amount: n(l.amount), discount: n(l.discount), net: n(l.net) })),
    subtotal: n(subtotal),
    discount: n(discount),
    agency_fee: n(agencyFee),
    other_charges_taxable: n(otherTaxable),
    taxable_value: n(taxable),
    cgst: n(cgst),
    sgst: n(sgst),
    igst: n(igst),
    tax_total: n(taxTotal),
    other_charges_untaxable: n(otherUntaxable),
    other_charges: n(otherTaxable.plus(otherUntaxable)),
    round_off: n(roundOff),
    grand_total: n(grand),
  };
}

// ---------------------------------------------------------------------------
// Payment milestones
// ---------------------------------------------------------------------------
export type MilestoneInput = { kind: "percent" | "fixed"; value: Num };

export type MilestoneResult = {
  amounts: number[];
  sum: number;
  /** payable total − Σ milestones (0 when they reconcile). */
  difference: number;
  reconciled: boolean;
  /** Σ of percentage milestones (only meaningful when there are percentages). */
  percent_total: number;
};

/**
 * Percent milestones are a share of the payable total, rounded half-up. When every milestone is a
 * percentage and they total exactly 100%, the last one absorbs any rounding remainder so the
 * schedule always reconciles to the payable total to the paisa.
 */
export function computeMilestones(grandTotal: Num, milestones: MilestoneInput[]): MilestoneResult {
  const total = D(grandTotal);
  const amounts = milestones.map((m) => (m.kind === "percent" ? r2(total.mul(D(m.value)).div(100)) : r2(D(m.value))));
  const percentTotal = milestones.filter((m) => m.kind === "percent").reduce((s, m) => s.plus(D(m.value)), new Decimal(0));
  const allPercent = milestones.length > 0 && milestones.every((m) => m.kind === "percent");
  if (allPercent && percentTotal.eq(100)) {
    const others = amounts.slice(0, -1).reduce((s, a) => s.plus(a), new Decimal(0));
    amounts[amounts.length - 1] = total.minus(others);
  }
  const sum = amounts.reduce((s, a) => s.plus(a), new Decimal(0));
  const difference = total.minus(sum);
  return {
    amounts: amounts.map(n),
    sum: n(sum),
    difference: n(difference),
    reconciled: milestones.length > 0 && difference.isZero(),
    percent_total: n(percentTotal),
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export function sumAmounts(values: Num[]): number {
  return n(values.reduce<Decimal>((s, v) => s.plus(D(v)), new Decimal(0)));
}

export function outstandingBalance(total: Num, received: Num): number {
  return n(D(total).minus(D(received)));
}

export type InvoicePaymentStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

/**
 * Payment status is derived, never typed in by hand:
 *   draft/cancelled come from the document state; otherwise
 *   paid → received ≥ total · overdue → balance due and due date passed · partially paid → some money
 *   received · issued → nothing received yet. Dates are IST calendar dates (YYYY-MM-DD).
 */
export function invoicePaymentStatus(input: {
  state: "draft" | "issued" | "cancelled";
  total: Num;
  received: Num;
  dueDate: string | null;
  today: string;
}): InvoicePaymentStatus {
  if (input.state === "draft") return "draft";
  if (input.state === "cancelled") return "cancelled";
  const total = D(input.total);
  const received = D(input.received);
  if (total.gt(0) && received.gte(total)) return "paid";
  if (input.dueDate && input.dueDate < input.today) return "overdue";
  if (received.gt(0)) return "partially_paid";
  return "issued";
}
