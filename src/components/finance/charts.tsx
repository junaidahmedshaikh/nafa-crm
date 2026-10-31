import { formatINR } from "@/lib/format";

/** Small dependency-free SVG charts. Green = positive, red = loss/overrun, neutral otherwise. */
const GREEN = "var(--success)";
const RED = "var(--danger)";
const NEUTRAL = "#8a8a94";
const GOLD = "var(--accent)";
const PALETTE = ["#967026", "#35618f", "#2f7d4f", "#a8661a", "#6b5b95", "#b4332f", "#4a8f8f", "#8a8a94", "#c08a3e", "#5c7a29", "#7a4e7e", "#3f6f9a"];

const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : String(Math.round(a));
  return (n < 0 ? "-" : "") + "₹" + s;
};
const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</li>)}
    </ul>
  );
}

export function ChartEmpty({ text = "No data for this selection yet." }: { text?: string }) {
  return <p className="py-10 text-center text-sm text-muted">{text}</p>;
}

type Series = { label: string; color: string; values: number[] };

/** Grouped vertical bars. */
export function BarChart({ labels, series, height = 220, ariaLabel }: { labels: string[]; series: Series[]; height?: number; ariaLabel: string }) {
  if (!labels.length || series.every((s) => s.values.every((v) => v === 0))) return <ChartEmpty />;
  const W = Math.max(320, labels.length * 70);
  const H = height, padL = 46, padB = 34, padT = 10;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0));
  const gw = (W - padL) / labels.length;
  const bw = Math.min(26, (gw * 0.7) / series.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[320px]" style={{ maxHeight: H + 20 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="var(--border)" />
            <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" fontSize="9" fill={NEUTRAL}>{compact(max * t)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const x0 = padL + gw * i + (gw - bw * series.length) / 2;
          return (
            <g key={l + i}>
              {series.map((s, k) => (
                <rect key={s.label} x={x0 + k * bw} y={y(Math.max(s.values[i], 0))} width={bw - 2} height={Math.max(0, H - padB - y(Math.max(s.values[i], 0)))} fill={s.color} rx="2">
                  <title>{`${l} · ${s.label}: ${formatINR(s.values[i], { exact: true })}`}</title>
                </rect>
              ))}
              <text x={padL + gw * i + gw / 2} y={H - padB + 14} textAnchor="middle" fontSize="9" fill={NEUTRAL}>{l.length > 12 ? l.slice(0, 11) + "…" : l}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars (single series), longest first. */
export function HBarChart({ rows, color = GOLD, ariaLabel }: { rows: { label: string; value: number }[]; color?: string; ariaLabel: string }) {
  if (!rows.length) return <ChartEmpty />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul aria-label={ariaLabel} className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-xs">
          <div className="mb-1 flex justify-between gap-3"><span className="truncate">{r.label}</span><span className="tabular-nums text-muted">{formatINR(r.value)}</span></div>
          <div className="h-2 rounded-full bg-black/5"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** Pie / donut. */
export function PieChart({ slices, donut = false, ariaLabel, centre }: { slices: { label: string; value: number; color?: string }[]; donut?: boolean; ariaLabel: string; centre?: string }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((a, s) => a + s.value, 0);
  if (!total) return <ChartEmpty />;
  const R = 70, r = donut ? 42 : 0, C = 80;
  const starts = data.map((_, i) => -Math.PI / 2 + (data.slice(0, i).reduce((acc, x) => acc + x.value, 0) / total) * Math.PI * 2);
  const arcs = data.map((s, i) => {
    const a0 = starts[i];
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const full = data.length === 1;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    const d = full
      ? `M ${C - R} ${C} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 ${r ? `M ${C - r} ${C} a ${r} ${r} 0 1 1 ${2 * r} 0 a ${r} ${r} 0 1 1 ${-2 * r} 0` : ""}`
      : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} ${r ? `L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z` : `L ${C} ${C} Z`}`;
    return { d, color: s.color ?? PALETTE[i % PALETTE.length], label: s.label, value: s.value };
  });
  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <svg role="img" aria-label={ariaLabel} viewBox="0 0 160 160" className="h-40 w-40 shrink-0">
        {arcs.map((a) => <path key={a.label} d={a.d} fill={a.color} fillRule="evenodd" stroke="var(--surface)" strokeWidth="1.5"><title>{`${a.label}: ${formatINR(a.value)} (${((a.value / total) * 100).toFixed(1)}%)`}</title></path>)}
        {donut && centre && <text x={C} y={C + 4} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">{centre}</text>}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-xs" style={{ minWidth: 160 }}>
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} /><span className="truncate">{a.label}</span></span>
            <span className="tabular-nums text-muted">{((a.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Line chart; the zero line is drawn when values go negative. */
export function LineChart({ labels, values, height = 200, ariaLabel }: { labels: string[]; values: number[]; height?: number; ariaLabel: string }) {
  if (!labels.length) return <ChartEmpty />;
  const W = Math.max(320, labels.length * 70), H = height, padL = 46, padB = 30, padT = 12;
  const hi = Math.max(...values, 0), lo = Math.min(...values, 0);
  const span = niceMax(Math.max(hi, -lo) || 1);
  const min = lo < 0 ? -span : 0, max = span;
  const x = (i: number) => padL + ((W - padL - 16) * (labels.length === 1 ? 0.5 : i / (labels.length - 1)));
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
  const path = values.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[320px]" style={{ maxHeight: H + 20 }}>
        {[min, (min + max) / 2, max].map((t) => (
          <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={NEUTRAL}>{compact(t)}</text></g>
        ))}
        {min < 0 && <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke={NEUTRAL} strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke={GOLD} strokeWidth="2" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r="3.5" fill={v < 0 ? RED : GREEN}><title>{`${labels[i]}: ${formatINR(v, { exact: true })}`}</title></circle>
            <text x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize="9" fill={NEUTRAL}>{labels[i]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export const CHART_COLORS = { green: GREEN, red: RED, neutral: NEUTRAL, gold: GOLD, palette: PALETTE };
