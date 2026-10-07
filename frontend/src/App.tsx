import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import AccountsPage from "./pages/AccountsPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import DashboardPage from "./pages/DashboardPage";
import FitPage from "./pages/FitPage";
import LoginPage from "./pages/LoginPage";
import LogsPage from "./pages/LogsPage";
import MatrixPage from "./pages/MatrixPage";
import PipelineEditorPage from "./pages/PipelineEditorPage";
import PipelinesPage from "./pages/PipelinesPage";
import SettingsPage from "./pages/SettingsPage";
import { useAuthStore } from "./stores/authStore";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const loadMe = useAuthStore((s) => s.loadMe);

  useEffect(() => {
    if (token) void loadMe();
  }, [token, loadMe]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/pipelines" element={<PipelinesPage />} />
        <Route path="/pipelines/:id" element={<PipelineEditorPage />} />
        <Route path="/matrix" element={<MatrixPage />} />
        <Route path="/fit" element={<FitPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
