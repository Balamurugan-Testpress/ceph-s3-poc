import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { apiFetch } from "../../api/client";
import { formatBytes, formatCompact } from "../../utils/format";

// Admin-only sortable table of users with per-row usage bars. Reuses the
// same table styling as AdminUsers so the dashboard doesn't introduce a new
// visual language for tabular data.
const COLUMNS = [
  { key: "username", label: "User", sortable: true },
  { key: "used_bytes", label: "Usage", sortable: true },
  { key: "bucket_count", label: "Buckets", sortable: true },
  { key: "share", label: "% of cluster", sortable: true },
  { key: "role", label: "Role", sortable: true },
];

export default function UsersUsageTable() {
  const [sortBy, setSortBy] = useState({ key: "used_bytes", dir: "desc" });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "users"],
    queryFn: () => apiFetch("/api/admin/users"),
    refetchInterval: 60000,
  });

  const users = data || [];
  const totalUsed = users.reduce((s, u) => s + (u.used_bytes || 0), 0) || 1;

  const enriched = useMemo(
    () =>
      users.map((u) => ({
        ...u,
        share: (u.used_bytes || 0) / totalUsed,
      })),
    [users, totalUsed]
  );

  const sorted = useMemo(() => {
    const copy = [...enriched];
    copy.sort((a, b) => {
      const av = a[sortBy.key];
      const bv = b[sortBy.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        return sortBy.dir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      return sortBy.dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [enriched, sortBy]);

  function toggleSort(key) {
    setSortBy((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
    );
  }

  return (
    <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <h2 className="m-0 text-lg text-gray-800 font-semibold">
          User Usage
        </h2>
        <span className="text-xs text-gray-400">
          {users.length} {users.length === 1 ? "user" : "users"}
        </span>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 italic py-6 text-center">
          Loading…
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-6 text-center">
          No users.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-gray-600 font-semibold border-b-2 border-gray-200">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="p-2 whitespace-nowrap">
                    {c.sortable ? (
                      <button
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 hover:text-gray-900"
                      >
                        {c.label}
                        <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const used = u.used_bytes || 0;
                const quota = u.quota_bytes;
                const isUnlimited = quota <= 0;
                const pct = isUnlimited ? 0 : Math.min(100, (used / quota) * 100);
                const barColor =
                  pct > 90
                    ? "bg-red-500"
                    : pct > 70
                    ? "bg-yellow-400"
                    : "bg-blue-500";
                return (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="p-2">
                      <div className="font-medium text-gray-800">
                        {u.username}
                      </div>
                      {u.display_name && (
                        <div className="text-xs text-gray-400">
                          {u.display_name}
                        </div>
                      )}
                    </td>
                    <td className="p-2 min-w-[180px]">
                      {!isUnlimited && (
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
                          <div
                            className={`h-full ${barColor} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">
                          {formatBytes(used)}
                        </span>{" "}
                        {isUnlimited ? (
                          <span className="text-gray-400 italic">no quota</span>
                        ) : (
                          <>/ {formatBytes(quota)}</>
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-gray-700">
                      {formatCompact(u.bucket_count ?? 0)}
                    </td>
                    <td className="p-2 text-gray-700">
                      {(u.share * 100).toFixed(1)}%
                    </td>
                    <td className="p-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
