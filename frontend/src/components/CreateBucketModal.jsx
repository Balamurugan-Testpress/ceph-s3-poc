import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FolderPlus, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";

// ── Constants ────────────────────────────────────────────────────

const TABS = [
  { id: "general", label: "General" },
  { id: "versioning", label: "Versioning" },
  { id: "objectLock", label: "Object Lock" },
  { id: "tags", label: "Tags" },
  { id: "policy", label: "Policy" },
  { id: "acl", label: "ACL" },
  // "rateLimit" appended only for admins (see TABS_FOR below).
];

const CANNED_ACLS = [
  { value: "private",            label: "Private",            blurb: "Owner only. Default." },
  { value: "public-read",        label: "Public Read",        blurb: "Anyone can download objects." },
  { value: "public-read-write",  label: "Public Read & Write", blurb: "Anyone can read AND write. Rarely what you want." },
  { value: "authenticated-read", label: "Authenticated Read", blurb: "Any signed-in S3 user can read." },
];

function tabsFor(isAdmin) {
  return isAdmin
    ? [...TABS, { id: "rateLimit", label: "Rate Limit" }]
    : TABS;
}

// Canonical public-read JSON policy — same shape as the helper in
// BucketExplorer.jsx so users see consistent wording.
function publicReadPolicy(bucketName) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucketName || "<bucket>"}/*`],
      },
    ],
  }, null, 2);
}

// Defaults — used both for initial state and the "is this tab dirty" check
// that drives the per-tab dot badge.
function initialForm() {
  return {
    name: "",
    versioning_enabled: false,
    object_lock_enabled: false,
    object_lock: { mode: "GOVERNANCE", retentionValue: 30, retentionUnit: "days" },
    tags: [],   // [{ key, value }]
    policy: "",
    acl: "private",
    rate_limit: {
      enabled: true,
      max_read_ops: 0,
      max_write_ops: 0,
      max_read_bytes: 0,
      max_write_bytes: 0,
    },
  };
}

// ── Component ────────────────────────────────────────────────────

function CreateBucketModal({ open, onClose, addNotification }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("general");
  const [form, setForm] = useState(initialForm);
  const [errorBanner, setErrorBanner] = useState(null);

  // Reset state every time the modal opens — feels cleaner than persisting
  // a half-filled form between bucket creations.
  useEffect(() => {
    if (open) {
      setForm(initialForm());
      setActiveTab("general");
      setErrorBanner(null);
    }
  }, [open]);

  const tabs = useMemo(() => tabsFor(isAdmin), [isAdmin]);

  // Per-tab "this is non-default" indicator. Compared against initialForm
  // so the dot only shows up after the user touches that tab.
  const tabHasValue = useMemo(() => {
    const def = initialForm();
    return {
      general: !!form.name,
      versioning: form.versioning_enabled,
      objectLock: form.object_lock_enabled,
      tags: form.tags.length > 0,
      policy: form.policy.trim().length > 0,
      acl: form.acl !== def.acl,
      rateLimit:
        form.rate_limit.enabled !== def.rate_limit.enabled
        || form.rate_limit.max_read_ops !== 0
        || form.rate_limit.max_write_ops !== 0
        || form.rate_limit.max_read_bytes !== 0
        || form.rate_limit.max_write_bytes !== 0,
    };
  }, [form]);

  // ── Submit ─────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload) =>
      apiFetch("/api/s3/buckets", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      queryClient.invalidateQueries({ queryKey: ["s3Usage"] });
      const failed = resp?.failed || [];
      if (failed.length === 0) {
        addNotification("success", `Bucket "${resp.name}" created`);
      } else {
        // Bucket exists but one or more settings didn't apply — surface that
        // clearly. "info" (blue), not "error" (red), since the bucket itself
        // is fine. Listing the failed steps makes the fix obvious.
        const steps = failed.map((f) => f.step).join(", ");
        addNotification(
          "info",
          `Bucket "${resp.name}" created; some settings didn't apply: ${steps}`,
        );
      }
      onClose();
    },
    onError: (err) => {
      // Banner inside the modal — keeps the user on the page so they can
      // fix the input rather than re-opening the modal.
      setErrorBanner(err.message);
    },
  });

  function submit(e) {
    e?.preventDefault?.();
    setErrorBanner(null);

    const name = form.name.trim();
    if (!name) {
      setErrorBanner("Bucket name is required.");
      setActiveTab("general");
      return;
    }

    // Object lock retention sub-payload — flatten the (value, unit)
    // pair the form uses back into the API shape (days XOR years).
    let object_lock = null;
    if (form.object_lock_enabled) {
      const v = Number(form.object_lock.retentionValue) || 0;
      if (v < 1) {
        setErrorBanner("Object Lock retention must be ≥ 1.");
        setActiveTab("objectLock");
        return;
      }
      object_lock = {
        mode: form.object_lock.mode,
        retention_days: form.object_lock.retentionUnit === "days" ? v : null,
        retention_years: form.object_lock.retentionUnit === "years" ? v : null,
      };
    }

    // Drop empty tag rows — the user often adds a row then types nothing.
    const tags = form.tags
      .map((t) => ({ key: t.key.trim(), value: t.value }))
      .filter((t) => t.key);

    const payload = {
      name,
      versioning_enabled: form.versioning_enabled,
      object_lock_enabled: form.object_lock_enabled,
      object_lock,
      tags,
      policy: form.policy.trim() || null,
      // Treat "private" as "leave alone" — saves a redundant ACL call.
      acl: form.acl && form.acl !== "private" ? form.acl : null,
      rate_limit: isAdmin && tabHasValue.rateLimit ? form.rate_limit : null,
    };

    createMutation.mutate(payload);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 bg-brand-500/10 rounded-lg">
              <FolderPlus className="w-5 h-5 text-brand-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 m-0">Create Bucket</h2>
              <p className="text-xs text-gray-400 m-0">Configure versioning, locking, tags, policy, and more</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab strip */}
        <div className="px-6 border-b border-gray-100">
          <nav className="flex flex-wrap gap-x-5 -mb-px" aria-label="Bucket settings tabs">
            {tabs.map((t) => {
              const active = activeTab === t.id;
              const dot = tabHasValue[t.id] && t.id !== "general";
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`relative py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                    active
                      ? "border-brand-500 text-brand-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {t.label}
                  {dot && (
                    <span className="inline-block ml-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 align-middle" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Body */}
        <form id="create-bucket-form" onSubmit={submit} className="overflow-y-auto flex-1 px-6 py-5">
          {errorBanner && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {/* ── General ── */}
          {activeTab === "general" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide">
                  Bucket name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                  required
                  placeholder="my-bucket-name"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-gray-300"
                />
                <p className="text-xs text-gray-400">
                  Lowercase letters, numbers, dots, and hyphens. 3–63 characters. Must be unique cluster-wide.
                </p>
              </div>
              <p className="text-xs text-gray-500 italic">
                The other tabs are optional — hit Create now if you just need a plain bucket.
              </p>
            </div>
          )}

          {/* ── Versioning ── */}
          {activeTab === "versioning" && (
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <label className={`flex items-center gap-3 px-4 py-3 select-none ${
                  form.object_lock_enabled ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50 cursor-pointer"
                }`}>
                  <input
                    type="checkbox"
                    checked={form.versioning_enabled || form.object_lock_enabled}
                    disabled={form.object_lock_enabled}
                    onChange={(e) => setForm({ ...form, versioning_enabled: e.target.checked })}
                    className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Enable versioning</span>
                </label>
                <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 space-y-2">
                  <p>Keeps every version of every object. Overwrites and deletes become non-destructive.</p>
                  {form.object_lock_enabled && (
                    <p className="text-amber-700">
                      Object Lock requires versioning — it's force-enabled below.
                    </p>
                  )}
                  <p className="text-gray-400 italic">
                    There is no "Disabled" state in S3 — you can only Suspend later.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Object Lock ── */}
          {activeTab === "objectLock" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Object Lock <strong>must</strong> be enabled at create time. Ceph rejects
                  enabling it on an existing bucket with HTTP 409.
                </span>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.object_lock_enabled}
                    onChange={(e) => setForm({
                      ...form,
                      object_lock_enabled: e.target.checked,
                      // Force-on versioning so the wizard summary matches reality.
                      versioning_enabled: e.target.checked ? true : form.versioning_enabled,
                    })}
                    className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Enable Object Lock</span>
                </label>
                {form.object_lock_enabled && (
                  <div className="px-4 py-4 border-t border-gray-100 space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-gray-500">Retention mode</label>
                      <div className="flex gap-4">
                        {["GOVERNANCE", "COMPLIANCE"].map((m) => (
                          <label key={m} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="lockMode"
                              value={m}
                              checked={form.object_lock.mode === m}
                              onChange={() => setForm({
                                ...form,
                                object_lock: { ...form.object_lock, mode: m },
                              })}
                              className="accent-brand-500"
                            />
                            <span className="text-sm text-gray-700">{m}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400">
                        <strong>GOVERNANCE</strong>: users with special permission can override.
                        <strong className="ml-2">COMPLIANCE</strong>: nobody can override, ever.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-gray-500">Default retention</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min="1"
                          value={form.object_lock.retentionValue}
                          onChange={(e) => setForm({
                            ...form,
                            object_lock: {
                              ...form.object_lock,
                              retentionValue: parseInt(e.target.value, 10) || 1,
                            },
                          })}
                          className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
                        />
                        <select
                          value={form.object_lock.retentionUnit}
                          onChange={(e) => setForm({
                            ...form,
                            object_lock: { ...form.object_lock, retentionUnit: e.target.value },
                          })}
                          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
                        >
                          <option value="days">Days</option>
                          <option value="years">Years</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tags ── */}
          {activeTab === "tags" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Key/value pairs for accounting, automation, or cost allocation. Stored on the bucket.
              </p>
              {form.tags.length === 0 && (
                <p className="text-sm text-gray-400 italic">No tags yet.</p>
              )}
              {form.tags.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    placeholder="Key"
                    value={t.key}
                    onChange={(e) => {
                      const next = [...form.tags];
                      next[i] = { ...next[i], key: e.target.value };
                      setForm({ ...form, tags: next });
                    }}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
                  />
                  <input
                    placeholder="Value"
                    value={t.value}
                    onChange={(e) => {
                      const next = [...form.tags];
                      next[i] = { ...next[i], value: e.target.value };
                      setForm({ ...form, tags: next });
                    }}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })}
                    className="flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Remove tag"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setForm({ ...form, tags: [...form.tags, { key: "", value: "" }] })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-500/10 rounded-lg hover:bg-brand-500/20 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add tag
              </button>
            </div>
          )}

          {/* ── Policy ── */}
          {activeTab === "policy" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Raw JSON bucket policy. Leave blank to skip (you can also use the ACL tab for the
                common "make this public" case).
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, policy: publicReadPolicy(form.name) })}
                  className="px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-500/10 rounded-lg hover:bg-brand-500/20 transition-colors"
                >
                  Insert public-read template
                </button>
                {form.policy && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, policy: "" })}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <textarea
                value={form.policy}
                onChange={(e) => setForm({ ...form, policy: e.target.value })}
                rows={12}
                placeholder='{ "Version": "2012-10-17", "Statement": [...] }'
                className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors placeholder:text-gray-300"
              />
            </div>
          )}

          {/* ── ACL ── */}
          {activeTab === "acl" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Canned ACL applied at create time. Ceph supports exactly these four values.
              </p>
              <div className="space-y-2">
                {CANNED_ACLS.map((a) => (
                  <label
                    key={a.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      form.acl === a.value
                        ? "border-brand-500 bg-brand-500/5"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="acl"
                      value={a.value}
                      checked={form.acl === a.value}
                      onChange={() => setForm({ ...form, acl: a.value })}
                      className="mt-0.5 accent-brand-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-800">{a.label}</div>
                      <div className="text-xs text-gray-500">{a.blurb}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Rate limit (admin only) ── */}
          {activeTab === "rateLimit" && isAdmin && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Per-bucket rate limit is admin-only — applied through the Ceph Admin Ops API.
                  Regular users won't see this tab.
                </span>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <label className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.rate_limit.enabled}
                    onChange={(e) => setForm({
                      ...form,
                      rate_limit: { ...form.rate_limit, enabled: e.target.checked },
                    })}
                    className="w-4 h-4 accent-brand-500 rounded cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Enable bucket rate limit</span>
                </label>
                <div className="grid grid-cols-2 gap-4 px-4 py-4 border-t border-gray-100">
                  {[
                    ["max_read_ops",    "Max Read Ops"],
                    ["max_write_ops",   "Max Write Ops"],
                    ["max_read_bytes",  "Max Read Bytes"],
                    ["max_write_bytes", "Max Write Bytes"],
                  ].map(([field, label]) => (
                    <div key={field} className="space-y-1.5">
                      <label className="block text-xs font-medium text-gray-500">
                        {label}
                        <span className="text-gray-400 font-normal"> · 0 = unlimited</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={form.rate_limit[field]}
                        onChange={(e) => setForm({
                          ...form,
                          rate_limit: {
                            ...form.rate_limit,
                            [field]: parseInt(e.target.value, 10) || 0,
                          },
                        })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-bucket-form"
            disabled={createMutation.isLoading || createMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {(createMutation.isLoading || createMutation.isPending) ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Creating…
              </>
            ) : (
              <>
                <FolderPlus className="w-4 h-4" />
                Create Bucket
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateBucketModal;
