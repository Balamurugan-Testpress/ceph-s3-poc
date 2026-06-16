import { useRef, useState } from "react";
import { useUploads } from "../context/UploadsContext";
import { formatBytes } from "../utils/format";

function statusLabel(u) {
  switch (u.status) {
    case "done":       return "Uploaded";
    case "error":      return u.error || "Failed";
    case "cancelled":  return "Cancelled";
    case "finalizing": return `Finalizing on server… · ${formatBytes(u.total)}`;
    case "paused": {
      const pct = u.total ? Math.floor((u.loaded / u.total) * 100) : 0;
      return `Paused · ${pct}% · ${formatBytes(u.loaded)} / ${formatBytes(u.total)}`;
    }
    default: {
      // Clamp at 99% — the bar only represents bytes-sent-by-browser, but the
      // server still has work to do after that (forward to RGW, audit log).
      // Showing 100% while we wait for the server to confirm would lie.
      const rawPct = u.total ? (u.loaded / u.total) * 100 : 0;
      const pct = Math.min(99, Math.floor(rawPct));
      return `${pct}% · ${formatBytes(u.loaded)} / ${formatBytes(u.total)}`;
    }
  }
}

function barColor(status) {
  if (status === "done")       return "bg-green-500";
  if (status === "error")      return "bg-red-500";
  if (status === "cancelled")  return "bg-gray-400";
  if (status === "finalizing") return "bg-blue-400";
  if (status === "paused")     return "bg-amber-500";
  return "bg-blue-500";
}

export default function UploadsTray() {
  const {
    uploads,
    cancel,
    pause,
    resume,
    resumeOrphan,
    dismiss,
    clearFinished,
  } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  // One <input> per orphan row — re-picking the file is the only way to
  // resume after a reload (we can't persist a File handle in IndexedDB).
  const fileInputs = useRef({});

  if (uploads.length === 0) return null;

  const active = uploads.filter(
    u => u.status === "uploading" || u.status === "finalizing",
  ).length;
  const finishedCount = uploads.length - active;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[95vw] bg-white rounded-lg shadow-xl border border-gray-200">
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-200 cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="text-sm font-medium text-gray-800">
          {active > 0 ? `Uploading ${active}` : "Uploads"}
          {finishedCount > 0 && (
            <span className="ml-1 text-xs text-gray-400">
              ({finishedCount} finished)
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {finishedCount > 0 && (
            <button
              onClick={e => { e.stopPropagation(); clearFinished(); }}
              title="Clear finished"
              className="text-xs text-gray-400 hover:text-gray-700 px-1"
            >
              Clear
            </button>
          )}
          <span className="text-gray-400 text-xs">{collapsed ? "▲" : "▼"}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
          {uploads.map(u => {
            const rawPct = u.total ? (u.loaded / u.total) * 100 : 0;
            // While uploading, cap visual width at 99% so the bar can't reach
            // the end before the server confirms. Finalizing renders a full
            // pulsing bar; done snaps to 100%.
            const pct =
              u.status === "done" ? 100
              : u.status === "finalizing" ? 100
              : Math.min(99, rawPct);
            const isMultipart = u.engine === "multipart";
            const isInFlight =
              u.status === "uploading" || u.status === "finalizing";
            return (
              <div key={u.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono text-gray-800 truncate" title={u.key}>
                      {u.key}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {u.bucket} · {statusLabel(u)}
                      {isMultipart && u.parts?.total > 0 && (
                        <span className="ml-1">
                          · part {u.parts.done}/{u.parts.total}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Pause — only for in-flight multipart */}
                    {isMultipart && u.status === "uploading" && (
                      <button
                        onClick={() => pause(u.id)}
                        title="Pause"
                        className="text-xs text-amber-600 hover:text-amber-800 px-1"
                      >
                        ❚❚
                      </button>
                    )}
                    {/* Resume — paused, with file already in memory (not an orphan) */}
                    {isMultipart && u.status === "paused" && !u.orphan && (
                      <button
                        onClick={() => resume(u.id)}
                        title="Resume"
                        className="text-xs text-blue-600 hover:text-blue-800 px-1"
                      >
                        ▶
                      </button>
                    )}
                    {/* Resume orphan — needs the user to re-pick the file */}
                    {isMultipart && u.status === "paused" && u.orphan && (
                      <>
                        <button
                          onClick={() => fileInputs.current[u.id]?.click()}
                          title={`Re-pick "${u.fileName}" to resume`}
                          className="text-xs text-blue-600 hover:text-blue-800 px-1"
                        >
                          ▶ pick file
                        </button>
                        <input
                          ref={el => { fileInputs.current[u.id] = el; }}
                          type="file"
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) resumeOrphan(u.id, f);
                            e.target.value = "";
                          }}
                        />
                      </>
                    )}
                    {isInFlight || u.status === "paused" ? (
                      <button
                        onClick={() => cancel(u.id)}
                        title="Cancel"
                        className="text-xs text-red-500 hover:text-red-700 px-1"
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        onClick={() => dismiss(u.id)}
                        title="Dismiss"
                        className="text-xs text-gray-400 hover:text-gray-700 px-1"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full ${barColor(u.status)} transition-all duration-150 ${
                      u.status === "finalizing" ? "animate-pulse" : ""
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
