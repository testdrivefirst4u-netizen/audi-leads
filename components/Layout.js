import { useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { brandColorTriplets } from "../lib/color";

export default function Layout({ children, username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const triplets = brandColorTriplets(companyBrandColor);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* Overrides the platform-default accent CSS vars (see :root in
          globals.css) only when this company has its own brandColor set —
          scoped to this subtree so it never leaks across companies sharing
          one session-less render. */}
      {triplets && (
        <style jsx global>{`
          :root {
            --accent-rgb: ${triplets.accent};
            --accent-hover-rgb: ${triplets.hover};
            --accent-soft-rgb: ${triplets.soft};
          }
        `}</style>
      )}
      <Sidebar
        username={username}
        role={role}
        companyName={companyName}
        companyLogoUrl={companyLogoUrl}
        onLogout={handleLogout}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <main className="flex-1 min-w-0 p-4 sm:p-8">
        <div className="max-w-[1400px] mx-auto">
          <TopBar onMenuClick={() => setMobileNavOpen(true)} role={role} />
          {children}
        </div>
      </main>
    </div>
  );
}
