import { useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { LEAD_STATUSES, statusColor } from "../lib/leadFields";
import { WhatsAppIcon, PhoneIcon, NoteIcon, CalendarIcon } from "./icons";

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function formatDateOnly(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

const TYPE_LABELS = { remark: "Remark", call: "Call", followup: "Follow-up" };

export default function LeadDetailModal({ lead, onClose, onUpdated, agents = [], role, onReassign }) {
  const [showDetails, setShowDetails] = useState(false);
  const [remarkText, setRemarkText] = useState("");
  const [logCall, setLogCall] = useState(false);
  const [callNote, setCallNote] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [followNote, setFollowNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState(null);

  if (!lead) return null;

  async function toggleFollowUp(followUpId, completed) {
    setError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/followups/${followUpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update follow-up");
      const data = await res.json();
      onUpdated(data.lead);
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeStatus(newStatus) {
    setSavingStatus(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update status");
      const data = await res.json();
      onUpdated(data.lead);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingStatus(false);
    }
  }

  // One Save button covers all three activity fields — only the ones
  // actually filled in (or the "Log a call" checkbox) get submitted.
  async function handleSave(e) {
    e.preventDefault();
    if (!remarkText.trim() && !logCall && !followDate) return;
    setSaving(true);
    setError(null);
    try {
      let latestLead = lead;

      if (remarkText.trim()) {
        const res = await apiFetch(`/api/leads/${lead._id}/remarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: remarkText }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add remark");
        latestLead = (await res.json()).lead;
      }

      if (logCall) {
        const res = await apiFetch(`/api/leads/${lead._id}/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: callNote }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to log call");
        latestLead = (await res.json()).lead;
      }

      if (followDate) {
        const res = await apiFetch(`/api/leads/${lead._id}/followups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: followDate, note: followNote }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule follow-up");
        latestLead = (await res.json()).lead;
      }

      setRemarkText("");
      setLogCall(false);
      setCallNote("");
      setFollowDate("");
      setFollowNote("");
      onUpdated(latestLead);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Remarks, calls, and follow-ups are three separate sub-collections on the
  // lead, but reps think of them as one activity history — merge them into a
  // single chronological timeline. Each entry is labeled with its own
  // per-type count ("Remark 1", "Call 1", "Remark 2"...) rather than one
  // shared position number, so the label reads naturally on its own.
  const history = [
    ...(lead.remarks || []).map((r) => ({ type: "remark", at: r.createdAt, id: r._id, text: r.text })),
    ...(lead.calls || []).map((c) => ({ type: "call", at: c.calledAt, id: c._id, text: c.note || "Called" })),
    ...(lead.followUps || []).map((f) => ({
      type: "followup",
      at: f.createdAt,
      id: f._id,
      date: f.date,
      note: f.note,
      completed: f.completed,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const typeRunningCount = { remark: 0, call: 0, followup: 0 };
  for (const item of history) {
    typeRunningCount[item.type] += 1;
    item.typeIndex = typeRunningCount[item.type];
  }

  const { bg: statusBg, text: statusText } = statusColor(lead.status);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {lead.name || "Lead"} <span className="hint">({lead.model})</span>
          </h2>
          <button className="btn-icon" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-status-bar">
          <span className="toolbar-label">Status</span>
          <select
            value={lead.status || "New"}
            onChange={(e) => changeStatus(e.target.value)}
            disabled={savingStatus}
            style={{ background: statusBg, color: statusText, fontWeight: 700, border: "none" }}
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="hint">
            Called {(lead.calls || []).length} time{(lead.calls || []).length === 1 ? "" : "s"}
          </span>
          {role === "admin" ? (
            <select
              value={lead.assignedTo?._id || ""}
              onChange={(e) => onReassign?.(lead._id, e.target.value)}
              className="text-[13px]"
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            lead.assignedTo?.name && <span className="pill bg-accent-soft text-accent">{lead.assignedTo.name}</span>
          )}
          {lead.phone && (
            <span className="phone-cell" style={{ marginLeft: "auto" }}>
              <a href={`tel:+${lead.phone}`} title="Call">
                <PhoneIcon /> {lead.phone}
              </a>
              <a
                href={`https://wa.me/${lead.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="whatsapp-link"
                title="Chat on WhatsApp"
              >
                <WhatsAppIcon />
              </a>
            </span>
          )}
        </div>

        <div className="modal-body">
          <section>
            <button type="button" className="details-toggle" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? "▾" : "▸"} Sheet Details
            </button>
            {showDetails && (
              <div className="kv-grid">
                {Object.entries(lead.data || {}).map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <div className="kv-key">{k}</div>
                    <div className="kv-value">{v || "-"}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(lead.enquiryHistory || []).length > 1 && (
            <section>
              <h3>Enquiry History ({lead.enquiryHistory.length} total, {lead.duplicateCount || 0} repeat)</h3>
              <ul className="timeline">
                {[...lead.enquiryHistory]
                  .sort((a, b) => new Date(a.date) - new Date(b.date))
                  .map((e, i) => (
                    <li key={`${e.model}-${e.rowNumber}-${i}`}>
                      <span className={`pill ${i === 0 ? "bg-[#ecfdf5] text-[#047857]" : "bg-[#fef2f2] text-[#b91c1c]"}`}>
                        {i === 0 ? "🟢 Original" : "🔴 Duplicate Lead"}
                      </span>
                      <span className="timeline-date">{formatDate(e.date)}</span>
                      <span className="text-muted">{e.model}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section>
            <h3>History</h3>
            <ul className="timeline">
              {history.map((item) => (
                <li key={`${item.type}-${item.id}`}>
                  <span className={`pill timeline-type timeline-type-${item.type}`}>
                    {TYPE_LABELS[item.type]} {item.typeIndex}
                  </span>
                  {item.type === "followup" ? (
                    <label className="followup-row">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(e) => toggleFollowUp(item.id, e.target.checked)}
                      />
                      <span className={item.completed ? "done" : ""}>
                        {formatDateOnly(item.date)}
                        {item.note ? ` — ${item.note}` : ""}
                      </span>
                    </label>
                  ) : (
                    <>
                      <span className="timeline-date">{formatDate(item.at)}</span>
                      <span>{item.text}</span>
                    </>
                  )}
                </li>
              ))}
              {history.length === 0 && <li className="hint">No activity yet.</li>}
            </ul>
          </section>

          <section>
            <h3>Add Activity</h3>
            <form onSubmit={handleSave} className="rounded-xl border border-border bg-bg p-4 flex flex-col gap-3">
              <div className="flex gap-3 rounded-lg bg-card border border-border px-3.5 py-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15">
                <NoteIcon className="mt-2 shrink-0 text-muted" />
                <div className="flex-1">
                  <label className="block text-[13px] font-semibold text-ink mb-1">Remark</label>
                  <input
                    className="w-full border-none bg-transparent p-0 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0"
                    value={remarkText}
                    onChange={(e) => setRemarkText(e.target.value)}
                    placeholder="What did the customer say?"
                  />
                </div>
              </div>

              <div
                className={`flex gap-3 rounded-lg bg-card border px-3.5 py-3 transition-colors ${
                  logCall ? "border-accent ring-[3px] ring-accent/15" : "border-border"
                }`}
              >
                <PhoneIcon className="mt-2 shrink-0 text-muted" width={16} height={16} />
                <div className="flex-1">
                  <label className="flex items-center gap-2 text-[13px] font-semibold text-ink mb-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={logCall}
                      onChange={(e) => setLogCall(e.target.checked)}
                      className="accent-accent"
                    />
                    Log a call
                  </label>
                  <input
                    className="w-full border-none bg-transparent p-0 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                    value={callNote}
                    onChange={(e) => setCallNote(e.target.value)}
                    placeholder="Note (optional) — e.g. no answer, interested"
                    disabled={!logCall}
                  />
                </div>
              </div>

              <div
                className={`flex gap-3 rounded-lg bg-card border px-3.5 py-3 transition-colors ${
                  followDate ? "border-accent ring-[3px] ring-accent/15" : "border-border"
                }`}
              >
                <CalendarIcon className="mt-2 shrink-0 text-muted" />
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-semibold text-ink mb-1">Follow-up date</label>
                    <input
                      type="date"
                      className="w-full border-none bg-transparent p-0 text-sm text-ink focus:outline-none focus:ring-0"
                      value={followDate}
                      onChange={(e) => setFollowDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-ink mb-1">Note</label>
                    <input
                      className="w-full border-none bg-transparent p-0 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                      value={followNote}
                      onChange={(e) => setFollowNote(e.target.value)}
                      placeholder="Optional"
                      disabled={!followDate}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="hint m-0">Only the fields you fill in get saved.</span>
                <button
                  className="btn disabled:opacity-60"
                  type="submit"
                  disabled={saving || (!remarkText.trim() && !logCall && !followDate)}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </section>

          {error && <div className="save-msg err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
