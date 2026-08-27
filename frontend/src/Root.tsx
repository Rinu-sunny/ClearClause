import { useState } from "react";
import App from "./App";
import AdminLogin from "./components/AdminLogin";
import AdminPanel from "./components/AdminPanel";
import VoiceCallPage from "./components/VoiceCallPage";

export default function Root() {
  const path = window.location.pathname;
  const isAdminRoute = path.startsWith("/admin");
  const isCallRoute = path.startsWith("/call");
  const [token, setToken] = useState<string | null>(localStorage.getItem("cc_admin_token"));

  if (isCallRoute) return <VoiceCallPage />;
  if (!isAdminRoute) return <App />;
  if (!token) return <AdminLogin onLogin={setToken} />;
  return (
    <AdminPanel
      token={token}
      onLogout={() => {
        localStorage.removeItem("cc_admin_token");
        setToken(null);
      }}
    />
  );
}