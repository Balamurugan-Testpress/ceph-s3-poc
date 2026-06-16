// Global upload queue. Lives in the Layout so an upload survives navigating
// between pages — the user can kick off a large upload from BucketExplorer
// then go look at audit logs while it runs.
//
// Each item: { id, bucket, key, file, status, loaded, total, error, xhr }
//   status: 'uploading' | 'done' | 'error' | 'cancelled'
//
// Consumers:
//   useUploads() -> { uploads, enqueue, cancel, dismiss, onComplete }
//   onComplete(cb) registers a callback fired when an upload finishes
//   successfully — BucketExplorer uses this to refresh its object list
//   without polling.

import { createContext, useCallback, useContext, useReducer, useRef } from "react";
import { uploadWithProgress } from "../api/upload";
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
        return {
          ...u,
          loaded: action.loaded,
          total: action.total,
          status: isComplete && u.status === "uploading" ? "finalizing" : u.status,
        };
      });
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
        u => u.status === "uploading" || u.status === "finalizing",
      );
    default:
      return state;
  }
}

export function UploadsProvider({ children }) {
  const [uploads, dispatch] = useReducer(reducer, []);
  // xhr handles aren't serializable, so keep them out of reducer state.
  const xhrs = useRef(new Map());
  // Tracks ids the user clicked Cancel on. We can't rely on the xhr's `abort`
  // event alone: if abort fires after the server already returned its final
  // response, the `load` event runs instead and we'd think the upload
  // succeeded. We mark cancellation here and, on `load` of a cancelled
  // upload, fire a compensating DELETE so the object doesn't linger.
  const cancelled = useRef(new Set());
  // Subscribers for completion events. Ref so adding a listener doesn't
  // re-render the provider.
  const completionListeners = useRef(new Set());

  const onComplete = useCallback((cb) => {
    completionListeners.current.add(cb);
    return () => completionListeners.current.delete(cb);
  }, []);

  const enqueue = useCallback((bucket, file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      id,
      bucket,
      key: file.name,
      file,
      status: "uploading",
      loaded: 0,
      total: file.size,
      error: null,
    };
    dispatch({ type: "enqueue", item });

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
        // Race: the user clicked Cancel after bytes had already reached the
        // server. The xhr resolved instead of aborting. Compensate by
        // deleting the now-uploaded object.
        if (cancelled.current.has(id)) {
          dispatch({ type: "cancelled", id });
          apiFetch(
            `/api/rgw/buckets/${bucket}/objects/${encodeURI(file.name)}`,
            { method: "DELETE" },
          ).catch(() => { /* best-effort; nothing the user can do */ });
          return;
        }
        dispatch({ type: "done", id });
        completionListeners.current.forEach(cb => {
          try { cb({ bucket, key: file.name }); } catch { /* ignore */ }
        });
      })
      .catch(err => {
        // Abort surfaces here too — distinguish via the readyState/status check
        // done in uploadWithProgress (it rejects with a marker error).
        // The server-side 499 short-circuit is also handled here (we'd see a
        // non-2xx response and reject), and 499 → no object on the server,
        // so no DELETE needed.
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

    return id;
  }, []);

  const cancel = useCallback((id) => {
    cancelled.current.add(id);
    const xhr = xhrs.current.get(id);
    if (xhr) xhr.abort();
  }, []);

  const dismiss = useCallback((id) => {
    dispatch({ type: "dismiss", id });
  }, []);

  const clearFinished = useCallback(() => {
    dispatch({ type: "clearFinished" });
  }, []);

  return (
    <UploadsContext.Provider
      value={{ uploads, enqueue, cancel, dismiss, clearFinished, onComplete }}
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
