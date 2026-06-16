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
} from "recharts";
import { apiFetch } from "../../api/client";
import { formatBytes } from "../../utils/format";

// Horizontal bar chart of the top-N consumers — buckets for everyone,
// or (admin only) toggled to users. Truncates long names so the y-axis
// stays readable; the full name is in the tooltip.
const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

function truncate(s, n = 24) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function TipBytes({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-sm px-3 py-2 text-xs">
      <div className="font-medium text-gray-800">{row.fullName}</div>
      <div className="text-gray-500">{formatBytes(row.size)}</div>
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
      .filter((b) => (b.size_bytes || 0) > 0)
      .map((b) => ({
        name: truncate(b.name),
        fullName: b.name,
        size: b.size_bytes || 0,
        subtitle: b.owner ? `owner: ${b.owner}` : null,
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
  } else {
    data = (users.data || [])
      .filter((u) => (u.used_bytes || 0) > 0)
      .map((u) => ({
        name: truncate(u.username),
        fullName: u.username,
        size: u.used_bytes || 0,
        subtitle: u.display_name || null,
      }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);
  }

  const heading = isAdmin
    ? mode === "buckets"
      ? "Top Buckets by Size"
      : "Top Users by Usage"
    : "Your Top Buckets";

  return (
    <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="m-0 text-lg text-gray-800 font-semibold">{heading}</h2>
        {isAdmin && (
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs">
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
        <div className="text-sm text-gray-400 italic py-12 text-center">
          No usage data yet.
        </div>
      ) : (
        <div style={{ width: "100%", height: Math.max(220, data.length * 32 + 40) }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis
                type="number"
                tickFormatter={(v) => formatBytes(v)}
                stroke="#9ca3af"
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#6b7280"
                fontSize={12}
                width={140}
              />
              <Tooltip content={<TipBytes />} cursor={{ fill: "#f9fafb" }} />
              <Bar dataKey="size" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
