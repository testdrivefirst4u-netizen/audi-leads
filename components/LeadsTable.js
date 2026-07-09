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
  LEAD_STATUSES,
  statusColor,
} from "../lib/leadFields";
import { WhatsAppIcon, SortIcon, FireIcon } from "./icons";

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function latestRemarkText(lead) {
  const remarks = lead.remarks || [];
  if (!remarks.length) return null;
  return remarks[remarks.length - 1].text;
}

function ModelBadge({ lead }) {
  const label = lead.canonicalModel || lead.model;
  if (!label) return <span>-</span>;
  const { bg, text } = modelColor(label);
  return (
    <span className="pill" style={{ background: bg, color: text }} title={lead.model !== label ? lead.model : undefined}>
      {label}
    </span>
  );
}

const NEW_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

function NameCell({ lead }) {
  const isNew = lead.createdAt && Date.now() - new Date(lead.createdAt).getTime() < NEW_LEAD_WINDOW_MS;
  return (
    <div className="lead-name-cell">
      <div className="avatar-sm" style={{ background: avatarColor(lead.name) }}>
        {initials(lead.name)}
      </div>
      <span>{lead.name || "-"}</span>
      {isNew && <span className="pill pill-new">New</span>}
    </div>
  );
}

function PhoneCell({ phone }) {
  if (!phone) return <span>-</span>;
  return (
    <span className="phone-cell">
      <a href={`tel:+${phone}`} onClick={(e) => e.stopPropagation()} title="Call">
        {phone}
      </a>
      <a
        href={`https://wa.me/${phone}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="whatsapp-link"
        title="Chat on WhatsApp"
      >
        <WhatsAppIcon />
      </a>
    </span>
  );
}

function FollowUpBadge({ lead }) {
  const info = nextFollowUp(lead);
  if (!info) return <span className="hint">-</span>;
  const label = info.date.toLocaleDateString();
  return <span className={`pill followup-${info.status}`}>{label}</span>;
}

function StatusBadge({ status }) {
  const { bg, text } = statusColor(status);
  return (
    <span className="pill" style={{ background: bg, color: text }}>
      {status || "New"}
    </span>
  );
}

function SortableHeader({ label, field, sortBy, sortDir, onSort }) {
  const active = sortBy === field;
  return (
    <th className="sortable-th" onClick={() => onSort(field)}>
      <span className="sortable-th-inner">
        {label}
        <SortIcon direction={active ? sortDir : null} />
      </span>
    </th>
  );
}

export default function LeadsTable({
  leads,
  search,
  onSearchChange,
  model,
  onModelChange,
  models,
  status,
  onStatusChange,
  hotOnly,
  onHotOnlyChange,
  sortBy,
  sortDir,
  onSortChange,
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  exportPreset,
  onExportPresetChange,
  customRange,
  onCustomRangeChange,
  onExport,
  exporting,
  onLeadUpdated,
}) {
  const [selected, setSelected] = useState(null);

  function handleUpdated(updatedLead) {
    setSelected(updatedLead);
    onLeadUpdated?.(updatedLead);
  }

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Leads ({total})</h2>
        <input
          className="search-input"
          placeholder="Search name, phone, email..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="table-toolbar">
        <div className="toolbar-group">
          <label className="toolbar-label">Model</label>
          <select value={model} onChange={(e) => onModelChange(e.target.value)}>
            <option value="">All models</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label">Status</label>
          <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label">Export Range</label>
          <select value={exportPreset} onChange={(e) => onExportPresetChange(e.target.value)}>
            <option value="all">All time</option>
            <option value="1m">Last 1 month</option>
            <option value="2m">Last 2 months</option>
            <option value="3m">Last 3 months</option>
            <option value="custom">Custom range</option>
          </select>
        </div>

        {exportPreset === "custom" && (
          <>
            <div className="toolbar-group">
              <label className="toolbar-label">From</label>
              <input
                type="date"
                value={customRange.from}
                onChange={(e) => onCustomRangeChange({ ...customRange, from: e.target.value })}
              />
            </div>

            <div className="toolbar-group">
              <label className="toolbar-label">To</label>
              <input
                type="date"
                value={customRange.to}
                onChange={(e) => onCustomRangeChange({ ...customRange, to: e.target.value })}
              />
            </div>
          </>
        )}

        <button
          className={`btn-sm btn-hot ${hotOnly ? "active" : ""}`}
          onClick={() => onHotOnlyChange(!hotOnly)}
          title="Urgent leads with no calls or remarks yet"
        >
          <FireIcon /> Hot Leads
        </button>

        <button className="btn-sm btn-export" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting..." : "Export to Excel"}
        </button>
      </div>

      {leads.length === 0 ? (
        <div className="empty-state">
          {hotOnly ? "No hot leads right now." : "No leads yet. Configure your Google Sheet in Settings."}
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <SortableHeader label="Model" field="canonicalModel" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <SortableHeader label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th>Phone</th>
                  <th>Email</th>
                  <th>created_time</th>
                  <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th>Calls</th>
                  <th>Campaign</th>
                  <th>Purchase Timeline</th>
                  <th>Exchange Plan</th>
                  <th>Showroom</th>
                  <th>Latest Remark</th>
                  <th>Next Follow-up</th>
                  <SortableHeader label="Created" field="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <SortableHeader label="Updated At" field="updatedAt" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, index) => {
                  const remark = latestRemarkText(lead);
                  return (
                    <tr key={lead._id}>
                      <td className="text-muted">{(page - 1) * pageSize + index + 1}</td>
                      <td>
                        <ModelBadge lead={lead} />
                      </td>
                      <td>
                        <NameCell lead={lead} />
                      </td>
                      <td>
                        <PhoneCell phone={lead.phone} />
                      </td>
                      <td className="text-muted">{lead.email || "-"}</td>
                      <td >{lead.created_time}</td>
                      <td>
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="text-muted">{(lead.calls || []).length}</td>
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
                      <td className="text-muted">{formatTime(lead.createdAt)}</td>
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

          <div className="pagination">
            <span className="hint">
              {firstRow}-{lastRow} of {total}
            </span>
            <div className="pagination-controls">
              <button className="btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Prev
              </button>
              <span className="hint">
                Page {page} of {totalPages}
              </span>
              <button className="btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && <LeadDetailModal lead={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
