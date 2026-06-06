import { useState } from "react";
import { apiFetch } from "../api/client";
import "./S3Actions.css";

function S3Actions() {
  const [bucketName, setBucketName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState(null);

  const [uploadBucket, setUploadBucket] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);

  async function handleCreateBucket(e) {
    e.preventDefault();
    setCreating(true);
    setCreateMsg(null);
    try {
      const resp = await apiFetch("/api/s3/buckets", {
        method: "POST",
        body: JSON.stringify({ name: bucketName }),
      });
      setCreateMsg({ ok: true, text: `Bucket "${resp.name}" created` });
      setBucketName("");
    } catch (err) {
      setCreateMsg({ ok: false, text: err.message });
    }
    setCreating(false);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile || !uploadBucket) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const resp = await apiFetch(`/api/s3/buckets/${uploadBucket}/upload`, {
        method: "POST",
        body: form,
      });
      setUploadMsg({ ok: true, text: `Uploaded "${uploadFile.name}" to "${uploadBucket}"` });
      setUploadFile(null);
    } catch (err) {
      setUploadMsg({ ok: false, text: err.message });
    }
    setUploading(false);
  }

  return (
    <div className="s3-actions">
      <div className="s3-action-card">
        <h4>Create Bucket</h4>
        <form onSubmit={handleCreateBucket}>
          <input
            placeholder="Bucket name"
            value={bucketName}
            onChange={(e) => setBucketName(e.target.value)}
            required
            minLength={3}
          />
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
        {createMsg && (
          <div className={`s3-msg ${createMsg.ok ? "ok" : "err"}`}>{createMsg.text}</div>
        )}
      </div>

      <div className="s3-action-card">
        <h4>Upload Object</h4>
        <form onSubmit={handleUpload}>
          <input
            placeholder="Bucket name"
            value={uploadBucket}
            onChange={(e) => setUploadBucket(e.target.value)}
            required
          />
          <input
            type="file"
            onChange={(e) => setUploadFile(e.target.files[0])}
            required
          />
          <button type="submit" disabled={uploading || !uploadFile}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        {uploadMsg && (
          <div className={`s3-msg ${uploadMsg.ok ? "ok" : "err"}`}>{uploadMsg.text}</div>
        )}
      </div>
    </div>
  );
}

export default S3Actions;
