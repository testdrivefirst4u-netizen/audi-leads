import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Layout({ children, username, role }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar username={username} role={role} onLogout={handleLogout} />
      <main className="flex-1 min-w-0 p-8">
        <div className="max-w-[1400px] mx-auto">
          <TopBar />
          {children}
        </div>
      </main>
    </div>
  );
}
