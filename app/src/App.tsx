import { useEffect, type ReactNode } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { Splash } from "./components/Chrome";
import Shell from "./components/Shell";
import { EngineProvider } from "./engine/EngineProvider";
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from "./pages/AuthPages";
import ExportsPage from "./pages/ExportsPage";
import HomePage from "./pages/HomePage";
import LibraryPage from "./pages/LibraryPage";
import NotFoundPage from "./pages/NotFoundPage";
import OverviewPage from "./pages/OverviewPage";
import SettingsPage from "./pages/SettingsPage";
import UploadPage from "./pages/UploadPage";
import VideoDetailPage from "./pages/VideoDetailPage";

const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const Router = desktop ? HashRouter : BrowserRouter;
  return (
    <Router>
      {!desktop && <LegacyHashRedirect />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/signup" element={<GuestOnly><SignUpPage /></GuestOnly>} />
        <Route path="/signin" element={<GuestOnly><SignInPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/overview" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<RequireAuth />}>
          <Route index element={<OverviewPage />} />
          <Route path="videos" element={<LibraryPage />} />
          <Route path="videos/:id" element={<VideoDetailPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}

function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location }} />;
  return (
    <EngineProvider>
      <Shell />
    </EngineProvider>
  );
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Splash />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

function LegacyHashRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const match = window.location.hash.match(/^#\/video\/([\w-]+)$/);
    if (match) navigate(`/app/videos/${match[1]}`, { replace: true });
  }, [navigate]);
  return null;
}
