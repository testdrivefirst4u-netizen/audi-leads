import { useState } from "react";
import { useRouter } from "next/router";
import { getSessionFromCookieHeader } from "../lib/auth";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (session) {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: {} };
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Login failed");
      }
      router.push("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-[#eef1fb] via-[#f3f5f9] to-[#eef2ff]">
      <form
        className="bg-card border border-border rounded-2xl shadow-login w-full max-w-[380px] px-8 py-9"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px] bg-sidebar shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/broaddcast-logo.svg"
              alt="Broaddcast"
              className="h-[16px] w-auto object-contain brightness-0 invert"
            />
          </div>
          <span className="text-[15px] font-bold text-ink">Broaddcast Leads Platform</span>
        </div>
        <h1 className="m-0 mb-1 text-xl font-bold text-ink">Welcome back</h1>
        <p className="text-[13px] text-muted m-0 mb-6">Sign in to view and manage your company's leads.</p>

        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>

        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        <button className="btn w-full py-2.5 text-sm mt-1" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>

        {error && <div className="save-msg err">{error}</div>}

        <div className="flex items-center justify-center gap-1.5 mt-6 pt-4 border-t border-border text-[11px] text-muted uppercase tracking-wide">
          <span>Developed by</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/broaddcast-logo.svg" alt="Broaddcast" className="object-contain w-auto h-12" />
        </div>
      </form>
    </div>
  );
}
