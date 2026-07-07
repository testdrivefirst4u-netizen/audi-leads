import { useRouter } from "next/router";
import Sidebar from "./Sidebar";

export default function Layout({ children, username }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="app-shell">
      <Sidebar username={username} onLogout={handleLogout} />
      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
    </div>
  );
}
