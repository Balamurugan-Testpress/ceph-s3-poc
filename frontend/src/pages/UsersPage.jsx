import { useState } from "react";
import AdminUsers from "../components/AdminUsers";
import RGWUsers from "../components/RGWUsers";

export default function UsersPage() {
  const [activeTab, setActiveTab] = useState("admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage dashboard admins and Ceph RGW users.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("admin")}
              className={`py-4 px-1 border-b-2 font-medium text-sm mr-8 ${
                activeTab === "admin"
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Dashboard Admins
            </button>
            <button
              onClick={() => setActiveTab("rgw")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "rgw"
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              Ceph RGW Users
            </button>
          </nav>
        </div>
        
        <div className="p-6">
          {activeTab === "admin" ? <AdminUsers /> : <RGWUsers />}
        </div>
      </div>
    </div>
  );
}
