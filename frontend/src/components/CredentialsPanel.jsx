import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Key, Trash2, Plus } from "lucide-react";

function CredentialsPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["s3keys"],
    queryFn: () => apiFetch("/api/rgw/keys"),
    enabled: !!user,
  });

  const keys = data?.keys || [];
  const primaryKey = user?.rgw_access_key;

  const generateMutation = useMutation({
    mutationFn: () => apiFetch("/api/rgw/keys", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries(["s3keys"]),
    onError: (err) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (accessKey) => apiFetch(`/api/rgw/keys/${accessKey}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries(["s3keys"]),
    onError: (err) => setError(err.message),
  });

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 m-0">
          Use these credentials for AWS CLI, SDKs, or third-party S3 tools.
        </p>
        <button
          onClick={() => {
            setError(null);
            generateMutation.mutate();
          }}
          disabled={generateMutation.isLoading}
          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-brand-500 text-white rounded hover:bg-brand-600 transition-colors disabled:opacity-60"
        >
          <Plus className="w-3.5 h-3.5" />
          {generateMutation.isLoading ? "Generating..." : "Generate Key"}
        </button>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      {isLoading ? (
        <div className="text-sm text-gray-400 italic">Loading keys...</div>
      ) : keys.length === 0 ? (
        <div className="text-sm text-gray-400 italic">No keys found.</div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => {
            const isPrimary = k.access_key === primaryKey;
            return (
              <div key={k.access_key} className="bg-gray-50 rounded border border-gray-200 p-3 flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-semibold text-gray-600">Access Key:</span>
                    <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border border-gray-100">{k.access_key}</code>
                    {isPrimary && (
                      <span className="text-[10px] uppercase bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">Primary</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 ml-6">Secret Key:</span>
                    <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border border-gray-100">{k.secret_key}</code>
                  </div>
                </div>
                
                {!isPrimary && (
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this access key? Any applications using it will lose access immediately.")) {
                        deleteMutation.mutate(k.access_key);
                      }
                    }}
                    disabled={deleteMutation.isLoading}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Delete Key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CredentialsPanel;
