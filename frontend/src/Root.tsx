import { useState } from "react";
import App from "./App";
import AdminLogin from "./components/AdminLogin";
import AdminPanel from "./components/AdminPanel";

export default function Root() {
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const [token, setToken] = useState<string | null>(localStorage.getItem("cc_admin_token"));

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