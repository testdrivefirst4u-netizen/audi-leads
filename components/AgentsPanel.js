import { useEffect, useState, useCallback, useRef } from "react";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import CompanySwitcher from "./CompanySwitcher";
import { SHOWROOM_LOCATIONS } from "../lib/leadFields";

// Multi-select for showroom locations: a button showing the chosen ones,
// opening a checkbox list. Empty selection = "Any (general pool)". Options
// come from the company (Settings.locationOptions / discovered locations /
// default showroom cities — see /api/agents). `onCommit` fires when the
// list closes, so an inline edit saves once, not on every tick.
function LocationMultiSelect({ value, options, onChange, onCommit, compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = Array.isArray(value) ? value : [];
  // Keep a value that is no longer in the option list selectable/visible.
  const all = [...new Set([...(options || []), ...selected])];

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        onCommit?.(selected);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected]);

  function toggle(loc) {
    onChange(selected.includes(loc) ? selected.filter((l) => l !== loc) : [...selected, loc]);
  }

  const label = selected.length === 0 ? "Any (general pool)" : selected.length <= 2 ? selected.join(", ") : `${selected.length} locations`;

  return (
    <div ref={ref} className="relative" style={{ minWidth: compact ? 160 : undefined }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-bg text-left text-ink ${
          compact ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2.5 text-sm"
        } disabled:opacity-60`}
        title={selected.join(", ") || "Any (general pool)"}
      >
        <span className="truncate">{label}</span>
        <span className="text-muted text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[220px] rounded-lg border border-border bg-card p-2 shadow-card">
          <label className="flex items-center gap-2 px-1.5 py-1 text-[13px] cursor-pointer text-muted">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            Any (general pool)
          </label>
          {all.map((loc) => (
            <label key={loc} className="flex items-center gap-2 px-1.5 py-1 text-[13px] cursor-pointer">
              <input type="checkbox" checked={selected.includes(loc)} onChange={() => toggle(loc)} />
              {loc}
            </label>
          ))}
          {all.length === 0 && <div className="hint px-1.5 py-1">No locations configured for this company yet.</div>}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                setOpen(false);
                onCommit?.(selected);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentsPanel({ role }) {
  const toast = useToast();
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [agents, setAgents] = useState([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [locations, setLocations] = useState([]);
  const [locationOptions, setLocationOptions] = useState(SHOWROOM_LOCATIONS);
  // Inline edits: agentId -> pending selection while the dropdown is open.
  const [editing, setEditing] = useState({});
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
    setLocationOptions(data.locationOptions?.length ? data.locationOptions : SHOWROOM_LOCATIONS);
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
        body: JSON.stringify({ name, username, password, locations }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add agent");
      }
      setName("");
      setUsername("");
      setPassword("");
      setLocations([]);
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

  async function saveLocations(agent, newLocations) {
    const current = agent.locations || [];
    if (newLocations.length === current.length && newLocations.every((l) => current.includes(l))) return; // unchanged
    const params = new URLSearchParams();
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    const res = await apiFetch(`/api/agents/${agent._id}${params.toString() ? `?${params}` : ""}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: newLocations }),
    });
    if (res.ok) toast(`${agent.name}'s locations updated${newLocations.length ? `: ${newLocations.join(", ")}` : " — general pool"}`);
    else toast("Failed to update locations", { type: "err" });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[agent._id];
      return next;
    });
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
      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} editable />}

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
                <label>Showroom Locations</label>
                <LocationMultiSelect value={locations} options={locationOptions} onChange={setLocations} />
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
                <th>Locations</th>
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
                        <LocationMultiSelect
                          compact
                          value={editing[a._id] ?? a.locations ?? []}
                          options={locationOptions}
                          onChange={(next) => setEditing((prev) => ({ ...prev, [a._id]: next }))}
                          onCommit={(next) => saveLocations(a, next)}
                        />
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
            New leads auto-assign to the least-loaded active agent whose locations include that lead's showroom. An agent
            with no locations is in the general pool. If no agent covers that location (or the lead has no location filled
            in), it falls back to the least-loaded agent from
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
                      <td className="text-muted">{a.locations?.length ? a.locations.join(", ") : "Any"}</td>
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
