import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ClusterStatus from "../components/ClusterStatus";
import BucketExplorer from "../components/BucketExplorer";
import "./Dashboard.css";

function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-left">
          <h1>Ceph S3 Dashboard</h1>
          <span className="dashboard-greeting">
            {user?.display_name || user?.username}
            <span className="dashboard-role"> ({user?.role})</span>
          </span>
        </div>
        <button className="sign-out-btn" onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-section">
          <h2>Cluster Status</h2>
          <ClusterStatus />
        </section>

        <section className="dashboard-section">
          <h2>Buckets &amp; Objects</h2>
          <BucketExplorer />
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
