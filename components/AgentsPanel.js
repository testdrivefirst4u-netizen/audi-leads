import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import CompanySwitcher from "./CompanySwitcher";
import { SHOWROOM_LOCATIONS } from "../lib/leadFields";

export default function AgentsPanel({ role }) {
  const toast = useToast();
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [agents, setAgents] = useState([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteArmedId, setDeleteArmedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    if (isSuperAdminView && !viewCompanyId) return;
    const params = new URLSearchParams();
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    const res = await apiFetch(`/api/agents${params.toString() ? `?${params.toString()}` : ""}`);
    if (!res.ok) return;
    const data = await res.json();
    setAgents(data.agents || []);
    setLoading(false);
  }, [isSuperAdminView, viewCompanyId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const params = new URLSearchParams();
      if (isSuperAdminView) params.set("companyId", viewCompanyId);
      const res = await apiFetch(`/api/agents${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password, location }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add agent");
      }
      setName("");
      setUsername("");
      setPassword("");
      setLocation("");
      toast("Agent added");
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(agent) {
    const res = await apiFetch(`/api/agents/${agent._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !agent.active }),
    });
    if (res.ok) toast(agent.active ? `${agent.name} deactivated` : `${agent.name} reactivated`);
    else toast("Failed to update agent", { type: "err" });
    load();
  }

  async function changeLocation(agent, newLocation) {
    const res = await apiFetch(`/api/agents/${agent._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: newLocation }),
    });
    if (res.ok) toast(`${agent.name}'s location updated`);
    else toast("Failed to update location", { type: "err" });
    load();
  }

  async function handleDelete(agent) {
    if (deleteArmedId !== agent._id) {
      setDeleteArmedId(agent._id);
      return;
    }
    setDeletingId(agent._id);
    try {
      const params = new URLSearchParams({ companyId: viewCompanyId });
      const res = await apiFetch(`/api/agents/${agent._id}?${params.toString()}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete agent");
      }
      toast(`${agent.name} deleted — their leads are now Unassigned`);
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setDeletingId(null);
      setDeleteArmedId(null);
    }
  }

  return (
    <div>
      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} />}

      <div className="panel mt-6">
        <div className="panel-header">
          <h2>Agents</h2>
        </div>

        <div className="p-5">
          {/* Adding an agent is a super-admin-only action now — a company's
              own admin can view and day-to-day manage (activate/relocate)
              agents below, but can no longer create new ones themselves. */}
          {isSuperAdminView && (
            <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-5">
              <div className="field mb-0">
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi Kumar" required />
              </div>
              <div className="field mb-0">
                <label>Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ravi" required />
              </div>
              <div className="field mb-0">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="field mb-0">
                <label>Showroom Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">Any (general pool)</option>
                  {SHOWROOM_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4">
                <button className="btn" type="submit" disabled={saving || !viewCompanyId}>
                  {saving ? "Adding..." : "Add Agent"}
                </button>
              </div>
            </form>
          )}

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Location</th>
                <th>Leads Assigned</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}><Skeleton /></td>
                    ))}
                  </tr>
                ))
              ) : (
                <>
                  {agents.map((a) => (
                    <tr key={a._id}>
                      <td>{a.name}</td>
                      <td className="text-muted">{a.username}</td>
                      <td>
                        {isSuperAdminView ? (
                          a.location || "Any (general pool)"
                        ) : (
                          <select value={a.location || ""} onChange={(e) => changeLocation(a, e.target.value)}>
                            <option value="">Any (general pool)</option>
                            {SHOWROOM_LOCATIONS.map((loc) => (
                              <option key={loc} value={loc}>
                                {loc}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{a.leadCount}</td>
                      <td>
                        <span className={`pill ${a.active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                          {a.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        {isSuperAdminView ? (
                          <button
                            className="btn-sm"
                            style={deleteArmedId === a._id ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
                            onClick={() => handleDelete(a)}
                            disabled={deletingId === a._id}
                          >
                            {deletingId === a._id ? "Deleting..." : deleteArmedId === a._id ? "Confirm Delete?" : "Delete"}
                          </button>
                        ) : (
                          <button className="btn-sm" onClick={() => toggleActive(a)}>
                            {a.active ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-state">
                        {isSuperAdminView ? "No agents yet — add one above." : "No agents yet — ask your platform admin to add one."}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
          <div className="hint mt-3">
            New leads auto-assign to the least-loaded active agent covering that lead's showroom location. If no agent
            covers that location (or the lead has no location filled in), it falls back to the least-loaded agent from
            the general pool ("Any"). Deactivating an agent stops new assignments but keeps their existing leads with
            them{isSuperAdminView && " — deleting an agent outright unassigns their leads instead, rather than leaving them pointed at a removed agent"}.
          </div>
        </div>

        <div className="panel-header border-t border-border">
          <h2>Agent Performance</h2>
        </div>
        <div className="p-5">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Location</th>
                <th>Leads</th>
                <th>Contacted</th>
                <th>Won</th>
                <th>Lost</th>
                <th>Win Rate</th>
                <th>Calls Made</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j}><Skeleton /></td>
                    ))}
                  </tr>
                ))
              ) : (
                <>
                  {agents.map((a) => (
                    <tr key={a._id}>
                      <td>{a.name}</td>
                      <td className="text-muted">{a.location || "Any"}</td>
                      <td>{a.leadCount}</td>
                      <td>{a.contacted}</td>
                      <td className="text-success font-semibold">{a.won}</td>
                      <td className="text-danger font-semibold">{a.lost}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="bar-track w-20">
                            <div className="bar-fill" style={{ width: `${a.winRate}%` }} />
                          </div>
                          <span className="text-muted text-xs">{a.winRate}%</span>
                        </div>
                      </td>
                      <td>{a.calls}</td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty-state">
                        No agent activity yet.
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
