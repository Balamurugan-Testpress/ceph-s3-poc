import AuditLogs from "../components/AuditLogs";

export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Audit Logs</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track all administrative actions and system events.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="p-6">
          <AuditLogs />
        </div>
      </div>
    </div>
  );
}
