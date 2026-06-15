import { useAuth } from "../../context/AuthContext";
import { LogOut, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm shrink-0">
      <div className="flex items-center text-sm font-medium text-gray-700">
        {/* Breadcrumbs or Context Title could go here */}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold">
            <User className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-gray-900 leading-tight">
              {user?.display_name || user?.username}
            </span>
            <span className="text-xs text-gray-500 capitalize leading-tight">
              {user?.role}
            </span>
          </div>
        </div>
        <div className="w-px h-6 bg-gray-200 mx-2"></div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-red-600 transition-colors"
          title="Sign Out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
