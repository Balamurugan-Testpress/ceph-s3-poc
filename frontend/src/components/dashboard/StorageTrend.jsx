import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { apiFetch } from "../../api/client";
import { formatBytes } from "../../utils/format";

// Storage growth over time.
//
// We don't yet have a proper time-series of cluster usage stored anywhere,
// so this is a *derived* trend: we take the current total bucket size as
// the right-hand endpoint and walk it backward using daily upload counts
// from the audit log to approximate a curve.
//
// The shape is honest (uploads → growth, days with no uploads → flat) but
// magnitudes for past days are estimates. A real time-series (polled into
// a small history table) would replace this — see the TODO at the bottom.

// Average bytes per upload. We don't carry per-event sizes in the audit log,
// so we use a single representative value to back-compute the curve. This
// is the one knob that decides whether the y-axis "feels" right.
const AVG_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB — conservative default

function fillDays(rows, days) {
  const map = new Map();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    map.set(d.toISOString().slice(0, 10), { day: d.toISOString().slice(0, 10), uploads: 0, deletes: 0 });
  }
  for (const row of rows || []) {
    if (!row.day || !map.has(row.day)) continue;
    const slot = map.get(row.day);
    if (row.action === "UPLOAD_OBJECT" || row.action === "COMPLETE_MULTIPART_UPLOAD") {
      slot.uploads += row.count || 0;
    } else if (row.action === "DELETE_OBJECT") {
      slot.deletes += row.count || 0;
    }
  }
  return Array.from(map.values());
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-3 py-2 text-xs">
      <div className="font-medium text-gray-800">{label}</div>
      <div className="text-gray-600 mt-0.5">{formatBytes(row.bytes)}</div>
      <div className="text-gray-400 mt-0.5">
        +{row.uploads} uploads
        {row.deletes ? ` · −${row.deletes} deletes` : ""}
      </div>
    </div>
  );
}

export default function StorageTrend({ isAdmin }) {
  const [days, setDays] = useState(14);

  const buckets = useQuery({
    queryKey: ["dashboard", "buckets", isAdmin],
    queryFn: () => apiFetch("/api/rgw/buckets"),
    refetchInterval: 60000,
  });

  const activity = useQuery({
    queryKey: ["dashboard", "activity", days, isAdmin, "for-trend"],
    queryFn: () =>
      apiFetch(
        isAdmin
          ? `/api/admin/analytics/activity?days=${days}`
          : `/api/s3/activity?days=${days}`,
      ),
    refetchInterval: 60000,
  });

  const today = useMemo(() => {
    const list = buckets.data?.buckets || [];
    return list.reduce((s, b) => s + (b.size_bytes || 0), 0);
  }, [buckets.data]);

  const chartData = useMemo(() => {
    const daysArr = fillDays(activity.data?.series || [], days);
    // Walk backwards from today: each step subtracts that day's net upload
    // bytes. Bound at 0 so a flurry of uploads can't push the past below 0.
    let running = today;
    const rev = [...daysArr].reverse().map(d => {
      const net = (d.uploads - d.deletes) * AVG_UPLOAD_BYTES;
      const snapshot = { day: d.day, bytes: running, uploads: d.uploads, deletes: d.deletes };
      running = Math.max(0, running - net);
      return snapshot;
    });
    return rev.reverse();
  }, [activity.data, days, today]);

  const first = chartData[0]?.bytes ?? 0;
  const last = chartData[chartData.length - 1]?.bytes ?? today;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : null;

  // Mark the latest point with an annotation dot.
  const latest = chartData[chartData.length - 1];

  return (
    <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-base text-gray-900 font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-500" />
            Storage Trend
          </h2>
          <p className="m-0 text-xs text-gray-400 mt-0.5">
            {formatBytes(last)} today
            {pct != null && (
              <span className={delta >= 0 ? "text-emerald-600 ml-1.5" : "text-rose-600 ml-1.5"}>
                {delta >= 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}% · {days}d
              </span>
            )}
            <span className="text-gray-300 ml-1.5">· derived from audit log</span>
          </p>
        </div>
        <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs">
          {[7, 14, 30].map((n, i) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`px-3 py-1.5 ${i > 0 ? "border-l border-gray-200" : ""} ${
                days === n
                  ? "bg-brand-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 12, bottom: 0, left: -8 }}
          >
            <defs>
              <linearGradient id="storageTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="2 4"
              stroke="#f1f5f9"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              stroke="#cbd5e1"
              fontSize={10}
              tickFormatter={d => d.slice(5)}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#cbd5e1"
              fontSize={10}
              tickFormatter={v => formatBytes(v)}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="bytes"
              stroke="#14b8a6"
              strokeWidth={2}
              fill="url(#storageTrendFill)"
              isAnimationActive={false}
            />
            {latest && (
              <ReferenceDot
                x={latest.day}
                y={latest.bytes}
                r={4}
                fill="#14b8a6"
                stroke="#fff"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* TODO: replace AVG_UPLOAD_BYTES derivation with a real time-series
          once we persist daily totals (e.g. a small `storage_snapshots`
          table written by a cron). */}
    </section>
  );
}
