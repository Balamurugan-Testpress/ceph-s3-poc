import { useAuth } from "../context/AuthContext";
import QuotaUsage from "../components/QuotaUsage";
import ClusterStatus from "../components/ClusterStatus";
import KpiTiles from "../components/dashboard/KpiTiles";
import StorageBreakdown from "../components/dashboard/StorageBreakdown";
import StorageTrend from "../components/dashboard/StorageTrend";
import ActivityTimeline from "../components/dashboard/ActivityTimeline";
import UsersUsageTable from "../components/dashboard/UsersUsageTable";
import CollapsibleSection from "../components/dashboard/CollapsibleSection";

export default function OverviewPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Dashboard
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isAdmin
            ? "Cluster-wide storage, usage, and activity at a glance."
            : "Your storage, buckets, and recent activity."}
        </p>
      </div>

      <KpiTiles isAdmin={isAdmin} />

      {!isAdmin && (
        <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h2 className="m-0 mb-4 text-base text-gray-900 font-semibold">
            My Storage Quota
          </h2>
          <QuotaUsage />
        </section>
      )}

      {/* Trend is a full-width "hero" chart so the eye gets the macro view
          before drilling into the side-by-side comparisons below. */}
      <StorageTrend isAdmin={isAdmin} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StorageBreakdown isAdmin={isAdmin} />
        <ActivityTimeline isAdmin={isAdmin} />
      </div>

      {isAdmin && <UsersUsageTable />}

      {isAdmin && (
        <CollapsibleSection
          title="Cluster Health"
          subtitle="OSDs, monitors, pools, raw capacity"
          defaultOpen={false}
        >
          <ClusterStatus />
        </CollapsibleSection>
      )}
    </div>
  );
}
