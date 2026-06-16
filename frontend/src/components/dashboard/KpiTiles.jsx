import { useQuery } from "@tanstack/react-query";
import {
  HardDrive,
  Files,
  Database,
  Users as UsersIcon,
  Activity,
  Gauge,
} from "lucide-react";
import { apiFetch } from "../../api/client";
import { formatBytes, formatCompact } from "../../utils/format";
import KpiTile from "./KpiTile";

// Visual hierarchy for the KPI strip: a couple of "featured" tiles span two
// columns and show prominent sparklines; the rest sit in a single column.
//
// The 7d activity series feeds two sparklines (the Activity tile and any
// derived ones). Storage doesn't have a true historical series in the
// backend yet — we derive a coarse 7-point trend from upload/delete audit
// events so the sparkline carries some signal until a real time-series is
// added.

// Build a series of length `days` containing one number per day (today last).
function fillDays(rows, days) {
  const map = new Map();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of rows || []) {
    if (!row.day || !map.has(row.day)) continue;
    map.set(row.day, (map.get(row.day) || 0) + (row.count || 0));
  }
  return Array.from(map.values());
}

// Reconstruct a coarse "storage over time" from audit-log uploads/deletes.
// This isn't exact (we don't carry sizes in the audit details for deletes),
// but the shape is right for a sparkline: shows daily activity-driven growth.
function uploadsSeries(rows, days) {
  const map = new Map();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of rows || []) {
    if (!row.day || !map.has(row.day)) continue;
    if (row.action === "UPLOAD_OBJECT" || row.action === "COMPLETE_MULTIPART_UPLOAD") {
      map.set(row.day, (map.get(row.day) || 0) + (row.count || 0));
    }
  }
  // Convert daily uploads to a running total so the sparkline looks like growth.
  const arr = Array.from(map.values());
  let acc = 0;
  return arr.map(v => (acc += v));
}

// Week-over-week comparison from a 14d series → percentage change of the
// latter 7 days vs the prior 7. Returns {delta, label} or null.
function weekOverWeek(series14) {
  if (!series14 || series14.length < 14) return null;
  const prev = series14.slice(0, 7).reduce((a, b) => a + b, 0);
  const curr = series14.slice(7).reduce((a, b) => a + b, 0);
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return { delta: 1, label: "new", title: `${curr} vs 0 last week` };
  const pct = ((curr - prev) / prev) * 100;
  return {
    delta: Math.sign(curr - prev),
    label: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% wk`,
    title: `${curr} this week vs ${prev} last week`,
  };
}

export default function KpiTiles({ isAdmin }) {
  const buckets = useQuery({
    queryKey: ["dashboard", "buckets", isAdmin],
    queryFn: () => apiFetch("/api/rgw/buckets"),
    refetchInterval: 30000,
  });

  const cluster = useQuery({
    queryKey: ["dashboard", "cluster"],
    queryFn: () => apiFetch("/api/ceph/status"),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  const users = useQuery({
    queryKey: ["dashboard", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    refetchInterval: 60000,
    enabled: isAdmin,
  });

  const usage = useQuery({
    queryKey: ["dashboard", "usage"],
    queryFn: () => apiFetch("/api/s3/usage"),
    refetchInterval: 30000,
    enabled: !isAdmin,
  });

  // 14d series powers both the sparklines and the WoW delta chip.
  const activity14 = useQuery({
    queryKey: ["dashboard", "activity14d", isAdmin],
    queryFn: () =>
      apiFetch(
        isAdmin
          ? "/api/admin/analytics/activity?days=14"
          : "/api/s3/activity?days=14",
      ),
    refetchInterval: 60000,
  });

  const series14 = fillDays(activity14.data?.series, 14);
  const series7 = series14.slice(-7);
  const uploads7 = uploadsSeries(activity14.data?.series, 14).slice(-7);
  const last24h = series14[series14.length - 1] || 0;
  const trend = weekOverWeek(series14);

  const bucketList = buckets.data?.buckets || [];
  const totalBucketBytes = bucketList.reduce(
    (s, b) => s + (b.size_bytes || 0),
    0,
  );
  const totalObjects = bucketList.reduce(
    (s, b) => s + (b.object_count || 0),
    0,
  );

  const tiles = [];

  if (isAdmin) {
    const df = cluster.data?.data?.df?.stats || {};
    const utilPct =
      df.total_bytes && df.total_used_raw_bytes != null
        ? (df.total_used_raw_bytes / df.total_bytes) * 100
        : null;

    tiles.push(
      {
        label: "Storage Used",
        value: formatBytes(totalBucketBytes),
        sub: df.total_bytes ? `of ${formatBytes(df.total_bytes)} raw` : null,
        icon: HardDrive,
        spark: uploads7,
        sparkColor: "#14b8a6",
        featured: true,
      },
      {
        label: "Activity (24h)",
        value: formatCompact(last24h),
        sub: "audit-log events",
        icon: Activity,
        spark: series7,
        sparkColor: "#6366f1",
        trend,
        featured: true,
      },
      {
        label: "Objects",
        value: formatCompact(totalObjects),
        sub: `${formatCompact(bucketList.length)} buckets`,
        icon: Files,
      },
      {
        label: "Buckets",
        value: formatCompact(bucketList.length),
        icon: Database,
      },
      {
        label: "Users",
        value: formatCompact((users.data || []).length),
        icon: UsersIcon,
      },
      {
        label: "Cluster Util",
        value: utilPct != null ? utilPct.toFixed(1) + "%" : "—",
        sub: df.total_avail_bytes ? `${formatBytes(df.total_avail_bytes)} free` : null,
        icon: Gauge,
        accent:
          utilPct == null
            ? null
            : utilPct > 85
            ? "text-rose-600"
            : utilPct > 70
            ? "text-amber-600"
            : "text-emerald-600",
      },
    );
  } else {
    const used = usage.data?.used_bytes ?? 0;
    const quota = usage.data?.quota_bytes ?? 0;
    const isUnlimited = quota <= 0;
    const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
    const accent = isUnlimited
      ? "text-gray-900"
      : pct > 90
      ? "text-rose-600"
      : pct > 70
      ? "text-amber-600"
      : "text-gray-900";

    tiles.push(
      {
        label: "My Storage",
        value: formatBytes(used),
        sub: isUnlimited
          ? "no quota"
          : `of ${formatBytes(quota)} · ${pct.toFixed(0)}%`,
        icon: HardDrive,
        accent,
        spark: uploads7,
        sparkColor: "#14b8a6",
        featured: true,
      },
      {
        label: "Activity (24h)",
        value: formatCompact(last24h),
        sub: "your events",
        icon: Activity,
        spark: series7,
        sparkColor: "#6366f1",
        trend,
        featured: true,
      },
      {
        label: "My Objects",
        value: formatCompact(totalObjects),
        icon: Files,
      },
      {
        label: "My Buckets",
        value: formatCompact(bucketList.length),
        icon: Database,
      },
    );
  }

  // 6-col grid: featured tiles span 2 each, secondaries take 1.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
      {tiles.map(t => (
        <KpiTile key={t.label} {...t} />
      ))}
    </div>
  );
}
