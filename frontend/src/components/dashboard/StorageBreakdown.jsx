import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import { apiFetch } from "../../api/client";
import { formatBytes } from "../../utils/format";

// Top-N consumers chart. The previous version painted each bar a different
// colour from a 10-step rainbow — pretty in isolation, noisy on a dashboard
// next to two other charts. We use a single accent (brand teal) and let
// length carry the visual weight. Each row gets a percent-of-total chip in
// the tooltip and a byte-formatted label at the end of the bar.

const ACCENT = "#14b8a6";        // brand-500
const ACCENT_TINT = "#5eead4";   // brand-300, for the lighter "long tail" rows

function truncate(s, n = 24) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function TipBytes({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const pct = total > 0 ? (row.size / total) * 100 : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-3 py-2 text-xs">
      <div className="font-medium text-gray-800">{row.fullName}</div>
      <div className="text-gray-600 mt-0.5">
        {formatBytes(row.size)}
        <span className="text-gray-400 ml-1.5">· {pct.toFixed(1)}% of total</span>
      </div>
      {row.subtitle && (
        <div className="text-gray-400 mt-0.5">{row.subtitle}</div>
      )}
    </div>
  );
}

export default function StorageBreakdown({ isAdmin }) {
  const [mode, setMode] = useState("buckets"); // "buckets" | "users"

  const buckets = useQuery({
    queryKey: ["dashboard", "buckets", isAdmin],
    queryFn: () => apiFetch("/api/rgw/buckets"),
    refetchInterval: 60000,
  });

  const users = useQuery({
    queryKey: ["dashboard", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    refetchInterval: 60000,
    enabled: isAdmin && mode === "users",
  });

  let data = [];
  if (mode === "buckets") {
    data = (buckets.data?.buckets || [])
      .filter(b => (b.size_bytes || 0) > 0)
      .map(b => ({
        name: truncate(b.name),
        fullName: b.name,
        size: b.size_bytes || 0,
        subtitle: b.owner ? `owner: ${b.owner}` : null,
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
  } else {
    data = (users.data || [])
      .filter(u => (u.used_bytes || 0) > 0)
      .map(u => ({
        name: truncate(u.username),
        fullName: u.username,
        size: u.used_bytes || 0,
        subtitle: u.display_name || null,
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
  }

  const total = data.reduce((s, d) => s + d.size, 0);

  const heading = isAdmin
    ? mode === "buckets"
      ? "Top Buckets by Size"
      : "Top Users by Usage"
    : "Your Top Buckets";

  return (
    <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="m-0 text-base text-gray-900 font-semibold">{heading}</h2>
          <p className="m-0 text-xs text-gray-400 mt-0.5">
            {data.length > 0
              ? `${formatBytes(total)} across ${data.length} ${
                  mode === "users" ? "users" : "buckets"
                }`
              : "—"}
          </p>
        </div>
        {isAdmin && (
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs shrink-0">
            <button
              onClick={() => setMode("buckets")}
              className={`px-3 py-1.5 ${
                mode === "buckets"
                  ? "bg-brand-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Buckets
            </button>
            <button
              onClick={() => setMode("users")}
              className={`px-3 py-1.5 border-l border-gray-200 ${
                mode === "users"
                  ? "bg-brand-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Users
            </button>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-16 text-center">
          No usage data yet.
        </div>
      ) : (
        <div style={{ width: "100%", height: Math.max(220, data.length * 34 + 40) }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 80, bottom: 4, left: 4 }}
            >
              <defs>
                <linearGradient id="barAccent" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={1} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="2 4"
                horizontal={false}
                stroke="#f1f5f9"
              />
              <XAxis
                type="number"
                tickFormatter={v => formatBytes(v)}
                stroke="#cbd5e1"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#475569"
                fontSize={12}
                width={140}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={<TipBytes total={total} />}
                cursor={{ fill: "#f8fafc" }}
              />
              <Bar dataKey="size" radius={[0, 6, 6, 0]} barSize={18}>
                {data.map((_, i) => (
                  // Top 3 in the deep accent, rest in the lighter tint.
                  // Length still carries the comparison; the tint just
                  // de-emphasises the long tail without going monochrome.
                  <Cell key={i} fill={i < 3 ? "url(#barAccent)" : ACCENT_TINT} />
                ))}
                <LabelList
                  dataKey="size"
                  position="right"
                  formatter={v => formatBytes(v)}
                  style={{ fontSize: 11, fill: "#475569", fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
