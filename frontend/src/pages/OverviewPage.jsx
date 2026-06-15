import { useAuth } from "../context/AuthContext";
import QuotaUsage from "../components/QuotaUsage";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export default function OverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: bucketsData } = useQuery({
    queryKey: ["buckets"],
    queryFn: () => apiFetch("/api/rgw/buckets"),
  });
  const bucketCount = bucketsData?.buckets?.length || 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500 mt-1">
          Welcome back to the Ceph S3 Dashboard.
        </p>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-sm font-medium text-gray-500">Total Buckets</h3>
            <p className="text-3xl font-semibold text-gray-900 mt-2">{bucketCount}</p>
          </div>
          {/* We will add more high-level stats here later */}
        </div>
      )}

      {!isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
            <h2 className="m-0 mb-4 text-lg text-gray-800 font-semibold">
              My Storage Quota
            </h2>
            <QuotaUsage />
          </section>
        </div>
      )}
    </div>
  );
}
