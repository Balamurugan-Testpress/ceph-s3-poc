// Global upload queue. Lives in the Layout so an upload survives navigating
// between pages — the user can kick off a large upload from BucketExplorer
// then go look at audit logs while it runs.
//
// Two engines, chosen by file size:
//
//   • < 16 MiB  →  single POST through the API (uploadWithProgress). Cheap,
//                  cancels by aborting the XHR; cancel-after-bytes-landed
//                  triggers a compensating DELETE.
//   • ≥ 16 MiB  →  presigned multipart direct to RGW (startResumableUpload).
//                  Supports pause/resume across reloads via IndexedDB.
//
// Each item in `uploads`:
//   { id, bucket, key, file, status, loaded, total, error, engine,
//     parts: { done, total }, fingerprint? }
//   status: 'uploading' | 'paused' | 'finalizing' | 'done' | 'error' | 'cancelled'
//   engine: 'single' | 'multipart'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { uploadWithProgress } from "../api/upload";
import {
  MULTIPART_THRESHOLD,
  fingerprintFor,
  startResumableUpload,
} from "../api/uploadResumable";
import { deleteSession, listSessions } from "../api/idb";
import { apiFetch } from "../api/client";

const UploadsContext = createContext(null);

function reducer(state, action) {
  switch (action.type) {
    case "enqueue":
      return [...state, action.item];
    case "progress":
      // Once the browser has sent every byte, we're not really "uploading"
      // any more — we're waiting for the server to finish forwarding to RGW
      // and write the audit row. Surface that as a distinct state so the bar
      // doesn't sit at 100% looking stuck.
      return state.map(u => {
        if (u.id !== action.id) return u;
        const isComplete = action.total > 0 && action.loaded >= action.total;
        const nextStatus =
          isComplete && u.status === "uploading" && u.engine === "single"
            ? "finalizing"
            : u.status;
        return {
          ...u,
          loaded: action.loaded,
          total: action.total,
          status: nextStatus,
        };
      });
    case "parts":
      return state.map(u =>
        u.id === action.id
          ? { ...u, parts: { done: action.done, total: action.total } }
          : u,
      );
    case "status":
      return state.map(u =>
        u.id === action.id ? { ...u, status: action.status } : u,
      );
    case "done":
      return state.map(u =>
        u.id === action.id ? { ...u, status: "done", loaded: u.total } : u,
      );
    case "error":
      return state.map(u =>
        u.id === action.id ? { ...u, status: "error", error: action.error } : u,
      );
    case "cancelled":
      return state.map(u =>
        u.id === action.id ? { ...u, status: "cancelled" } : u,
      );
    case "dismiss":
      return state.filter(u => u.id !== action.id);
    case "clearFinished":
      return state.filter(
        u =>
          u.status === "uploading" ||
          u.status === "finalizing" ||
          u.status === "paused",
      );
    default:
      return state;
  }
}

export function UploadsProvider({ children }) {
  const [uploads, dispatch] = useReducer(reducer, []);
  // Non-serialisable handles — controllers, XHRs, callbacks — live outside
  // reducer state so they don't trip React's snapshot machinery.
  const xhrs = useRef(new Map());
  const multipartCtls = useRef(new Map());
  // Tracks ids the user clicked Cancel on for the single-PUT path. We can't
  // rely on the xhr's abort event alone: if abort fires after the server
  // already returned its final response, the load event runs instead and we'd
  // think the upload succeeded. We mark cancellation here and, on load of a
  // cancelled upload, fire a compensating DELETE so the object doesn't linger.
  const cancelled = useRef(new Set());
  const completionListeners = useRef(new Set());

  const onComplete = useCallback((cb) => {
    completionListeners.current.add(cb);
    return () => completionListeners.current.delete(cb);
  }, []);

  function fireCompletion(bucket, key) {
    completionListeners.current.forEach(cb => {
      try { cb({ bucket, key }); } catch { /* ignore */ }
    });
  }

  // ── Single-PUT engine (small files, unchanged behaviour) ─────────────
  function enqueueSingle(id, bucket, file) {
    const { promise, xhr } = uploadWithProgress(
      `/api/s3/buckets/${bucket}/upload`,
      file,
      {
        onProgress: (loaded, total) =>
          dispatch({ type: "progress", id, loaded, total }),
      },
    );
    xhrs.current.set(id, xhr);

    promise
      .then(() => {
        if (cancelled.current.has(id)) {
          dispatch({ type: "cancelled", id });
          apiFetch(
            `/api/rgw/buckets/${bucket}/objects/${encodeURI(file.name)}`,
            { method: "DELETE" },
          ).catch(() => { /* best-effort; nothing the user can do */ });
          return;
        }
        dispatch({ type: "done", id });
        fireCompletion(bucket, file.name);
      })
      .catch(err => {
        if (err?.name === "AbortError") {
          dispatch({ type: "cancelled", id });
        } else {
          dispatch({ type: "error", id, error: err.message || String(err) });
        }
      })
      .finally(() => {
        xhrs.current.delete(id);
        cancelled.current.delete(id);
      });
  }

  // ── Multipart engine (large files, presigned direct-to-RGW) ───────────
  function enqueueMultipart(id, bucket, file, fingerprint) {
    const ctl = startResumableUpload({
      bucket,
      file,
      fingerprint,
      onProgress: (loaded, total) =>
        dispatch({ type: "progress", id, loaded, total }),
      onParts: (done, total) =>
        dispatch({ type: "parts", id, done, total }),
    });
    multipartCtls.current.set(id, ctl);

    ctl.promise
      .then(() => {
        dispatch({ type: "done", id });
        fireCompletion(bucket, file.name);
      })
      .catch(err => {
        if (err?.name === "AbortError") {
          dispatch({ type: "cancelled", id });
        } else {
          dispatch({ type: "error", id, error: err.message || String(err) });
        }
      })
      .finally(() => {
        multipartCtls.current.delete(id);
      });
  }

  const enqueue = useCallback((bucket, file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const engine = file.size >= MULTIPART_THRESHOLD ? "multipart" : "single";
    const fingerprint =
      engine === "multipart" ? fingerprintFor(bucket, file) : null;
    const item = {
      id,
      bucket,
      key: file.name,
      file,
      status: "uploading",
      loaded: 0,
      total: file.size,
      error: null,
      engine,
      parts: { done: 0, total: 0 },
      fingerprint,
    };
    dispatch({ type: "enqueue", item });

    if (engine === "single") {
      enqueueSingle(id, bucket, file);
    } else {
      enqueueMultipart(id, bucket, file, fingerprint);
    }
    return id;
  }, []);

  const cancel = useCallback((id) => {
    const ctl = multipartCtls.current.get(id);
    if (ctl) {
      ctl.cancel();
      return;
    }
    // Orphan row resurfaced from IndexedDB on reload — no controller exists.
    // Best-effort abort against RGW and drop the local row.
    const orphan = uploads.find(u => u.id === id && u.orphan);
    if (orphan) {
      apiFetch("/api/multipart/abort", {
        method: "POST",
        body: JSON.stringify({
          bucket: orphan.bucket,
          key: orphan.key,
          // We don't carry uploadId on the row right now; abort by re-using
          // the session record we stored.
          upload_id: orphan.uploadId || "",
        }),
      }).catch(() => {});
      deleteSession(orphan.fingerprint).catch(() => {});
      dispatch({ type: "cancelled", id });
      return;
    }
    cancelled.current.add(id);
    const xhr = xhrs.current.get(id);
    if (xhr) xhr.abort();
  }, [uploads]);

  const pause = useCallback((id) => {
    const ctl = multipartCtls.current.get(id);
    if (!ctl) return;
    ctl.pause();
    dispatch({ type: "status", id, status: "paused" });
  }, []);

  const resume = useCallback((id) => {
    const ctl = multipartCtls.current.get(id);
    if (ctl) {
      ctl.resume();
      dispatch({ type: "status", id, status: "uploading" });
    }
  }, []);

  // Resume an orphan row found in IndexedDB. The user re-picks the file (we
  // can't persist a File handle across reloads), and we pass the same
  // fingerprint so the engine attaches to the existing upload id.
  const resumeOrphan = useCallback((orphanId, file) => {
    const orphan = uploads.find(u => u.id === orphanId);
    if (!orphan) return;
    // Sanity check: did the user pick the same file? Same fingerprint inputs
    // (name, size, lastModified, bucket) must produce the same fingerprint.
    const fp = fingerprintFor(orphan.bucket, file);
    if (fp !== orphan.fingerprint) {
      dispatch({
        type: "error",
        id: orphanId,
        error: "Picked file doesn't match the paused upload",
      });
      return;
    }
    dispatch({ type: "status", id: orphanId, status: "uploading" });
    enqueueMultipart(orphanId, orphan.bucket, file, orphan.fingerprint);
  }, [uploads]);

  const dismiss = useCallback((id) => {
    dispatch({ type: "dismiss", id });
  }, []);

  const clearFinished = useCallback(() => {
    dispatch({ type: "clearFinished" });
  }, []);

  // On mount, surface any orphan multipart sessions found in IndexedDB as
  // `paused` rows so the user knows there's an upload waiting for them.
  // We don't auto-resume — the browser has no File handle, so the user must
  // re-pick the file from disk via the UploadsTray.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sessions = await listSessions();
        if (cancelled || !sessions.length) return;
        for (const s of sessions) {
          const loadedBytes = Object.values(s.parts || {}).reduce(
            (sum, p) => sum + (p.size || 0),
            0,
          );
          dispatch({
            type: "enqueue",
            item: {
              id: `orphan-${s.fingerprint}`,
              bucket: s.bucket,
              key: s.key,
              file: null,
              status: "paused",
              loaded: loadedBytes,
              total: s.totalSize,
              error: null,
              engine: "multipart",
              parts: {
                done: Object.keys(s.parts || {}).length,
                total: s.totalParts,
              },
              fingerprint: s.fingerprint,
              uploadId: s.uploadId,
              orphan: true,
              fileName: s.fileName,
            },
          });
        }
      } catch {
        // IndexedDB unavailable (private mode, etc.) — silently skip.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <UploadsContext.Provider
      value={{
        uploads,
        enqueue,
        cancel,
        pause,
        resume,
        resumeOrphan,
        dismiss,
        clearFinished,
        onComplete,
      }}
    >
      {children}
    </UploadsContext.Provider>
  );
}

export function useUploads() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error("useUploads must be used inside <UploadsProvider>");
  return ctx;
}
