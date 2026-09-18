import { useCallback, useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

// Super-admin view of every login across the platform (who, which company,
// from where, on what device, success/failed) plus who is online right now.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role !== "super_admin") return { redirect: { destination: "/", permanent: false } };
  return { props: { username: session.username } };
}

const ROLE_META = {
  super_admin: { label: "Super admin", cls: "bg-accent-soft text-accent" },
  admin: { label: "Admin", cls: "bg-[#eef3ff] text-[#1d4ed8]" },
  agent: { label: "Agent", cls: "bg-[#ecfdf5] text-[#047857]" },
  unknown: { label: "Unknown", cls: "bg-bg text-muted" },
};

function DeviceIcon({ type }) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true };
  if (type === "mobile")
    return (
      <svg {...common}>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
    );
  if (type === "tablet")
    return (
      <svg {...common}>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
    );
  if (type === "bot")
    return (
      <svg {...common}>
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M12 4v4M8 13h.01M16 13h.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString();
}

export default function LoginActivityPage({ username }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ companyId, role, status, q, page: String(page), pageSize: "50" });
    const res = await apiFetch(`/api/login-activity?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [companyId, role, status, q, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Keep "online now" fresh.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Layout username={username} role="super_admin">
      <h1 className="page-title mb-1">Login Activity</h1>
      <p className="hint mb-5">Every sign-in across the platform — who, which company, from where and on what device — and who is online right now.</p>

      <div className="dash-stat-grid">
        {[
          ["Online now", data?.online?.length, "#1baf7a", "active in the last 5 minutes"],
          ["Logins today", data?.today?.logins, "rgb(var(--accent-rgb))", `${data?.today?.uniqueUsers ?? 0} different user${data?.today?.uniqueUsers === 1 ? "" : "s"}`],
          ["Failed attempts today", data?.today?.failed, data?.today?.failed ? "#e5484d" : "#94a3b8", "wrong password / unknown user / locked out"],
          ["Events (filtered)", data?.total, "#2a78d6", "matching the filters below"],
        ].map(([label, value, accent, caption]) => (
          <div className="dash-card" key={label} style={{ "--dash-accent": accent }}>
            <div className="label">{label}</div>
            <div className="value">{loading && !data ? <Skeleton width={50} /> : value ?? 0}</div>
            <div className="dash-card-caption">{caption}</div>
          </div>
        ))}
      </div>

      {data?.online?.length > 0 && (
        <div className="panel mb-6">
          <div className="panel-header">
            <h2>Online now</h2>
          </div>
          <div className="flex flex-wrap gap-2 p-5">
            {data.online.map((u) => (
              <span key={`${u.role}-${u.username}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px]">
                <span className="h-2 w-2 rounded-full bg-success" />
                <strong>{u.name || u.username}</strong>
                <span className={`pill ${ROLE_META[u.role]?.cls}`}>{ROLE_META[u.role]?.label}</span>
                <span className="text-muted">{u.companyName}</span>
                <span className="hint m-0">{ago(u.lastSeenAt)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header flex-wrap gap-3">
          <h2>Sign-in history</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input className="search-input" placeholder="Search user, name or IP…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }} className="text-[13px]">
              <option value="">All companies</option>
              {(data?.companies || []).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="text-[13px]">
              <option value="">All roles</option>
              <option value="super_admin">Super admin</option>
              <option value="admin">Company admin</option>
              <option value="agent">Agent</option>
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="text-[13px]">
              <option value="all">Success + failed</option>
              <option value="success">Successful only</option>
              <option value="failed">Failed only</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Company</th>
                <th>Device</th>
                <th>IP</th>
                <th>Location</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}>
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data?.events?.length ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No sign-ins recorded yet. Logins are recorded from now on.
                  </td>
                </tr>
              ) : (
                data.events.map((e) => (
                  <tr key={e._id} className={e.success ? "" : "bg-danger/5"} onClick={() => setOpen(open === e._id ? null : e._id)} style={{ cursor: "pointer" }}>
                    <td className="text-muted whitespace-nowrap" title={new Date(e.at).toLocaleString()}>
                      <div>{new Date(e.at).toLocaleString()}</div>
                      <div className="hint m-0">{ago(e.at)}</div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <strong>{e.name || e.username}</strong>
                        <span className={`pill ${ROLE_META[e.role]?.cls}`}>{ROLE_META[e.role]?.label}</span>
                      </div>
                      {e.name && <div className="hint m-0">{e.username}</div>}
                    </td>
                    <td className="text-muted">{e.companyName || "—"}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <DeviceIcon type={e.deviceType} />
                        <span>
                          {e.browser || "Unknown browser"}
                          {e.os ? ` · ${e.os}` : ""}
                        </span>
                      </div>
                      <div className="hint m-0 capitalize">{e.deviceType}</div>
                      {open === e._id && <div className="hint mt-1 whitespace-normal" style={{ maxWidth: 420 }}>{e.userAgent}</div>}
                    </td>
                    <td>
                      <code className="text-[12px]">{e.ip || "—"}</code>
                    </td>
                    <td className="text-muted">{[e.city, e.region, e.country].filter(Boolean).join(", ") || "—"}</td>
                    <td>
                      {e.success ? (
                        <span className="pill bg-success/10 text-success">Signed in</span>
                      ) : (
                        <>
                          <span className="pill bg-danger/10 text-danger">Failed</span>
                          <div className="hint m-0 whitespace-normal">{e.reason}</div>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="pagination">
            <span className="hint">
              Page {data.page} of {data.totalPages} · {data.total.toLocaleString()} events
            </span>
            <div className="pagination-controls">
              <button className="btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <button className="btn-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
