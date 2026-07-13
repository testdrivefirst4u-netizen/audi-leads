import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../lib/apiFetch";

export default function AgentsPanel() {
  const [agents, setAgents] = useState([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/agents");
    if (!res.ok) return;
    const data = await res.json();
    setAgents(data.agents || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add agent");
      }
      setName("");
      setUsername("");
      setPassword("");
      setMessage({ type: "ok", text: "Agent added." });
      load();
    } catch (err) {
      setMessage({ type: "err", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(agent) {
    await apiFetch(`/api/agents/${agent._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !agent.active }),
    });
    load();
  }

  return (
    <div className="panel mt-6">
      <div className="panel-header">
        <h2>Agents</h2>
      </div>

      <div className="p-5">
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end mb-5">
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
          <div className="sm:col-span-3">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Agent"}
            </button>
            {message && <span className={`save-msg ${message.type} ml-3 inline-block`}>{message.text}</span>}
          </div>
        </form>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Leads Assigned</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a._id}>
                <td>{a.name}</td>
                <td className="text-muted">{a.username}</td>
                <td>{a.leadCount}</td>
                <td>
                  <span className={`pill ${a.active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                    {a.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <button className="btn-sm" onClick={() => toggleActive(a)}>
                    {a.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No agents yet — add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="hint mt-3">
          New leads auto-assign to whichever active agent currently has the fewest, so the queue stays even.
          Deactivating an agent stops new assignments but keeps their existing leads with them.
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
              <th>Leads</th>
              <th>Contacted</th>
              <th>Won</th>
              <th>Lost</th>
              <th>Win Rate</th>
              <th>Calls Made</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a._id}>
                <td>{a.name}</td>
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
                <td colSpan={7} className="empty-state">
                  No agent activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
