import { useState } from "react";
import Skeleton from "react-loading-skeleton";
import LeadDetailModal from "./LeadDetailModal";
import { FaWhatsapp } from "react-icons/fa6";
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
  SHOWROOM_LOCATIONS,
} from "../lib/leadFields";
import { WhatsAppIcon, SortIcon, FireIcon } from "./icons";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
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

// Classification badge for duplicate detection — repeat enquiries take
// priority over the original new/existing-customer classification since
// it's the more actionable signal for a rep looking at the table.
function LeadTypeBadge({ lead }) {
  if ((lead.duplicateCount || 0) > 0) {
    return (
      <span className="pill bg-[#fffbeb] text-[#b45309]" title={`${lead.duplicateCount + 1} total enquiries for this model`}>
        🟡 Repeat Enquiry ({lead.duplicateCount + 1}x)
      </span>
    );
  }
  if (lead.leadType === "new_model_existing_customer") {
    return (
      <span className="pill bg-[#eff6ff] text-[#1d4ed8]" title="This customer already has a lead for a different model">
        🔵 New Model
      </span>
    );
  }
  return (
    <span className="pill bg-[#ecfdf5] text-[#047857]">🟢 New Lead</span>
  );
}

const NEW_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

function NameCell({ lead }) {
  const isNew = lead.sheetCreatedAt && Date.now() - new Date(lead.sheetCreatedAt).getTime() < NEW_LEAD_WINDOW_MS;
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
        <FaWhatsapp className="text-green-500"/>
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

function AgentCell({ lead, agents, role, readOnly, onReassign }) {
  if (role !== "admin" || readOnly) {
    return <span className="text-muted">{lead.assignedTo?.name || "Unassigned"}</span>;
  }
  return (
    <select
      value={lead.assignedTo?._id || ""}
      onChange={(e) => onReassign(lead._id, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="text-[13px]"
    >
      <option value="">Unassigned</option>
      {agents.map((a) => (
        <option key={a._id} value={a._id}>
          {a.name}
        </option>
      ))}
    </select>
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
  loading,
  search,
  onSearchChange,
  model,
  onModelChange,
  models,
  status,
  onStatusChange,
  agentFilter,
  onAgentFilterChange,
  locationFilter,
  onLocationFilterChange,
  sourceFilter,
  onSourceFilterChange,
  sources,
  followUpFilter,
  onFollowUpFilterChange,
  followUpTabs,
  agents,
  role,
  readOnly,
  onReassign,
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

  async function handleReassign(leadId, agentId) {
    const updated = await onReassign(leadId, agentId);
    if (updated && selected?._id === leadId) setSelected(updated);
  }

  function handleUpdated(updatedLead) {
    setSelected(updatedLead);
    onLeadUpdated?.(updatedLead);
  }

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  const followUpTabList = [
    { key: "", label: "All Leads", count: total },
    { key: "overdue", label: "Overdue", count: followUpTabs?.overdue || 0 },
    { key: "today", label: "Due Today", count: followUpTabs?.today || 0 },
    { key: "upcoming", label: "Upcoming", count: followUpTabs?.upcoming || 0 },
    { key: "completed", label: "Completed", count: followUpTabs?.completed || 0 },
  ];

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

      {onFollowUpFilterChange && (
        <div className="flex flex-wrap gap-2 px-5 pt-4">
          {followUpTabList.map((tab) => {
            const active = (followUpFilter || "") === tab.key;
            return (
              <button
                key={tab.key || "all"}
                type="button"
                onClick={() => onFollowUpFilterChange(tab.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-accent text-white border-accent"
                    : "bg-card text-ink border-border hover:border-accent/50"
                }`}
              >
                {tab.label}
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[20px] text-[11px] font-bold ${
                    active ? "bg-white/20 text-white" : "bg-bg text-muted"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

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

        {role === "admin" && (
          <div className="toolbar-group">
            <label className="toolbar-label">Agent</label>
            <select value={agentFilter} onChange={(e) => onAgentFilterChange(e.target.value)}>
              <option value="">All agents</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="toolbar-group">
          <label className="toolbar-label">Location</label>
          <select value={locationFilter} onChange={(e) => onLocationFilterChange(e.target.value)}>
            <option value="">All locations</option>
            {SHOWROOM_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            <option value="Other">Other</option>
            <option value="unfilled">Not Filled</option>
          </select>
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label">Source</label>
          <select value={sourceFilter} onChange={(e) => onSourceFilterChange(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label">Created Date</label>
          <select value={exportPreset} onChange={(e) => onExportPresetChange(e.target.value)}>
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
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

      {loading ? (
        <div className="p-5">
          <Skeleton count={8} height={36} className="mb-2" />
        </div>
      ) : leads.length === 0 ? (
        <div className="empty-state">
          {hotOnly ? "No hot leads right now." : "No leads yet. Configure your Google Sheet in Settings."}
        </div>
      ) : (
        <>
          {/* Mobile card list — the 17-column table below is unusable on a
              phone even with the sticky action column, so small screens get
              a stacked card per lead instead (tap anywhere to open). */}
          <div className="sm:hidden flex flex-col gap-2.5 px-4 pb-3">
            {leads.map((lead) => {
              const remark = latestRemarkText(lead);
              return (
                <div
                  key={lead._id}
                  onClick={() => setSelected(lead)}
                  className="rounded-xl border border-border bg-card p-3.5 cursor-pointer active:bg-bg transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <NameCell lead={lead} />
                    <StatusBadge status={lead.status} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <ModelBadge lead={lead} />
                    <LeadTypeBadge lead={lead} />
                  </div>
                  <div onClick={(e) => e.stopPropagation()} className="mb-2">
                    <PhoneCell phone={lead.phone} />
                  </div>
                  {remark && <div className="remark-cell text-xs text-muted mb-2">{remark}</div>}
                  <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-border">
                    <span onClick={(e) => e.stopPropagation()}>
                      <AgentCell lead={lead} agents={agents} role={role} readOnly={readOnly} onReassign={handleReassign} />
                    </span>
                    <FollowUpBadge lead={lead} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="table-scroll hidden sm:block">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <SortableHeader label="Model" field="canonicalModel" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th
                    className="sortable-th sticky left-0 z-[1] bg-[#fafbfd]"
                    onClick={() => onSortChange("name")}
                  >
                    <span className="sortable-th-inner">
                      Name
                      <SortIcon direction={sortBy === "name" ? sortDir : null} />
                    </span>
                  </th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Agent</th>
                  <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th>Calls</th>
                  <th>Campaign</th>
                  <th>Purchase Timeline</th>
                  <th>Exchange Plan</th>
                  <th>Showroom</th>
                  <th>Latest Remark</th>
                  <th>Next Follow-up</th>
                  <SortableHeader label="Created" field="sheetCreatedAt" sortBy={sortBy} sortDir={sortDir} onSort={onSortChange} />
                  <th className="sticky right-0 z-[1] bg-[#fafbfd]"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, index) => {
                  const remark = latestRemarkText(lead);
                  return (
                    <tr
                      key={lead._id}
                      onClick={() => setSelected(lead)}
                      className="cursor-pointer hover:bg-bg transition-colors"
                    >
                      <td className="text-muted">{(page - 1) * pageSize + index + 1}</td>
                      <td>
                        <ModelBadge lead={lead} />
                      </td>
                      <td className="sticky left-0 z-[1] bg-card">
                        <NameCell lead={lead} />
                      </td>
                      <td>
                        <LeadTypeBadge lead={lead} />
                      </td>
                      <td className="text-muted">{lead.source || "Google Sheet"}</td>
                      <td>
                        <PhoneCell phone={lead.phone} />
                      </td>
                      <td className="text-muted">{lead.email || "-"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <AgentCell lead={lead} agents={agents} role={role} readOnly={readOnly} onReassign={handleReassign} />
                      </td>
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
                      <td className="text-muted">{formatDate(lead.sheetCreatedAt)}</td>
                      <td className="sticky right-0 z-[1] bg-card" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-sm" onClick={() => setSelected(lead)}>
                          {readOnly ? "View" : "Manage"}
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

      {selected && (
        <LeadDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          agents={agents}
          role={role}
          readOnly={readOnly}
          onReassign={handleReassign}
        />
      )}
    </div>
  );
}
