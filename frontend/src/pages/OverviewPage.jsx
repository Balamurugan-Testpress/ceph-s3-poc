import { useAuth } from "../context/AuthContext";
import QuotaUsage from "../components/QuotaUsage";
import ClusterStatus from "../components/ClusterStatus";

export default function OverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ceph cluster status and system metrics.
        </p>
      </div>

      {isAdmin ? (
        <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <h2 className="m-0 mb-4 text-lg text-gray-800 font-semibold">
            Cluster Health
          </h2>
          <ClusterStatus />
        </section>
      ) : (
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
