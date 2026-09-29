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

const TRANSFER_OPTIONS = [
  { mode: "auto", title: "Share among active agents", body: "Each lead goes to the least-busy agent who covers its showroom — the same rule new leads use." },
  { mode: "agent", title: "Move all to one agent", body: "Hand the whole list to a single agent." },
  { mode: "unassign", title: "Unassign them", body: "Leads go back to Unassigned so you can assign them from the Leads page." },
  { mode: "keep", title: "Keep them with this agent", body: "Nothing moves. Nobody will work these leads while the agent is inactive." },
];

// Asks where a departing agent's leads should go before deactivating them —
// otherwise their open leads silently stay with someone who can't log in.
function DeactivateAgentDialog({ agent, otherAgents, companyQuery, onClose, onDone }) {
  // Also used for an already-inactive agent who still holds leads: then it only moves them.
  const moveOnly = !agent.active;
  const toast = useToast();
  const [counts, setCounts] = useState(null);
  const [mode, setMode] = useState(otherAgents.length ? "auto" : "unassign");
  const [toAgentId, setToAgentId] = useState(otherAgents[0]?._id || "");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/agents/${agent._id}${companyQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && setCounts(data?.leads || { total: agent.leadCount, open: agent.leadCount, closed: 0 }));
    return () => {
      cancelled = true;
    };
  }, [agent, companyQuery]);

  const moving = counts ? (includeClosed ? counts.total : counts.open) : 0;
  const needsOthers = mode === "auto" || mode === "agent";

  async function confirm() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/agents/${agent._id}${companyQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false, transfer: { mode, toAgentId: mode === "agent" ? toAgentId : undefined, includeClosed } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't deactivate the agent");
      const t = data.transferred;
      const verb = moveOnly ? `${agent.name}'s leads updated` : `${agent.name} deactivated`;
      if (!t || t.moved === 0) toast(moveOnly ? "No leads to move" : verb);
      else if (mode === "unassign") toast(`${verb} · ${t.moved} leads moved to Unassigned`);
      else toast(`${verb} · ${t.moved} leads moved to ${t.byAgent.map((b) => `${b.name} (${b.count})`).join(", ")}`);
      onDone();
    } catch (err) {
      toast(err.message, { type: "err" });
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-[560px]" role="dialog" aria-modal="true" aria-labelledby="deactivate-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="deactivate-title">{moveOnly ? `Move ${agent.name}'s leads` : `Deactivate ${agent.name}?`}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body flex flex-col gap-4">
          <p className="m-0 text-[14px] text-muted">
            {moveOnly
              ? `${agent.name} is inactive, so nobody is working these leads. Choose who should get them.`
              : `${agent.name} won't be able to log in and won't get new leads. Choose what happens to the leads they have now.`}
          </p>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              ["Total leads", counts?.total],
              ["Open", counts?.open],
              ["Won / lost", counts?.closed],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-bg px-3.5 py-3">
                <div className="text-[12px] text-muted">{label}</div>
                <div className="mt-1 text-[24px] font-bold leading-none tracking-[-0.03em] tabular-nums">{value ?? <Skeleton width={36} />}</div>
              </div>
            ))}
          </div>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-[13px] font-semibold text-ink">Move their leads</legend>
            {TRANSFER_OPTIONS.filter((o) => !(moveOnly && o.mode === "keep")).map((o) => {
              const disabled = (o.mode === "auto" || o.mode === "agent") && otherAgents.length === 0;
              const selected = mode === o.mode;
              return (
                <label
                  key={o.mode}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
                    selected ? "border-accent bg-accent-soft" : "border-border bg-card hover:bg-bg"
                  } ${disabled ? "pointer-events-none opacity-50" : ""}`}
                >
                  <input type="radio" name="transfer-mode" className="mt-0.5 accent-[rgb(var(--accent-rgb))]" checked={selected} disabled={disabled} onChange={() => setMode(o.mode)} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-ink">{o.title}</span>
                    <span className="text-[12.5px] text-muted">{disabled ? "No other active agents in this company." : o.body}</span>
                    {o.mode === "agent" && selected && (
                      <select
                        aria-label="Agent to receive the leads"
                        className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-ink"
                        value={toAgentId}
                        onChange={(e) => setToAgentId(e.target.value)}
                      >
                        {otherAgents.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.name} · {a.leadCount} leads{a.locations?.length ? ` · ${a.locations.join(", ")}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {mode !== "keep" && (
            <label className="flex items-start gap-2.5 text-[13px] text-ink">
              <input type="checkbox" className="mt-0.5" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              <span>
                Also move won and lost leads
                <span className="block text-[12px] text-muted">Off by default, so past results stay credited to {agent.name}.</span>
              </span>
            </label>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-border px-6 py-4">
          <button className="btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={moveOnly ? "btn" : "btn bg-danger hover:bg-danger/90"} onClick={confirm} disabled={saving || !counts || (moveOnly && moving === 0) || (needsOthers && otherAgents.length === 0) || (mode === "agent" && !toAgentId)}>
            {saving
              ? "Saving..."
              : moveOnly
              ? `Move ${moving} leads`
              : mode === "keep" || moving === 0
              ? "Deactivate"
              : `Deactivate and move ${moving} leads`}
          </button>
        </div>
      </div>
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
  const [phone, setPhone] = useState("");
  const [locationOptions, setLocationOptions] = useState(SHOWROOM_LOCATIONS);
  // Inline edits: agentId -> pending selection while the dropdown is open.
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteArmedId, setDeleteArmedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deactivating, setDeactivating] = useState(null); // agent whose deactivate dialog is open
  const companyQuery = isSuperAdminView && viewCompanyId ? `?companyId=${viewCompanyId}` : "";

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
        body: JSON.stringify({ name, username, password, locations, phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add agent");
      }
      setName("");
      setUsername("");
      setPassword("");
      setLocations([]);
      setPhone("");
      toast("Agent added");
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(agent) {
    // Deactivating first asks where the agent's leads should go.
    if (agent.active) {
      setDeactivating(agent);
      return;
    }
    const res = await apiFetch(`/api/agents/${agent._id}${companyQuery}`, {
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

      {deactivating && (
        <DeactivateAgentDialog
          agent={deactivating}
          otherAgents={agents.filter((a) => a.active && a._id !== deactivating._id)}
          companyQuery={companyQuery}
          onClose={() => setDeactivating(null)}
          onDone={() => {
            setDeactivating(null);
            load();
          }}
        />
      )}

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
              <div className="field mb-0">
                <label>
                  Phone <span className="text-muted font-normal">(for campaign messages)</span>
                </label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
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
                        {/* Deactivate is temporary (reactivate any time); Delete
                            is permanent and super-admin only. */}
                        <div className="flex justify-end gap-2">
                          {!a.active && a.leadCount > 0 && (
                            <button className="btn-sm" onClick={() => setDeactivating(a)}>
                              Move leads
                            </button>
                          )}
                          <button className="btn-sm" onClick={() => toggleActive(a)} disabled={isSuperAdminView && !viewCompanyId}>
                            {a.active ? "Deactivate" : "Reactivate"}
                          </button>
                          {isSuperAdminView && (
                            <button
                              className="btn-sm"
                              style={deleteArmedId === a._id ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
                              onClick={() => handleDelete(a)}
                              disabled={deletingId === a._id}
                            >
                              {deletingId === a._id ? "Deleting..." : deleteArmedId === a._id ? "Confirm Delete?" : "Delete"}
                            </button>
                          )}
                        </div>
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
            the general pool ("Any"). Deactivating an agent stops their logins and new assignments, and asks where their
            current leads should go{isSuperAdminView && " — deleting an agent outright unassigns their leads instead, rather than leaving them pointed at a removed agent"}.
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
