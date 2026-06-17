import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertTriangle, Lock, Unlock, Pencil, Save, X as XIcon } from "lucide-react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";

// ── Shared bits ───────────────────────────────────────────────────

/**
 * One card per property. Reads on mount, edit-in-place on click, save
 * independently. Keeping each card self-contained means a failure on
 * (say) Object Lock doesn't take the rest of the panel down with it —
 * matches the additive "applied/failed" philosophy from the create
 * modal.
 */
function SettingsCard({ title, subtitle, icon, action, children }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex items-center justify-center w-8 h-8 bg-brand-500/10 rounded-lg text-brand-600">
              {icon}
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 m-0">{title}</h3>
            {subtitle && <p className="text-xs text-gray-400 m-0">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function ReadRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`text-gray-800 text-right ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function EditButtons({ onSave, onCancel, saving, canSave = true }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onSave}
        disabled={saving || !canSave}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        <Save className="w-3.5 h-3.5" />
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <XIcon className="w-3.5 h-3.5" />
        Cancel
      </button>
    </div>
  );
}

function EditButton({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
    >
      <Pencil className="w-3 h-3" />
      Edit
    </button>
  );
}

// ── Versioning ────────────────────────────────────────────────────

function VersioningCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "versioning"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/versioning`),
  });
  // Object Lock implicitly requires versioning, so RGW rejects "Suspend"
  // on lock-enabled buckets with InvalidBucketState. We piggy-back the
  // lock query (already loaded for ObjectLockCard) so we can gray out
  // the Suspended option instead of letting the user hit a 502.
  const { data: lockData } = useQuery({
    queryKey: ["bucket", bucket, "object-lock"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/object-lock`),
  });
  const lockOn = !!lockData?.configuration;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("Enabled");

  const mutation = useMutation({
    mutationFn: (status) =>
      apiFetch(`/api/s3/buckets/${bucket}/versioning`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "versioning"] });
      addNotification("success", "Versioning updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  const current = data?.status || "Unversioned";

  return (
    <SettingsCard
      title="Versioning"
      subtitle="Keep historical versions of every object"
      action={!editing && (
        <EditButton
          onClick={() => { setDraft(current === "Enabled" ? "Suspended" : "Enabled"); setEditing(true); }}
          disabled={isLoading}
        />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !editing ? (
        <ReadRow
          label="Status"
          value={
            <span className={`inline-flex items-center gap-1.5 ${
              current === "Enabled" ? "text-emerald-600" :
              current === "Suspended" ? "text-amber-600" : "text-gray-500"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                current === "Enabled" ? "bg-emerald-500" :
                current === "Suspended" ? "bg-amber-500" : "bg-gray-400"
              }`} />
              {current}
            </span>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-4">
            {["Enabled", "Suspended"].map((v) => {
              const disabled = v === "Suspended" && lockOn;
              return (
                <label
                  key={v}
                  className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                  title={disabled ? "Versioning cannot be suspended while Object Lock is enabled" : undefined}
                >
                  <input
                    type="radio"
                    name="versioning"
                    value={v}
                    checked={draft === v}
                    onChange={() => setDraft(v)}
                    disabled={disabled}
                    className="accent-brand-500"
                  />
                  <span className="text-sm text-gray-700">{v}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 italic">
            S3 has no "Disabled" state — once turned on, the off-switch is Suspended (existing versions stay).
            {lockOn && " Suspend is unavailable here because Object Lock is enabled."}
          </p>
          <EditButtons
            onSave={() => mutation.mutate(draft)}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── Object Lock ───────────────────────────────────────────────────

function ObjectLockCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "object-lock"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/object-lock`),
  });
  const conf = data?.configuration;
  const lockEnabled = !!conf;
  const rule = conf?.Rule?.DefaultRetention;

  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState("GOVERNANCE");
  const [value, setValue] = useState(30);
  const [unit, setUnit] = useState("days");

  useEffect(() => {
    if (rule) {
      setMode(rule.Mode || "GOVERNANCE");
      if (rule.Days != null) { setValue(rule.Days); setUnit("days"); }
      else if (rule.Years != null) { setValue(rule.Years); setUnit("years"); }
    }
  }, [rule]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/s3/buckets/${bucket}/object-lock`, {
        method: "PUT",
        body: JSON.stringify({
          mode,
          retention_days: unit === "days" ? Number(value) : null,
          retention_years: unit === "years" ? Number(value) : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "object-lock"] });
      addNotification("success", "Object Lock retention updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  return (
    <SettingsCard
      title="Object Lock"
      subtitle="Write-once-read-many retention"
      icon={lockEnabled ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
      action={lockEnabled && !editing && (
        <EditButton onClick={() => setEditing(true)} disabled={isLoading} />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !lockEnabled ? (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Object Lock is <strong>not enabled</strong> on this bucket. It can only be turned on at create
            time — Ceph returns 409 if added later. To use Object Lock, create a new bucket with the option ticked.
          </span>
        </div>
      ) : !editing ? (
        <>
          <ReadRow label="Lock" value={
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Enabled
            </span>
          } />
          {rule ? (
            <>
              <ReadRow label="Default mode" value={rule.Mode} />
              <ReadRow
                label="Default retention"
                value={rule.Days != null ? `${rule.Days} day${rule.Days === 1 ? "" : "s"}` : `${rule.Years} year${rule.Years === 1 ? "" : "s"}`}
              />
            </>
          ) : (
            <p className="text-xs text-gray-400 italic">
              No default retention rule. New objects upload without an automatic retention period.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500">Mode</label>
            <div className="flex gap-4">
              {["GOVERNANCE", "COMPLIANCE"].map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio" name="lockmode" value={m} checked={mode === m}
                    onChange={() => setMode(m)} className="accent-brand-500"
                  />
                  <span className="text-sm text-gray-700">{m}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              GOVERNANCE allows override with special permission · COMPLIANCE allows none.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500">Default retention</label>
            <div className="flex gap-2">
              <input
                type="number" min="1" value={value}
                onChange={(e) => setValue(parseInt(e.target.value, 10) || 1)}
                className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
              />
              <select
                value={unit} onChange={(e) => setUnit(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
              >
                <option value="days">Days</option>
                <option value="years">Years</option>
              </select>
            </div>
          </div>
          <EditButtons
            onSave={() => mutation.mutate()}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
            canSave={value >= 1}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── Tags ──────────────────────────────────────────────────────────

function TagsCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "tagging"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/tagging`),
  });
  const tags = data?.tags || [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);

  useEffect(() => {
    if (editing) {
      setDraft(tags.map((t) => ({ key: t.Key, value: t.Value })));
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (next) =>
      apiFetch(`/api/s3/buckets/${bucket}/tagging`, {
        method: "PUT",
        body: JSON.stringify({ tags: next }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "tagging"] });
      addNotification("success", "Tags updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  return (
    <SettingsCard
      title="Tags"
      subtitle="Key/value pairs for accounting and automation"
      action={!editing && (
        <EditButton onClick={() => setEditing(true)} disabled={isLoading} />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !editing ? (
        tags.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No tags set.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t.Key}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md"
              >
                <span className="font-medium">{t.Key}</span>
                {t.Value && <span className="text-gray-400">·</span>}
                {t.Value && <span>{t.Value}</span>}
              </span>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-2">
          {draft.length === 0 && (
            <p className="text-sm text-gray-400 italic">No tags. Click "Add tag" to start, or save to clear all tags.</p>
          )}
          {draft.map((t, i) => (
            <div key={i} className="flex gap-2">
              <input
                placeholder="Key" value={t.key}
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...next[i], key: e.target.value };
                  setDraft(next);
                }}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
              />
              <input
                placeholder="Value" value={t.value}
                onChange={(e) => {
                  const next = [...draft];
                  next[i] = { ...next[i], value: e.target.value };
                  setDraft(next);
                }}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
              />
              <button
                type="button"
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                className="flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                title="Remove tag"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft([...draft, { key: "", value: "" }])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-500/10 rounded-lg hover:bg-brand-500/20"
          >
            <Plus className="w-3.5 h-3.5" /> Add tag
          </button>
          <EditButtons
            onSave={() => mutation.mutate(draft.map((t) => ({ key: t.key.trim(), value: t.value })).filter((t) => t.key))}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── ACL ──────────────────────────────────────────────────────────

const CANNED_ACLS = [
  { value: "private",            label: "Private" },
  { value: "public-read",        label: "Public Read" },
  { value: "public-read-write",  label: "Public Read & Write" },
  { value: "authenticated-read", label: "Authenticated Read" },
];

// Best-effort grants → canned mapping. Used purely to seed the radio
// when entering edit mode; the user can override.
function inferCanned(grants) {
  const URI_ALL = "http://acs.amazonaws.com/groups/global/AllUsers";
  const URI_AUTH = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
  const perms = new Set(
    grants.filter((g) => g.Grantee?.URI === URI_ALL).map((g) => g.Permission)
  );
  if (perms.has("WRITE") || perms.has("FULL_CONTROL")) return "public-read-write";
  if (perms.has("READ")) return "public-read";
  const authPerms = new Set(
    grants.filter((g) => g.Grantee?.URI === URI_AUTH).map((g) => g.Permission)
  );
  if (authPerms.has("READ")) return "authenticated-read";
  return "private";
}

function AclCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "acl"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/acl`),
  });
  const grants = data?.grants || [];
  const owner = data?.owner;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("private");

  useEffect(() => {
    if (editing) setDraft(inferCanned(grants));
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (acl) =>
      apiFetch(`/api/s3/buckets/${bucket}/acl`, {
        method: "PUT",
        body: JSON.stringify({ acl }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "acl"] });
      addNotification("success", "ACL updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  return (
    <SettingsCard
      title="ACL"
      subtitle="Canned access-control list"
      action={!editing && (
        <EditButton onClick={() => setEditing(true)} disabled={isLoading} />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !editing ? (
        <>
          {owner && (
            <ReadRow label="Owner" value={owner.DisplayName || owner.ID || "—"} />
          )}
          <div className="space-y-1.5">
            <div className="text-sm text-gray-500">Grants</div>
            {grants.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No grants.</p>
            ) : (
              <ul className="space-y-1">
                {grants.map((g, i) => {
                  const who = g.Grantee?.URI?.split("/").pop()
                            || g.Grantee?.DisplayName
                            || g.Grantee?.ID
                            || "—";
                  return (
                    <li key={i} className="text-xs text-gray-700 flex justify-between gap-3">
                      <span className="font-mono">{who}</span>
                      <span className="text-gray-500">{g.Permission}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {CANNED_ACLS.map((a) => (
              <label
                key={a.value}
                className={`flex items-center gap-3 p-2.5 border rounded-lg cursor-pointer transition-colors ${
                  draft === a.value ? "border-brand-500 bg-brand-500/5" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio" name="acl" value={a.value} checked={draft === a.value}
                  onChange={() => setDraft(a.value)} className="accent-brand-500"
                />
                <span className="text-sm font-medium text-gray-800">{a.label}</span>
              </label>
            ))}
          </div>
          <EditButtons
            onSave={() => mutation.mutate(draft)}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── Policy ────────────────────────────────────────────────────────

function publicReadPolicy(bucketName) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${bucketName}/*`],
    }],
  }, null, 2);
}

function PolicyCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "policy"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/policy`),
  });
  const current = data?.policy || "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => { if (editing) setDraft(current); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const putMutation = useMutation({
    mutationFn: (policy) =>
      apiFetch(`/api/s3/buckets/${bucket}/policy`, {
        method: "PUT",
        body: JSON.stringify({ policy }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "policy"] });
      addNotification("success", "Policy updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  const delMutation = useMutation({
    mutationFn: () => apiFetch(`/api/s3/buckets/${bucket}/policy`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "policy"] });
      addNotification("success", "Policy removed");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  // Quick "is the current policy obviously public?" check, like the
  // legacy access-level radio. Purely informational.
  const looksPublic = useMemo(() => {
    if (!current) return false;
    try {
      const p = JSON.parse(current);
      return (p.Statement || []).some((s) =>
        s.Effect === "Allow" && s.Principal === "*"
        && (s.Action === "s3:GetObject" || (Array.isArray(s.Action) && s.Action.includes("s3:GetObject")))
      );
    } catch { return false; }
  }, [current]);

  return (
    <SettingsCard
      title="Bucket Policy"
      subtitle="Raw JSON IAM policy"
      action={!editing && (
        <EditButton onClick={() => setEditing(true)} disabled={isLoading} />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !editing ? (
        !current ? (
          <p className="text-sm text-gray-400 italic">No policy set.</p>
        ) : (
          <>
            {looksPublic && (
              <p className="text-xs text-amber-700">
                <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
                This policy grants public read access.
              </p>
            )}
            <pre className="max-h-60 overflow-auto p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-700">{current}</pre>
          </>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(publicReadPolicy(bucket))}
              className="px-3 py-1.5 text-xs font-medium text-brand-600 bg-brand-500/10 rounded-lg hover:bg-brand-500/20"
            >
              Insert public-read template
            </button>
            {current && (
              <button
                type="button"
                onClick={() => delMutation.mutate()}
                disabled={delMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-60"
              >
                {delMutation.isPending ? "Removing…" : "Remove policy"}
              </button>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            placeholder='{ "Version": "2012-10-17", "Statement": [...] }'
            className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
          <EditButtons
            onSave={() => putMutation.mutate(draft)}
            onCancel={() => setEditing(false)}
            saving={putMutation.isPending}
            canSave={!!draft.trim()}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── CORS (read-only summary) ─────────────────────────────────────
//
// CORS already has a "/cors/ensure" endpoint that re-installs the
// dashboard rule. Edit semantics are tricky (full rule set replace)
// so we expose read + a one-click "re-apply dashboard rule" rather
// than a free-form editor — the same affordance the rest of the app
// already provides.

function CorsCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "cors"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/cors`),
  });
  const rules = data?.rules || [];

  const reapply = useMutation({
    mutationFn: () => apiFetch(`/api/s3/buckets/${bucket}/cors/ensure`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "cors"] });
      addNotification("success", "Dashboard CORS rule re-applied");
    },
    onError: (e) => addNotification("error", e.message),
  });

  return (
    <SettingsCard
      title="CORS"
      subtitle="Browser cross-origin rules"
      action={
        <button
          onClick={() => reapply.mutate()}
          disabled={reapply.isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-60"
        >
          {reapply.isPending ? "Re-applying…" : "Re-apply dashboard rule"}
        </button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No CORS rules. Browser direct uploads will fail; click "Re-apply dashboard rule" to install the default.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1 text-xs">
              <div><span className="text-gray-500">Methods:</span> <span className="font-mono">{(r.AllowedMethods || []).join(", ")}</span></div>
              <div><span className="text-gray-500">Origins:</span> <span className="font-mono">{(r.AllowedOrigins || []).join(", ")}</span></div>
              {r.AllowedHeaders?.length > 0 && (
                <div><span className="text-gray-500">Headers:</span> <span className="font-mono">{r.AllowedHeaders.join(", ")}</span></div>
              )}
              {r.ExposeHeaders?.length > 0 && (
                <div><span className="text-gray-500">Expose:</span> <span className="font-mono">{r.ExposeHeaders.join(", ")}</span></div>
              )}
              {r.MaxAgeSeconds != null && (
                <div><span className="text-gray-500">Max-Age:</span> <span className="font-mono">{r.MaxAgeSeconds}s</span></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

// ── Rate Limit (admin only) ──────────────────────────────────────

function RateLimitCard({ bucket, addNotification }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["bucket", bucket, "rate-limit"],
    queryFn: () => apiFetch(`/api/s3/buckets/${bucket}/rate-limit`),
  });
  const rl = data?.rate_limit || null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    enabled: true, max_read_ops: 0, max_write_ops: 0, max_read_bytes: 0, max_write_bytes: 0,
  });

  useEffect(() => {
    if (editing && rl) {
      setDraft({
        enabled: !!rl.enabled,
        max_read_ops: rl.max_read_ops || 0,
        max_write_ops: rl.max_write_ops || 0,
        max_read_bytes: rl.max_read_bytes || 0,
        max_write_bytes: rl.max_write_bytes || 0,
      });
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (next) =>
      apiFetch(`/api/s3/buckets/${bucket}/rate-limit`, {
        method: "PUT",
        body: JSON.stringify(next),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bucket", bucket, "rate-limit"] });
      addNotification("success", "Rate limit updated");
      setEditing(false);
    },
    onError: (e) => addNotification("error", e.message),
  });

  return (
    <SettingsCard
      title="Rate Limit"
      subtitle="Admin-only — per-bucket throughput caps"
      action={!editing && (
        <EditButton onClick={() => setEditing(true)} disabled={isLoading} />
      )}
    >
      {isLoading ? (
        <p className="text-sm text-gray-400 italic">Loading…</p>
      ) : !editing ? (
        !rl ? (
          <p className="text-sm text-gray-400 italic">No rate limit configured.</p>
        ) : (
          <>
            <ReadRow
              label="Status"
              value={
                <span className={`inline-flex items-center gap-1.5 ${rl.enabled ? "text-emerald-600" : "text-gray-500"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${rl.enabled ? "bg-emerald-500" : "bg-gray-400"}`} />
                  {rl.enabled ? "Enabled" : "Disabled"}
                </span>
              }
            />
            <ReadRow label="Max read ops"    value={rl.max_read_ops    || <span className="italic text-gray-400">unlimited</span>} />
            <ReadRow label="Max write ops"   value={rl.max_write_ops   || <span className="italic text-gray-400">unlimited</span>} />
            <ReadRow label="Max read bytes"  value={rl.max_read_bytes  || <span className="italic text-gray-400">unlimited</span>} />
            <ReadRow label="Max write bytes" value={rl.max_write_bytes || <span className="italic text-gray-400">unlimited</span>} />
          </>
        )
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="w-4 h-4 accent-brand-500"
            />
            <span className="text-sm text-gray-700">Enabled</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["max_read_ops",    "Max read ops"],
              ["max_write_ops",   "Max write ops"],
              ["max_read_bytes",  "Max read bytes"],
              ["max_write_bytes", "Max write bytes"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-500">
                  {label} <span className="text-gray-400 font-normal">· 0 = unlimited</span>
                </label>
                <input
                  type="number" min="0" value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                />
              </div>
            ))}
          </div>
          <EditButtons
            onSave={() => mutation.mutate(draft)}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
          />
        </div>
      )}
    </SettingsCard>
  );
}

// ── Panel ─────────────────────────────────────────────────────────

function BucketSettingsPanel({ bucket, addNotification }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!bucket) return null;

  return (
    <div className="space-y-4 max-w-3xl">
      <VersioningCard bucket={bucket} addNotification={addNotification} />
      <ObjectLockCard bucket={bucket} addNotification={addNotification} />
      <TagsCard       bucket={bucket} addNotification={addNotification} />
      <AclCard        bucket={bucket} addNotification={addNotification} />
      <PolicyCard     bucket={bucket} addNotification={addNotification} />
      <CorsCard       bucket={bucket} addNotification={addNotification} />
      {isAdmin && <RateLimitCard bucket={bucket} addNotification={addNotification} />}
    </div>
  );
}

export default BucketSettingsPanel;
