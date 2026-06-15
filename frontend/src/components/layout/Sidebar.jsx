import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  LayoutDashboard,
  Users,
  Database,
  Key,
} from "lucide-react";

export default function Sidebar() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const navItems = [
    { name: "Overview", path: "/", icon: LayoutDashboard },
    { name: "Buckets", path: "/buckets", icon: Database },
    { name: "Access Keys", path: "/keys", icon: Key },
  ];

  if (isAdmin) {
    navItems.push({ name: "Users", path: "/users", icon: Users });
  }

  return (
    <aside className="w-64 bg-sidebar-bg flex flex-col transition-all duration-300">
      <div className="h-16 flex items-center px-6 border-b border-gray-800">
        <div className="flex items-center gap-2 text-brand-500">
          <Database className="w-6 h-6" />
          <span className="font-bold text-lg tracking-tight text-white">
            Ceph <span className="text-brand-500">S3</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-active text-sidebar-textActive"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-white"
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.name}
          </NavLink>
        ))}
      </nav>

    </aside>
  );
}
