// Single KPI tile. The dashboard composes a strip of these.
//
// Visual hierarchy is driven by the `featured` prop — featured tiles take
// two columns, render a larger value, and show their sparkline at full
// height. Secondary tiles get a compact sparkline tucked beneath the number.
//
// The sparkline series is just `number[]` — keeps the tile dumb about
// units. Trend is a {delta, label} object so callers can phrase it (e.g.
// "+12% wk" vs "+3 today") instead of us hard-coding "week-over-week".

import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";

function TrendChip({ trend }) {
  if (!trend || trend.delta == null) return null;
  const up = trend.delta > 0;
  const flat = trend.delta === 0;
  const cls = flat
    ? "bg-gray-100 text-gray-500"
    : up
    ? "bg-emerald-50 text-emerald-700"
    : "bg-rose-50 text-rose-700";
  const arrow = flat ? "→" : up ? "↑" : "↓";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${cls}`}
      title={trend.title}
    >
      <span>{arrow}</span>
      <span>{trend.label}</span>
    </span>
  );
}

function Sparkline({ data, color, height = 36 }) {
  if (!data || data.length < 2) {
    // Reserve the space so tiles align even when there's no series yet —
    // a missing sparkline shouldn't shift the layout.
    return <div style={{ height }} aria-hidden />;
  }
  const series = data.map((v, i) => ({ i, v: Number(v) || 0 }));
  const gradId = `spark-${color.replace("#", "")}`;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,            // tailwind class for the value colour, e.g. "text-rose-600"
  spark,             // number[] — series for the sparkline
  sparkColor = "#14b8a6",
  trend,             // { delta: number, label: string, title?: string }
  featured = false,  // bigger tile, spans 2 cols
}) {
  const valueCls = `${featured ? "text-3xl" : "text-xl"} font-semibold tracking-tight ${
    accent || "text-gray-900"
  }`;
  return (
    <div
      className={`relative bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden ${
        featured ? "p-5 col-span-2" : "p-4"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">
          {label}
        </span>
        {Icon && <Icon className="w-4 h-4 text-gray-300 shrink-0" />}
      </div>

      <div className="flex items-end justify-between gap-3 mt-2">
        <div className="min-w-0">
          <div className={valueCls}>{value}</div>
          {sub && (
            <div className="text-xs text-gray-400 mt-0.5 truncate">{sub}</div>
          )}
        </div>
        <TrendChip trend={trend} />
      </div>

      <div className="mt-2 -mx-1">
        <Sparkline data={spark} color={sparkColor} height={featured ? 48 : 32} />
      </div>
    </div>
  );
}
