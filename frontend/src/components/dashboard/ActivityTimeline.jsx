import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { apiFetch } from "../../api/client";

// Activity over time, by action. The previous version used grouped stacked
// bars in 10 colours; on a small dashboard tile that read as visual noise.
// We switched to a stacked area chart with subtle gradient fills — the
// trend (and the proportions) read at a glance, and the chip legend below
// gives the colour key without crowding the chart canvas.
//
// Palette is intentionally restrained: brand teal for the "headline" action
// (uploads), supportive cool colours for the rest. Less-common actions get
// pushed into an "Other" bucket so the stack doesn't get cluttered.

// The audit log has many raw action names but the dashboard is happier with a
// smaller set of buckets — collapse multipart variants under "UPLOAD",
// CORS/admin housekeeping into "OTHER", etc. The mapping is the single source
// of truth: change it once and the data, palette, and legend all follow.
const ACTION_BUCKET = {
  // Object I/O
  UPLOAD_OBJECT: "UPLOAD",
  COMPLETE_MULTIPART_UPLOAD: "UPLOAD",
  INIT_MULTIPART_UPLOAD: "UPLOAD",       // counts intent; the complete will too
  ABORT_MULTIPART_UPLOAD: "UPLOAD_ABORT",
  DOWNLOAD_OBJECT: "DOWNLOAD",
  DELETE_OBJECT: "DELETE",
  GENERATE_PRESIGNED_URL: "PRESIGN",
  // Bucket lifecycle
  CREATE_BUCKET: "BUCKET_NEW",
  DELETE_BUCKET: "BUCKET_DEL",
  SET_BUCKET_CORS: "ADMIN",
  // User admin
  CREATE_USER: "ADMIN",
  DELETE_USER: "ADMIN",
  RESYNC_RGW_USER: "ADMIN",
  IMPORT_ALL_RGW_USERS: "ADMIN",
  IMPORT_RGW_USER: "ADMIN",
};

const PRIMARY = ["UPLOAD", "DOWNLOAD", "DELETE"];
const SECONDARY = ["PRESIGN", "BUCKET_NEW", "BUCKET_DEL", "UPLOAD_ABORT", "ADMIN"];

const ACTION_COLORS = {
  UPLOAD: "#14b8a6",        // brand teal
  DOWNLOAD: "#6366f1",      // indigo
  DELETE: "#f43f5e",        // rose
  PRESIGN: "#06b6d4",       // cyan
  BUCKET_NEW: "#8b5cf6",    // violet
  BUCKET_DEL: "#fb7185",    // rose-light
  UPLOAD_ABORT: "#f59e0b",  // amber — visible but de-emphasised
  ADMIN: "#94a3b8",         // slate
  OTHER: "#cbd5e1",         // slate lighter
};

const PRETTY = {
  UPLOAD: "Uploads",
  DOWNLOAD: "Downloads",
  DELETE: "Deletes",
  PRESIGN: "Presigns",
  BUCKET_NEW: "Bucket +",
  BUCKET_DEL: "Bucket −",
  UPLOAD_ABORT: "Aborted",
  ADMIN: "Admin",
  OTHER: "Other",
};

function fillDays(rows, days) {
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
    if (!slot) continue;
    const bucket = ACTION_BUCKET[row.action] || "OTHER";
    slot[bucket] = (slot[bucket] || 0) + row.count;
  }
  return Array.from(map.values());
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  // Recharts hands payload in stacking order; reverse for legend-style
  // tooltip with the dominant series on top.
  const items = [...payload].reverse().filter(p => p.value);
  return (
    <div className="bg-white border border-gray-200 rounded-md shadow-md px-3 py-2 text-xs min-w-[150px]">
      <div className="font-medium text-gray-800">{label}</div>
      <div className="text-gray-400 mb-1.5">{total} event{total === 1 ? "" : "s"}</div>
      <div className="space-y-0.5">
        {items.map(it => (
          <div key={it.dataKey} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-gray-600">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: it.color }}
              />
              {PRETTY[it.dataKey] || it.dataKey}
            </span>
            <span className="font-medium text-gray-800">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendChips({ actions }) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {actions.map(a => (
        <span
          key={a}
          className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded-full"
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: ACTION_COLORS[a] || "#9ca3af" }}
          />
          {PRETTY[a] || a}
        </span>
      ))}
    </div>
  );
}

export default function ActivityTimeline({ isAdmin }) {
  const [days, setDays] = useState(14);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "activity", days, isAdmin],
    queryFn: () =>
      apiFetch(
        isAdmin
          ? `/api/admin/analytics/activity?days=${days}`
          : `/api/s3/activity?days=${days}`,
      ),
    refetchInterval: 60000,
  });

  const chartData = useMemo(
    () => fillDays(data?.series || [], days),
    [data, days],
  );

  // Stack order: PRIMARY first (so they sit on the bottom of the stack
  // visually, with smaller secondaries on top). Only render series that
  // actually have data in the window.
  const presentActions = useMemo(() => {
    const seen = new Set();
    for (const row of chartData) {
      for (const k of Object.keys(row)) if (k !== "day") seen.add(k);
    }
    return [...PRIMARY, ...SECONDARY, "OTHER"].filter(a => seen.has(a));
  }, [chartData]);

  // A stacked-area chart needs at least 2 days with data to actually look
  // like an area — with 1 non-empty day it collapses to a thin spike on the
  // edge and reads as broken. Detect that case and switch to grouped bars,
  // which render fine even with a single populated column.
  const populatedDays = useMemo(
    () => chartData.filter(row =>
      Object.keys(row).some(k => k !== "day" && row[k] > 0),
    ).length,
    [chartData],
  );
  const useBars = populatedDays <= 1;

  const totalEvents = chartData.reduce(
    (sum, row) =>
      sum +
      Object.entries(row).reduce(
        (s, [k, v]) => (k === "day" ? s : s + (v || 0)),
        0,
      ),
    0,
  );

  return (
    <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="m-0 text-base text-gray-900 font-semibold">
            Activity Timeline
          </h2>
          <p className="m-0 text-xs text-gray-400 mt-0.5">
            {totalEvents.toLocaleString()} events · last {days} days
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
        <div className="text-sm text-gray-400 italic py-16 text-center">
          Loading…
        </div>
      ) : presentActions.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-16 text-center">
          No activity in this window.
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              {useBars ? (
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                  barCategoryGap="30%"
                >
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
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: "#f8fafc" }}
                  />
                  {presentActions.map((a, i) => (
                    <Bar
                      key={a}
                      dataKey={a}
                      stackId="events"
                      fill={ACTION_COLORS[a] || "#94a3b8"}
                      // Rounded top on the last (top) series only — Recharts
                      // doesn't pad rounded corners through a stack.
                      radius={
                        i === presentActions.length - 1 ? [4, 4, 0, 0] : 0
                      }
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              ) : (
                <AreaChart
                  data={chartData}
                  margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                >
                  <defs>
                    {presentActions.map(a => {
                      const c = ACTION_COLORS[a] || "#94a3b8";
                      const id = `area-${a}`;
                      return (
                        <linearGradient
                          key={id}
                          id={id}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={c} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                        </linearGradient>
                      );
                    })}
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
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                  />
                  {presentActions.map(a => (
                    <Area
                      key={a}
                      type="monotone"
                      dataKey={a}
                      stackId="events"
                      stroke={ACTION_COLORS[a] || "#94a3b8"}
                      strokeWidth={1.5}
                      fill={`url(#area-${a})`}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          <LegendChips actions={presentActions} />
        </>
      )}
    </section>
  );
}
