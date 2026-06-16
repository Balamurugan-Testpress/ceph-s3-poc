import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiFetch } from "../../api/client";

// Stacked bar chart of audit-log events. The backend returns long-form rows
// {day, action, count} — we pivot them client-side into the wide shape Recharts
// expects ({day, UPLOAD_OBJECT: N, DOWNLOAD_OBJECT: M, ...}). Days with zero
// activity get filled in so the x-axis stays continuous.
const ACTION_COLORS = {
  UPLOAD_OBJECT: "#3b82f6",
  DOWNLOAD_OBJECT: "#10b981",
  DELETE_OBJECT: "#ef4444",
  GENERATE_PRESIGNED_URL: "#06b6d4",
  CREATE_BUCKET: "#8b5cf6",
  DELETE_BUCKET: "#f43f5e",
  CREATE_USER: "#f59e0b",
  DELETE_USER: "#dc2626",
  RESYNC_RGW_USER: "#facc15",
  IMPORT_ALL_RGW_USERS: "#a3a3a3",
};

const PRETTY = {
  UPLOAD_OBJECT: "Uploads",
  DOWNLOAD_OBJECT: "Downloads",
  DELETE_OBJECT: "Deletes",
  GENERATE_PRESIGNED_URL: "Presigns",
  CREATE_BUCKET: "Bucket+",
  DELETE_BUCKET: "Bucket−",
  CREATE_USER: "User+",
  DELETE_USER: "User−",
  RESYNC_RGW_USER: "Resync",
  IMPORT_ALL_RGW_USERS: "Import",
};

function fillDays(rows, days) {
  // Build a YYYY-MM-DD index of every day in the window; merge counts in.
  const map = new Map();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { day: key });
  }
  for (const row of rows) {
    if (!row.day) continue;
    const slot = map.get(row.day);
    if (!slot) continue; // older than our window (date_trunc rounding edge case)
    slot[row.action] = (slot[row.action] || 0) + row.count;
  }
  return Array.from(map.values());
}

export default function ActivityTimeline({ isAdmin }) {
  const [days, setDays] = useState(14);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "activity", days, isAdmin],
    queryFn: () =>
      apiFetch(
        isAdmin
          ? `/api/admin/analytics/activity?days=${days}`
          : `/api/s3/activity?days=${days}`
      ),
    refetchInterval: 60000,
  });

  const chartData = useMemo(
    () => fillDays(data?.series || [], days),
    [data, days]
  );

  // Discover which action types are actually present so we only render
  // bars (and a legend entry) for the ones that occurred.
  const presentActions = useMemo(() => {
    const seen = new Set();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== "day") seen.add(k);
      }
    }
    // Preserve a stable visual order matching ACTION_COLORS declaration.
    return Object.keys(ACTION_COLORS).filter((a) => seen.has(a));
  }, [chartData]);

  const totalEvents = chartData.reduce(
    (sum, row) =>
      sum + Object.entries(row).reduce(
        (s, [k, v]) => (k === "day" ? s : s + (v || 0)),
        0
      ),
    0
  );

  return (
    <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="m-0 text-lg text-gray-800 font-semibold">
            Activity Timeline
          </h2>
          <p className="m-0 text-sm text-gray-500 mt-0.5">
            {totalEvents.toLocaleString()} events in the last {days} days
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

      {isLoading ? (
        <div className="text-sm text-gray-400 italic py-12 text-center">
          Loading…
        </div>
      ) : presentActions.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-12 text-center">
          No activity in this window.
        </div>
      ) : (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="#9ca3af"
                fontSize={11}
                tickFormatter={(d) => d.slice(5)} /* MM-DD */
              />
              <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                }}
                formatter={(value, name) => [value, PRETTY[name] || name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(name) => PRETTY[name] || name}
              />
              {presentActions.map((a) => (
                <Bar
                  key={a}
                  dataKey={a}
                  stackId="events"
                  fill={ACTION_COLORS[a] || "#9ca3af"}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
