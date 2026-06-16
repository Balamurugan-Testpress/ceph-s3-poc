// XHR-based uploader. We can't use fetch() here because the Fetch API has no
// way to surface upload progress for a request body (only ReadableStream
// response progress, which doesn't apply here).
//
// Returns { promise, xhr } so callers can xhr.abort() to cancel.

const API_BASE = import.meta.env.VITE_API_BASE || "";

function getToken() {
  try {
    const data = localStorage.getItem("ceph_s3_auth");
    if (data) return JSON.parse(data).token;
  } catch {
    /* ignore */
  }
  return null;
}

export function uploadWithProgress(path, file, { onProgress } = {}) {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append("file", file);

  const promise = new Promise((resolve, reject) => {
    xhr.open("POST", `${API_BASE}${path}`);

    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", e => {
        // e.lengthComputable is false in rare edge cases (e.g. chunked encoding)
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve(null);
        }
      } else {
        let detail = `Request failed with status ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          detail = body.detail || body.message || detail;
        } catch { /* ignore */ }
        reject(new Error(detail));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => {
      const err = new Error("Upload cancelled");
      err.name = "AbortError";
      reject(err);
    });

    xhr.send(formData);
  });

  return { promise, xhr };
}
