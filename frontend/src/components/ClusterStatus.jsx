import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatPct(value) {
  if (value == null) return "—";
  return value.toFixed(1) + "%";
}

function ClusterStatus() {
  const [expandedSection, setExpandedSection] = useState(null);

  const { data: status, isLoading, error } = useQuery({
    queryKey: ["clusterStatus"],
    queryFn: () => apiFetch("/api/ceph/status"),
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="text-gray-500 italic py-4">Loading cluster status…</div>;
  if (error) return <div className="text-red-600 italic py-4">Error: {error.message}</div>;
  if (!status?.connected && !status?.data) return <div className="text-red-600 italic py-4">Disconnected: {status?.error}</div>;

  const d = status.data;
  const health = d.health || {};
  const df = d.df || {};
  const osdMap = d.osd_map || {};
  const osds = d.osds || [];
  const osdSummary = d.osd_summary || {};
  const pools = d.pools || [];
  const monitors = d.monitors || [];
  const clientPerf = d.client_perf || {};

  const healthClass =
    health.status === "HEALTH_OK" ? "border-l-green-500" :
    health.status === "HEALTH_WARN" ? "border-l-yellow-400" : "border-l-red-500";

  const healthBg =
    health.status === "HEALTH_OK" ? "bg-green-50" :
    health.status === "HEALTH_WARN" ? "bg-yellow-50" : "bg-red-50";

  const healthText =
    health.status === "HEALTH_OK" ? "text-green-700" :
    health.status === "HEALTH_WARN" ? "text-yellow-700" : "text-red-700";

  const statCards = [
    {
      label: "Health",
      value: health.status || "N/A",
      className: `border-l-4 ${healthClass} ${healthBg}`,
      valueClass: healthText,
    },
    {
      label: "OSDs",
      value: `${osdSummary.up || 0} / ${osdSummary.total || 0} up`,
      sub: `${osdSummary.in || 0} in`,
    },
    {
      label: "Monitors",
      value: monitors.length
        ? `${monitors.filter((m) => m.in_quorum).length}/${monitors.length} in quorum`
        : "?",
    },
    {
      label: "RGW",
      value: d.rgw ?? "?",
    },
    {
      label: "Hosts",
      value: d.hosts ?? "?",
    },
    {
      label: "Pools",
      value: pools.length || "?",
    },
  ];

  function toggleSection(section) {
    setExpandedSection(expandedSection === section ? null : section);
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className={`bg-gray-50 rounded-lg p-4 flex flex-col gap-1 ${card.className || ""}`}
          >
            <span className="text-xs uppercase tracking-wider text-gray-400">
              {card.label}
            </span>
            <span className={`text-lg font-semibold ${card.valueClass || "text-gray-800"}`}>
              {card.value}
            </span>
            {card.sub && <span className="text-sm text-gray-400">{card.sub}</span>}
          </div>
        ))}
      </div>

      {/* Storage & I/O row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded-lg p-4">
          <span className="text-xs uppercase tracking-wider text-gray-400 block mb-2">
            Storage
          </span>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>Total: <strong>{formatBytes(df.stats?.total_bytes)}</strong></span>
            <span>Used: <strong>{formatBytes(df.stats?.total_used_raw_bytes)}</strong></span>
            <span>Avail: <strong>{formatBytes(df.stats?.total_avail_bytes)}</strong></span>
            {df.stats?.total_used_raw_bytes != null && df.stats?.total_bytes != null && (
              <span>Usage: <strong>{formatPct((df.stats.total_used_raw_bytes / df.stats.total_bytes) * 100)}</strong></span>
            )}
          </div>
          {/* Storage bar */}
          {(df.stats?.total_used_raw_bytes != null && df.stats?.total_bytes != null) && (
            <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (df.stats.total_used_raw_bytes / df.stats.total_bytes) * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <span className="text-xs uppercase tracking-wider text-gray-400 block mb-2">
            Client I/O
          </span>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>Read: <strong>{formatBytes(clientPerf.read_bytes_sec)}/s</strong></span>
            <span>Write: <strong>{formatBytes(clientPerf.write_bytes_sec)}/s</strong></span>
            <span>Ops: <strong>{clientPerf.read_op_per_sec ?? 0}r / {clientPerf.write_op_per_sec ?? 0}w</strong></span>
          </div>
        </div>
      </div>

      {/* Expandable sections */}
      <div className="space-y-2">
        {/* OSD detail */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection("osds")}
            className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>OSD Detail ({osdSummary.total || 0} devices)</span>
            <span className={`transform transition-transform ${expandedSection === "osds" ? "rotate-180" : ""}`}>▼</span>
          </button>
          {expandedSection === "osds" && (
            <div className="p-4 max-h-80 overflow-y-auto">
              {osds.length === 0 && <p className="text-gray-500 text-sm italic">No OSD data</p>}
              {osds.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="pb-2 pr-3">ID</th>
                      <th className="pb-2 pr-3">Host</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Weight</th>
                      <th className="pb-2 pr-3">Size</th>
                      <th className="pb-2 pr-3">Used</th>
                      <th className="pb-2 pr-3">Util</th>
                    </tr>
                  </thead>
                  <tbody>
                    {osds.map((osd) => {
                      const up = osd.up;
                      const inCluster = osd.in;
                      const statusText = up ? (inCluster ? "up" : "up (out)") : (inCluster ? "down" : "down (out)");
                      const statusColor = up && inCluster ? "text-green-600" : up ? "text-yellow-600" : "text-red-600";
                      const totalBytes = osd.total_bytes || 0;
                      const usedBytes = osd.used_bytes || 0;
                      const utilText = osd.utilization != null ? osd.utilization.toFixed(1) : (totalBytes > 0 ? ((usedBytes / totalBytes) * 100).toFixed(1) : "—");
                      const host = osd.hostname || `osd.${osd.id}`;
                      return (
                        <tr key={osd.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-1.5 pr-3 font-mono">{osd.id}</td>
                          <td className="py-1.5 pr-3">{host}</td>
                          <td className={`py-1.5 pr-3 font-medium ${statusColor}`}>{statusText}</td>
                          <td className="py-1.5 pr-3">{osd.weight != null ? osd.weight.toFixed(2) : "—"}</td>
                          <td className="py-1.5 pr-3">{totalBytes > 0 ? formatBytes(totalBytes) : "—"}</td>
                          <td className="py-1.5 pr-3">{usedBytes > 0 ? formatBytes(usedBytes) : "—"}</td>
                          <td className="py-1.5 pr-3">{utilText}{utilText !== "—" ? "%" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Pool detail */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection("pools")}
            className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>Pools ({pools.length})</span>
            <span className={`transform transition-transform ${expandedSection === "pools" ? "rotate-180" : ""}`}>▼</span>
          </button>
          {expandedSection === "pools" && (
            <div className="p-4 max-h-80 overflow-y-auto">
              {pools.length === 0 && <p className="text-gray-500 text-sm italic">No pools</p>}
              {pools.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">PGS</th>
                      <th className="pb-2 pr-3">Replicas</th>
                      <th className="pb-2 pr-3">Used</th>
                      <th className="pb-2 pr-3">Objects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pools.map((pool) => (
                      <tr key={pool.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 font-medium">{pool.pool_name || pool.name}</td>
                        <td className="py-1.5 pr-3">{pool.pg_num || "—"}</td>
                        <td className="py-1.5 pr-3">{pool.size || "—"}</td>
                        <td className="py-1.5 pr-3">{pool.bytes_used > 0 ? formatBytes(pool.bytes_used) : "—"}</td>
                        <td className="py-1.5 pr-3">{(pool.objects || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Monitor detail */}
        {monitors.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection("mons")}
              className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span>Monitors ({monitors.length})</span>
              <span className={`transform transition-transform ${expandedSection === "mons" ? "rotate-180" : ""}`}>▼</span>
            </button>
            {expandedSection === "mons" && (
              <div className="p-4 max-h-80 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Rank</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Addr</th>
                      <th className="pb-2 pr-3">Elections</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monitors.map((m) => (
                      <tr key={m.name || m.rank} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 pr-3 font-medium">{m.name}</td>
                        <td className="py-1.5 pr-3">{m.rank ?? "—"}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`inline-flex items-center gap-1 ${
                            m.in_quorum || m.in_quroum ? "text-green-600" : "text-red-600"
                          }`}>
                            <span className={`w-2 h-2 rounded-full inline-block ${
                              m.in_quorum || m.in_quroum ? "bg-green-500" : "bg-red-500"
                            }`} />
                            {m.in_quorum || m.in_quroum ? "in quorum" : "out of quorum"}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-gray-500 text-xs">{m.public_addr || m.addr || "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{m.num_elections != null ? m.num_elections : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Health detail */}
        {health.checks && Object.keys(health.checks).length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection("health")}
              className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span>Health Checks</span>
              <span className={`transform transition-transform ${expandedSection === "health" ? "rotate-180" : ""}`}>▼</span>
            </button>
            {expandedSection === "health" && (
              <div className="p-4">
                <ul className="space-y-2">
                  {Object.entries(health.checks).map(([key, check]) => (
                    <li key={key} className="flex items-start gap-2 text-sm">
                      <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                        check.severity === "HEALTH_ERR" ? "bg-red-100 text-red-700" :
                        check.severity === "HEALTH_WARN" ? "bg-yellow-100 text-yellow-700" :
                        "bg-green-100 text-green-700"
                      }`}>
                        {check.severity?.replace("HEALTH_", "") || "OK"}
                      </span>
                      <span className="text-gray-700">{check.summary?.message || key}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ClusterStatus;
