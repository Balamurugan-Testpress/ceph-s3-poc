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

// Top-line KPI strip. Five tiles for admin (cluster-wide), four for tenant.
// All data is derived from endpoints we already had — only /activity is new.
export default function KpiTiles({ isAdmin }) {
  // Buckets: works for both admin (all) and tenant (own); shape is identical.
  const buckets = useQuery({
    queryKey: ["dashboard", "buckets", isAdmin],
    queryFn: () => apiFetch("/api/rgw/buckets"),
    refetchInterval: 30000,
  });

  // Cluster status — admin only. The endpoint is admin-readable in practice,
  // but tenant doesn't need it for personal KPIs.
  const cluster = useQuery({
    queryKey: ["dashboard", "cluster"],
    queryFn: () => apiFetch("/api/ceph/status"),
    refetchInterval: 30000,
    enabled: isAdmin,
  });

  // Admin: full user list (carries used_bytes / quota_bytes / role).
  const users = useQuery({
    queryKey: ["dashboard", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    refetchInterval: 60000,
    enabled: isAdmin,
  });

  // Tenant: personal usage/quota.
  const usage = useQuery({
    queryKey: ["dashboard", "usage"],
    queryFn: () => apiFetch("/api/s3/usage"),
    refetchInterval: 30000,
    enabled: !isAdmin,
  });

  // 24h activity count — uses the right endpoint for the role.
  const activity = useQuery({
    queryKey: ["dashboard", "activity24h", isAdmin],
    queryFn: () =>
      apiFetch(
        isAdmin
          ? "/api/admin/analytics/activity?days=1"
          : "/api/s3/activity?days=1"
      ),
    refetchInterval: 60000,
  });

  const totalActivity = (activity.data?.series || []).reduce(
    (sum, row) => sum + (row.count || 0),
    0
  );

  const bucketList = buckets.data?.buckets || [];
  const totalBucketBytes = bucketList.reduce(
    (s, b) => s + (b.size_bytes || 0),
    0
  );
  const totalObjects = bucketList.reduce(
    (s, b) => s + (b.object_count || 0),
    0
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
            ? "text-red-600"
            : utilPct > 70
            ? "text-yellow-600"
            : "text-green-600",
      },
      {
        label: "Activity (24h)",
        value: formatCompact(totalActivity),
        sub: "audit-log events",
        icon: Activity,
      }
    );
  } else {
    const used = usage.data?.used_bytes ?? 0;
    const quota = usage.data?.quota_bytes ?? 0;
    const isUnlimited = quota <= 0;
    const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
    const accent = isUnlimited
      ? "text-gray-700"
      : pct > 90
      ? "text-red-600"
      : pct > 70
      ? "text-yellow-600"
      : "text-gray-800";

    tiles.push(
      {
        label: "My Storage",
        value: formatBytes(used),
        sub: isUnlimited ? "no quota" : `of ${formatBytes(quota)} (${pct.toFixed(0)}%)`,
        icon: HardDrive,
        accent,
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
      {
        label: "Activity (24h)",
        value: formatCompact(totalActivity),
        sub: "your events",
        icon: Activity,
      }
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="bg-white rounded-lg p-4 shadow-sm border border-gray-100 flex flex-col gap-1"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-gray-400">
              {t.label}
            </span>
            {t.icon && <t.icon className="w-4 h-4 text-gray-300" />}
          </div>
          <span className={`text-xl font-semibold ${t.accent || "text-gray-800"}`}>
            {t.value}
          </span>
          {t.sub && <span className="text-xs text-gray-400">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}
