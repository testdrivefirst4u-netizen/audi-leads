import { useState } from "react";
import { apiFetch } from "../lib/apiFetch";

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function formatDateOnly(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

export default function LeadDetailModal({ lead, onClose, onUpdated }) {
  const [remarkText, setRemarkText] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const [followNote, setFollowNote] = useState("");
  const [savingFollow, setSavingFollow] = useState(false);
  const [error, setError] = useState(null);

  if (!lead) return null;

  async function addRemark(e) {
    e.preventDefault();
    if (!remarkText.trim()) return;
    setSavingRemark(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/remarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: remarkText }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add remark");
      const data = await res.json();
      setRemarkText("");
      onUpdated(data.lead);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRemark(false);
    }
  }

  async function addFollowUp(e) {
    e.preventDefault();
    if (!followDate) return;
    setSavingFollow(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/followups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: followDate, note: followNote }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule follow-up");
      const data = await res.json();
      setFollowDate("");
      setFollowNote("");
      onUpdated(data.lead);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFollow(false);
    }
  }

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

  const sortedFollowUps = [...(lead.followUps || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const reversedRemarks = [...(lead.remarks || [])].reverse();

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

        <div className="modal-body">
          <section>
            <h3>Details</h3>
            <div className="kv-grid">
              {Object.entries(lead.data || {}).map(([k, v]) => (
                <div key={k} className="kv-row">
                  <div className="kv-key">{k}</div>
                  <div className="kv-value">{v || "-"}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3>Remarks</h3>
            <form onSubmit={addRemark} className="inline-form">
              <input
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                placeholder="Add a remark..."
              />
              <button className="btn" type="submit" disabled={savingRemark}>
                Add
              </button>
            </form>
            <ul className="timeline">
              {reversedRemarks.map((r) => (
                <li key={r._id}>
                  <span className="timeline-date">{formatDate(r.createdAt)}</span>
                  <span>{r.text}</span>
                </li>
              ))}
              {reversedRemarks.length === 0 && <li className="hint">No remarks yet.</li>}
            </ul>
          </section>

          <section>
            <h3>Follow-ups</h3>
            <form onSubmit={addFollowUp} className="inline-form">
              <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} required />
              <input
                value={followNote}
                onChange={(e) => setFollowNote(e.target.value)}
                placeholder="Note (optional)"
              />
              <button className="btn" type="submit" disabled={savingFollow}>
                Schedule
              </button>
            </form>
            <ul className="timeline">
              {sortedFollowUps.map((f) => (
                <li key={f._id}>
                  <label className="followup-row">
                    <input
                      type="checkbox"
                      checked={f.completed}
                      onChange={(e) => toggleFollowUp(f._id, e.target.checked)}
                    />
                    <span className={f.completed ? "done" : ""}>
                      {formatDateOnly(f.date)}
                      {f.note ? ` — ${f.note}` : ""}
                    </span>
                  </label>
                </li>
              ))}
              {sortedFollowUps.length === 0 && <li className="hint">No follow-ups scheduled.</li>}
            </ul>
          </section>

          {error && <div className="save-msg err">{error}</div>}
        </div>
      </div>
    </div>
  );
}
