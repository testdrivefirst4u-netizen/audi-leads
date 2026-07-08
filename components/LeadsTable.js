import { useState } from "react";
import LeadDetailModal from "./LeadDetailModal";
import {
  pickField,
  FIELD_MATCHERS,
  prettify,
  modelColor,
  avatarColor,
  initials,
  nextFollowUp,
} from "../lib/leadFields";

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function latestRemarkText(lead) {
  const remarks = lead.remarks || [];
  if (!remarks.length) return null;
  return remarks[remarks.length - 1].text;
}

function ModelBadge({ model }) {
  if (!model) return <span>-</span>;
  const { bg, text } = modelColor(model);
  return (
    <span className="pill" style={{ background: bg, color: text }}>
      {model}
    </span>
  );
}

function NameCell({ lead }) {
  return (
    <div className="lead-name-cell">
      <div className="avatar-sm" style={{ background: avatarColor(lead.name) }}>
        {initials(lead.name)}
      </div>
      <span>{lead.name || "-"}</span>
    </div>
  );
}

function FollowUpBadge({ lead }) {
  const info = nextFollowUp(lead);
  if (!info) return <span className="hint">-</span>;
  const label = info.date.toLocaleDateString();
  return <span className={`pill followup-${info.status}`}>{label}</span>;
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
        <div className="table-scroll">
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
              {leads.map((lead) => {
                const remark = latestRemarkText(lead);
                return (
                  <tr key={lead._id}>
                    <td>
                      <ModelBadge model={lead.model} />
                    </td>
                    <td>
                      <NameCell lead={lead} />
                    </td>
                    <td>{lead.phone || "-"}</td>
                    <td className="text-muted">{lead.email || "-"}</td>
                    <td>{pickField(lead.data, FIELD_MATCHERS.createdTime) || "-"}</td>
                    <td>{pickField(lead.data, FIELD_MATCHERS.campaign) || "-"}</td>
                    <td>{prettify(pickField(lead.data, FIELD_MATCHERS.purchaseTimeline)) || "-"}</td>
                    <td>{prettify(pickField(lead.data, FIELD_MATCHERS.exchangePlan)) || "-"}</td>
                    <td>{prettify(pickField(lead.data, FIELD_MATCHERS.showroom)) || "-"}</td>
                    <td className="remark-cell" title={remark || ""}>
                      {remark || <span className="hint">-</span>}
                    </td>
                    <td>
                      <FollowUpBadge lead={lead} />
                    </td>
                    <td className="text-muted">{formatTime(lead.updatedAt)}</td>
                    <td>
                      <button className="btn-sm" onClick={() => setSelected(lead)}>
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <LeadDetailModal lead={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
