import { Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/layout/Layout";
import LoginPage from "./pages/LoginPage";
import OverviewPage from "./pages/OverviewPage";
import BucketsPage from "./pages/BucketsPage";
import UsersPage from "./pages/UsersPage";
import ClusterPage from "./pages/ClusterPage";
import KeysPage from "./pages/KeysPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="buckets" element={<BucketsPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="cluster" element={<ClusterPage />} />
      </Route>
    </Routes>
  );
}

export default App;
