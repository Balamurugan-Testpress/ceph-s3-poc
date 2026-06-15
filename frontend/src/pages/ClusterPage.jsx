import { useAuth } from "../context/AuthContext";
import ClusterStatus from "../components/ClusterStatus";

export default function ClusterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return <div className="p-8 text-red-600">Access Denied</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Cluster Health</h1>
        <p className="text-sm text-gray-500 mt-1">
          Deep dive into Ceph OSDs, Monitors, and system performance.
        </p>
      </div>

      <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
        <h2 className="m-0 mb-4 text-lg text-gray-800 font-semibold">
          System Metrics
        </h2>
        <ClusterStatus />
      </section>
    </div>
  );
}
