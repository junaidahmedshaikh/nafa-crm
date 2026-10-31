/** Dashboard date filters. All dates are IST calendar dates, YYYY-MM-DD. Weeks start on Monday. */
export const RANGE_PRESETS = ["today", "week", "month", "quarter", "year", "custom", "all"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today", week: "This week", month: "This month", quarter: "This quarter", year: "This year (FY Apr–Mar)", custom: "Custom range", all: "All time",
};

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function resolveRange(preset: RangePreset, today: string, custom?: { from?: string; to?: string }): { from: string | null; to: string | null } {
  const [y, m, d] = today.split("-").map(Number);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
      return { from: iso(y, m - 1, d - dow), to: iso(y, m - 1, d - dow + 6) };
    }
    case "month":
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case "quarter": {
      const q = Math.floor((m - 1) / 3);
      return { from: iso(y, q * 3, 1), to: iso(y, q * 3 + 3, 0) };
    }
    case "year": {
      const fy = m >= 4 ? y : y - 1; // Indian financial year
      return { from: iso(fy, 3, 1), to: iso(fy + 1, 3, 0) };
    }
    case "custom": {
      const from = isDate(custom?.from) ? custom!.from! : null;
      const to = isDate(custom?.to) ? custom!.to! : null;
      return from && to && from > to ? { from: to, to: from } : { from, to };
    }
    default:
      return { from: null, to: null };
  }
}

export const isRangePreset = (v: string | undefined): v is RangePreset => !!v && (RANGE_PRESETS as readonly string[]).includes(v);
