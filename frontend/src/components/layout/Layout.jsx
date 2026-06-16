import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import UploadsTray from "../UploadsTray";
import { UploadsProvider } from "../../context/UploadsContext";

export default function Layout() {
  return (
    <UploadsProvider>
      <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-8">
            <div className="max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
        <UploadsTray />
      </div>
    </UploadsProvider>
  );
}
