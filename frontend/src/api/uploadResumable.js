// Browser-direct multipart upload engine.
//
// The backend mints presigned PUTs per part; the browser PUTs the bytes
// straight to RGW. Progress, pause/resume, and crash recovery live here.
//
// Design notes:
//
// - We never resolve(), reject() from inside an async iteration when the user
//   has paused — pause is a soft signal that lets in-flight parts drain so
//   their ETags get recorded. The Promise just stays pending until resume() or
//   cancel() is called.
// - ETag comes back in the response header. CORS on the bucket must expose it
//   (see RGWClient.put_bucket_cors).
// - Concurrency is bounded so we don't open 100 simultaneous TCP connections
//   to RGW on a 10 GB file.

import { apiFetch } from "./client";
import {
  deleteSession,
  fingerprintFor,
  getSession,
  putSession,
  recordPart,
} from "./idb";

const CONCURRENCY = 4;
const MAX_RETRIES = 3;

// Files at or above this size go through multipart. Below it, the caller
// uses the legacy single-PUT path in upload.js.
export const MULTIPART_THRESHOLD = 16 * 1024 * 1024;

export { fingerprintFor };

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Strip surrounding quotes that RGW (and S3) include in the ETag header. The
// quoted form is what CompleteMultipartUpload expects, but we normalise on
// storage so two callers can't disagree on shape.
function normalizeEtag(raw) {
  if (!raw) return raw;
  return raw.replace(/^"|"$/g, "");
}

// A failed cross-origin fetch shows up as a TypeError with no status — the
// browser refuses to give us details. CORS misconfiguration is the most
// likely cause; we use this to decide whether to attempt a one-shot heal.
function looksLikeCorsError(err) {
  if (!err) return false;
  if (err.name === "TypeError") return true;
  const msg = String(err.message || "");
  return msg.includes("NetworkError") || msg.includes("Failed to fetch");
}

async function putPartWithRetry(url, blob, signal) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(url, { method: "PUT", body: blob, signal });
      if (!res.ok) {
        throw new Error(`Part PUT failed: ${res.status} ${res.statusText}`);
      }
      const etag = normalizeEtag(res.headers.get("ETag"));
      if (!etag) {
        // CORS misconfiguration — the request succeeded but the ETag header
        // wasn't exposed. Without it we can't complete the upload.
        throw new Error(
          "Could not read ETag from response — check bucket CORS exposes ETag",
        );
      }
      return etag;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastErr = err;
      await sleep(250 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Drive a resumable multipart upload. Returns a controller-like object whose
 * `promise` settles when the upload finishes, fails, or is cancelled.
 *
 *   const ctl = startResumableUpload({ bucket, file, onProgress, onParts });
 *   ctl.pause();   // soft stop — in-flight parts finish, queue halts
 *   ctl.resume();  // continue from where pause left off
 *   ctl.cancel();  // hard stop — abort multipart on RGW, drop IndexedDB row
 */
export function startResumableUpload({
  bucket,
  file,
  onProgress,
  onParts,
  // Optional: caller can supply a pre-existing fingerprint (used when
  // resuming an upload the user re-picked after a reload).
  fingerprint: fingerprintOverride,
}) {
  const fingerprint = fingerprintOverride || fingerprintFor(bucket, file);
  const key = file.name;

  let controller = new AbortController();
  let pauseGate = null;       // Promise that resolves when resume() is called
  let pauseResolve = null;
  let paused = false;
  let cancelled = false;
  let session = null;         // populated after init()
  let loadedBytes = 0;
  let resolveAll, rejectAll;
  // One-shot CORS self-heal. If a part PUT fails with a network/CORS error,
  // we call /cors/ensure once for this bucket and retry. corsHealPromise
  // serialises concurrent healers so workers don't all hit the endpoint.
  let corsHealAttempted = false;
  let corsHealPromise = null;

  const promise = new Promise((res, rej) => {
    resolveAll = res;
    rejectAll = rej;
  });

  function emitProgress() {
    if (onProgress) onProgress(loadedBytes, file.size);
  }

  function emitParts(done) {
    if (onParts) onParts(done, session?.totalParts ?? 0);
  }

  async function ensureSession() {
    const existing = await getSession(fingerprint);
    if (existing) {
      // Reconcile with RGW — the upload may have expired or been aborted
      // out-of-band. If RGW has no record, start fresh.
      const remote = await apiFetch(
        `/api/multipart/${encodeURIComponent(existing.bucket)}/${encodeURI(
          existing.key,
        )}/parts?upload_id=${encodeURIComponent(existing.uploadId)}`,
      ).catch(() => null);
      if (remote && !remote.expired) {
        // Merge remote ETags into our local view in case we lost track.
        const merged = { ...existing.parts };
        for (const p of remote.parts || []) {
          merged[p.part_number] = {
            etag: normalizeEtag(p.etag),
            size: p.size,
          };
        }
        existing.parts = merged;
        await putSession(existing);
        session = existing;
        loadedBytes = Object.values(merged).reduce(
          (sum, p) => sum + (p.size || 0),
          0,
        );
        emitProgress();
        return;
      }
      // RGW lost the session — purge and re-init.
      await deleteSession(fingerprint);
    }
    const init = await apiFetch("/api/multipart/init", {
      method: "POST",
      body: JSON.stringify({
        bucket,
        key,
        size: file.size,
        content_type: file.type || null,
      }),
    });
    session = {
      fingerprint,
      bucket,
      key,
      uploadId: init.upload_id,
      partSize: init.part_size,
      totalSize: file.size,
      totalParts: init.part_count,
      parts: {},
      createdAt: Date.now(),
      fileName: file.name,
    };
    await putSession(session);
  }

  async function uploadOnePart(partNumber) {
    // Wait here if paused. We re-check `cancelled` after every await so a
    // cancel during pause unwinds cleanly.
    if (paused) await pauseGate;
    if (cancelled) throw new DOMException("Cancelled", "AbortError");

    const start = (partNumber - 1) * session.partSize;
    const end = Math.min(start + session.partSize, file.size);
    const blob = file.slice(start, end);
    const size = end - start;

    const { url } = await apiFetch("/api/multipart/presign-part", {
      method: "POST",
      body: JSON.stringify({
        bucket: session.bucket,
        key: session.key,
        upload_id: session.uploadId,
        part_number: partNumber,
      }),
    });

    let etag;
    try {
      etag = await putPartWithRetry(url, blob, controller.signal);
    } catch (err) {
      // Likely a missing CORS rule on this bucket (the bucket pre-dated this
      // feature and never had it installed). Try once to fix it server-side
      // and then retry the part. Subsequent parts in this upload won't trip
      // the same path because the rule sticks on the bucket.
      if (looksLikeCorsError(err) && !corsHealAttempted) {
        corsHealAttempted = true;
        corsHealPromise = apiFetch(
          `/api/s3/buckets/${encodeURIComponent(bucket)}/cors/ensure`,
          { method: "POST" },
        ).catch(() => {});
        await corsHealPromise;
        etag = await putPartWithRetry(url, blob, controller.signal);
      } else if (corsHealPromise && looksLikeCorsError(err)) {
        // A peer worker already kicked off the heal; wait for it and retry.
        await corsHealPromise;
        etag = await putPartWithRetry(url, blob, controller.signal);
      } else {
        throw err;
      }
    }
    await recordPart(fingerprint, partNumber, etag, size);
    session.parts[partNumber] = { etag, size };
    loadedBytes += size;
    emitProgress();
    emitParts(Object.keys(session.parts).length);
  }

  async function run() {
    try {
      await ensureSession();
      emitParts(Object.keys(session.parts).length);

      const missing = [];
      for (let n = 1; n <= session.totalParts; n++) {
        if (!session.parts[n]) missing.push(n);
      }

      // Bounded-concurrency worker pool. A simple shared cursor — each worker
      // pulls the next part number and PUTs it until the queue is empty.
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, missing.length || 1) },
        async () => {
          while (true) {
            if (cancelled) return;
            // pause-and-wait happens inside uploadOnePart so any in-flight
            // PUT can still complete and be recorded.
            if (paused) await pauseGate;
            const idx = cursor++;
            if (idx >= missing.length) return;
            await uploadOnePart(missing[idx]);
          }
        },
      );
      await Promise.all(workers);

      if (cancelled) {
        rejectAll(new DOMException("Cancelled", "AbortError"));
        return;
      }

      // Finalize.
      const parts = Object.entries(session.parts)
        .map(([n, p]) => ({ part_number: Number(n), etag: p.etag }))
        .sort((a, b) => a.part_number - b.part_number);

      const result = await apiFetch("/api/multipart/complete", {
        method: "POST",
        body: JSON.stringify({
          bucket: session.bucket,
          key: session.key,
          upload_id: session.uploadId,
          parts,
          total_size: file.size,
        }),
      });

      await deleteSession(fingerprint);
      resolveAll(result);
    } catch (err) {
      if (err?.name === "AbortError" && cancelled) {
        rejectAll(err);
      } else if (err?.name === "AbortError") {
        // Aborted but not cancelled = pause kicked in. Hold the promise open.
        // Re-entering via resume() will start a new run() call.
      } else {
        rejectAll(err);
      }
    }
  }

  // Kick off.
  run();

  return {
    promise,
    pause() {
      if (paused || cancelled) return;
      paused = true;
      pauseGate = new Promise(r => {
        pauseResolve = r;
      });
      // We deliberately do NOT abort the controller here. In-flight part
      // PUTs are allowed to finish so their ETags land in IndexedDB.
    },
    resume() {
      if (!paused || cancelled) return;
      paused = false;
      const r = pauseResolve;
      pauseResolve = null;
      pauseGate = null;
      r?.();
    },
    async cancel() {
      cancelled = true;
      // Release any paused workers so they unwind.
      if (pauseResolve) pauseResolve();
      controller.abort();
      // Best-effort tell RGW to drop the parts. Always clean local state.
      if (session) {
        await apiFetch("/api/multipart/abort", {
          method: "POST",
          body: JSON.stringify({
            bucket: session.bucket,
            key: session.key,
            upload_id: session.uploadId,
          }),
        }).catch(() => {});
        await deleteSession(fingerprint).catch(() => {});
      }
    },
  };
}
