import { useState } from "react";
import LeadDetailModal from "./LeadDetailModal";
import { pickField, FIELD_MATCHERS } from "../lib/leadFields";

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function nextFollowUpLabel(lead) {
  const pending = (lead.followUps || [])
    .filter((f) => !f.completed)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!pending.length) return "-";
  return new Date(pending[0].date).toLocaleDateString();
}

function latestRemarkText(lead) {
  const remarks = lead.remarks || [];
  if (!remarks.length) return "-";
  return remarks[remarks.length - 1].text;
}

export default function LeadsTable({ leads, search, onSearchChange, onLeadUpdated }) {
  const [selected, setSelected] = useState(null);

  function handleUpdated(updatedLead) {
    setSelected(updatedLead);
    onLeadUpdated?.(updatedLead);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Leads ({leads.length})</h2>
        <input
          className="search-input"
          placeholder="Search name, phone, email..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {leads.length === 0 ? (
        <div className="empty-state">No leads yet. Configure your Google Sheet in Settings.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Created</th>
                <th>Campaign</th>
                <th>Purchase Timeline</th>
                <th>Exchange Plan</th>
                <th>Showroom</th>
                <th>Latest Remark</th>
                <th>Next Follow-up</th>
                <th>Updated At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead._id}>
                  <td>{lead.model || "-"}</td>
                  <td>{lead.name || "-"}</td>
                  <td>{lead.phone || "-"}</td>
                  <td>{lead.email || "-"}</td>
                  <td>{pickField(lead.data, FIELD_MATCHERS.createdTime) || "-"}</td>
                  <td>{pickField(lead.data, FIELD_MATCHERS.campaign) || "-"}</td>
                  <td>{pickField(lead.data, FIELD_MATCHERS.purchaseTimeline) || "-"}</td>
                  <td>{pickField(lead.data, FIELD_MATCHERS.exchangePlan) || "-"}</td>
                  <td>{pickField(lead.data, FIELD_MATCHERS.showroom) || "-"}</td>
                  <td>{latestRemarkText(lead)}</td>
                  <td>{nextFollowUpLabel(lead)}</td>
                  <td>{formatTime(lead.updatedAt)}</td>
                  <td>
                    <button className="btn-sm" onClick={() => setSelected(lead)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <LeadDetailModal lead={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
