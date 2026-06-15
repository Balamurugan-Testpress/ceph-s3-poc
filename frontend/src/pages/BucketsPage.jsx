import BucketExplorer from "../components/BucketExplorer";

export default function BucketsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Buckets & Objects</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your S3 buckets, upload files, and perform actions.
        </p>
      </div>

      <div>
        <div>
          <section className="bg-white rounded-lg p-6 shadow-sm border border-gray-100 h-full">
            <BucketExplorer />
          </section>
        </div>
      </div>
    </div>
  );
}
