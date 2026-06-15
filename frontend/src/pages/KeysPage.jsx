import CredentialsPanel from "../components/CredentialsPanel";

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Access Keys</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your S3 credentials for CLI, SDKs, and third-party tools.
        </p>
      </div>

      <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100 max-w-3xl">
        <CredentialsPanel />
      </section>
    </div>
  );
}
