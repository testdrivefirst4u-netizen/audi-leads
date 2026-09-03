import { useRef, useState } from "react";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import { LEAD_STATUSES, CANONICAL_MODELS, statusColor, pickField, prettify, prettyBucket, bucketColor, BUCKET_ACTIONS } from "../lib/leadFields";
import { WhatsAppIcon, PhoneIcon, NoteIcon, CalendarIcon } from "./icons";

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
}

function formatDateOnly(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString();
}

// A pending follow-up counts as "due" once its date has arrived (today or
// earlier) — that's exactly what makes it eligible for the Snooze action and
// what the backend's completeDueFollowUps() would auto-clear on the next
// remark/call/status change.
function isDue(dateValue) {
  const d = new Date(dateValue);
  d.setHours(23, 59, 59, 999);
  return d.getTime() <= Date.now();
}

function tomorrowISODate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function clearedSuffix(count) {
  return count > 0 ? ` — ${count} overdue follow-up${count === 1 ? "" : "s"} cleared` : "";
}

const TYPE_LABELS = { remark: "Remark", call: "Call", followup: "Follow-up", bucket: "Bucket" };

// One config per activity type, shared between the timeline icon and its
// label pill — remark/call/followup each get a distinct color so the
// activity feed reads at a glance instead of everything looking the same.
const TYPE_STYLE = {
  remark: { Icon: NoteIcon, bg: "#f1f5f9", color: "#475569" },
  call: { Icon: PhoneIcon, bg: "#fffbeb", color: "#b45309" },
  followup: { Icon: CalendarIcon, bg: "#eef2ff", color: "#4338ca" },
};

function TimelineIcon({ type }) {
  // Bucket moves render an emoji glyph instead of an svg Icon — matches the
  // 🔒/🔄 language used everywhere else bucket state is shown.
  if (type === "bucket") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
        style={{ background: "#f5f3ff", color: "#6d28d9" }}
      >
        🎯
      </span>
    );
  }
  const { Icon, bg, color } = TYPE_STYLE[type];
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{ background: bg, color }}
    >
      <Icon width={14} height={14} />
    </span>
  );
}

// Colored-header section, collapsible on request — click the whole header
// to toggle. Non-collapsible sections (collapsible=false) render the same
// header style but ignore clicks, for a consistent look throughout the modal.
function Section({ title, meta, collapsible = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4 last:mb-0">
      <button
        type="button"
        onClick={() => collapsible && setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-md bg-accent-soft px-3 py-1.5 mb-2.5 text-[11px] font-bold uppercase tracking-wide text-accent ${
          collapsible ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="flex items-center gap-2">
          {title}
          {meta && <span className="normal-case font-medium text-muted">{meta}</span>}
        </span>
        {collapsible && (
          <span className="text-sm leading-none w-4 text-center">{open ? "−" : "+"}</span>
        )}
      </button>
      {open && children}
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-0.5">{label}</div>
      <div className="text-sm text-ink">{value || <span className="text-muted">-</span>}</div>
    </div>
  );
}

function EditableField({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-0.5">{label}</div>
      {children}
    </div>
  );
}

const editInputClass = "w-full bg-bg border border-border rounded-md px-2 py-1 text-sm text-ink focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15";

export default function LeadDetailModal({
  lead,
  onClose,
  onUpdated,
  onDeleted,
  agents = [],
  role,
  readOnly,
  onReassign,
  canManageLead,
  manageCompanyId,
  leadFieldColumns = [],
  statuses,
}) {
  const statusOptions = statuses && statuses.length > 0 ? statuses : LEAD_STATUSES;
  const toast = useToast();
  // A toast alone is easy to miss since it appears outside the modal the
  // agent is actually looking at — this mirrors the same info inline, right
  // next to the Save button they just clicked, so cause-and-effect is
  // obvious without relying on catching a corner toast.
  const [clearedBanner, setClearedBanner] = useState(null);
  const clearedBannerTimer = useRef(null);
  function announceFollowUpsCleared(count) {
    if (!count) return;
    setClearedBanner(`${count} overdue follow-up${count === 1 ? "" : "s"} auto-marked done by this update`);
    clearTimeout(clearedBannerTimer.current);
    clearedBannerTimer.current = setTimeout(() => setClearedBanner(null), 6000);
  }
  const [remarkText, setRemarkText] = useState("");
  const [logCall, setLogCall] = useState(false);
  const [callNote, setCallNote] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [followNote, setFollowNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // "Armed" bucket target ("qualified" | "retail") awaiting confirmation —
  // same two-step pattern as deleteArmed above, since a bucket move to
  // Qualified/Retail is just as irreversible as a delete.
  const [bucketArmed, setBucketArmed] = useState(null);
  const [changingBucket, setChangingBucket] = useState(false);

  if (!lead) return null;

  function startEdit() {
    setEditForm({
      name: lead.name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      canonicalModel: lead.canonicalModel || lead.model || CANONICAL_MODELS[0],
    });
    setEditing(true);
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}?companyId=${manageCompanyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update lead");
      const data = await res.json();
      onUpdated(data.lead);
      setEditing(false);
      toast("Lead updated");
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteLead() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}?companyId=${manageCompanyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete lead");
      toast("Lead deleted");
      onDeleted?.(lead._id);
      onClose();
    } catch (err) {
      toast(err.message, { type: "err" });
      setDeleting(false);
      setDeleteArmed(false);
    }
  }

  async function toggleFollowUp(followUpId, completed) {
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/followups/${followUpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update follow-up");
      const data = await res.json();
      onUpdated(data.lead);
      toast(completed ? "Follow-up marked done" : "Follow-up reopened");
    } catch (err) {
      toast(err.message, { type: "err" });
    }
  }

  async function snoozeFollowUp(followUpId) {
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/followups/${followUpId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: tomorrowISODate() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to snooze follow-up");
      const data = await res.json();
      onUpdated(data.lead);
      toast("Follow-up snoozed to tomorrow");
    } catch (err) {
      toast(err.message, { type: "err" });
    }
  }

  // "qualified"/"retail" permanently lock the bucket; "lost" doesn't — the
  // toast wording reflects which one just happened.
  async function changeBucket(targetBucket) {
    setChangingBucket(true);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/bucket`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: targetBucket }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update bucket");
      const data = await res.json();
      onUpdated(data.lead);
      setBucketArmed(null);
      toast(targetBucket === "lost" ? "Bucket moved to Lost" : `Bucket locked to ${prettyBucket(targetBucket)}`);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setChangingBucket(false);
    }
  }

  async function changeStatus(newStatus) {
    setSavingStatus(true);
    try {
      const res = await apiFetch(`/api/leads/${lead._id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update status");
      const data = await res.json();
      onUpdated(data.lead);
      toast(`Status changed to ${newStatus}${clearedSuffix(data.followUpsCleared)}`);
      announceFollowUpsCleared(data.followUpsCleared);
    } catch (err) {
      toast(err.message, { type: "err" });
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
    try {
      let latestLead = lead;
      let followUpsCleared = 0;

      if (remarkText.trim()) {
        const res = await apiFetch(`/api/leads/${lead._id}/remarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: remarkText }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add remark");
        const data = await res.json();
        latestLead = data.lead;
        followUpsCleared += data.followUpsCleared || 0;
      }

      if (logCall) {
        const res = await apiFetch(`/api/leads/${lead._id}/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: callNote }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to log call");
        const data = await res.json();
        latestLead = data.lead;
        followUpsCleared += data.followUpsCleared || 0;
      }

      if (followDate) {
        const res = await apiFetch(`/api/leads/${lead._id}/followups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: followDate, note: followNote }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to schedule follow-up");
        const data = await res.json();
        latestLead = data.lead;
        followUpsCleared += data.followUpsCleared || 0;
      }

      setRemarkText("");
      setLogCall(false);
      setCallNote("");
      setFollowDate("");
      setFollowNote("");
      onUpdated(latestLead);
      toast(`Activity saved${clearedSuffix(followUpsCleared)}`);
      announceFollowUpsCleared(followUpsCleared);
    } catch (err) {
      toast(err.message, { type: "err" });
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
    // Every lead starts in Lost by default — this synthetic entry (not
    // stored in the DB) anchors the timeline so bucket moves below always
    // have a starting point to read from.
    { type: "bucket", at: lead.createdAt, id: "created", text: `Lead created — Bucket: ${prettyBucket(lead.bucket)}` },
    ...(lead.bucketHistory || []).map((h, idx) => ({
      type: "bucket",
      at: h.at,
      id: `move-${idx}`,
      text: h.locked
        ? `Lead moved: ${prettyBucket(h.from)} → ${prettyBucket(h.to)} — 🔒 ${prettyBucket(h.to)} bucket permanently locked${h.by ? ` (by ${h.by})` : ""}`
        : `Lead moved: ${prettyBucket(h.from)} → ${prettyBucket(h.to)}${h.by ? ` (by ${h.by})` : ""}`,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)); // newest first — most relevant activity up top

  const typeRunningCount = { remark: 0, call: 0, followup: 0, bucket: 0 };
  for (const item of [...history].reverse()) {
    typeRunningCount[item.type] += 1;
    item.typeIndex = typeRunningCount[item.type];
  }

  const { bg: statusBg, text: statusText } = statusColor(lead.status);
  const data = lead.data || {};
  const pendingFollowUps = (lead.followUps || []).filter((f) => !f.completed).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-[920px]" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {lead.name || "Lead"} <span className="hint">({lead.model})</span>
          </h2>
          <div className="flex items-center gap-2">
            {canManageLead && !editing && (
              <>
                <button type="button" className="btn-sm" onClick={startEdit}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  style={deleteArmed ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
                  onClick={deleteLead}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : deleteArmed ? "Confirm Delete?" : "Delete Lead"}
                </button>
                {deleteArmed && !deleting && (
                  <button type="button" className="btn-sm" onClick={() => setDeleteArmed(false)}>
                    Cancel
                  </button>
                )}
              </>
            )}
            <button className="btn-icon" onClick={onClose}>
              &times;
            </button>
          </div>
        </div>

        <div className="modal-status-bar">
          <span className="toolbar-label">Status</span>
          {readOnly ? (
            <span className="pill" style={{ background: statusBg, color: statusText, fontWeight: 700 }}>
              {lead.status || "New"}
            </span>
          ) : (
            <select
              value={lead.status || "New"}
              onChange={(e) => changeStatus(e.target.value)}
              disabled={savingStatus}
              style={{ background: statusBg, color: statusText, fontWeight: 700, border: "none" }}
            >
              {/* If this lead somehow holds a status outside the company's
                  current list (e.g. set before the list was reconfigured),
                  show it anyway rather than a silently-mismatched selection. */}
              {(statusOptions.includes(lead.status) ? statusOptions : [lead.status || "New", ...statusOptions]).map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                )
              )}
            </select>
          )}
          <span className="hint">
            Called {(lead.calls || []).length} time{(lead.calls || []).length === 1 ? "" : "s"}
          </span>
          {role === "admin" && !readOnly ? (
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
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
            {/* Main column — reference info, scrolls normally with the modal body */}
            <div className="min-w-0">
              <Section title="Bucket">
                {lead.bucketLocked ? (
                  <div className="flex flex-col gap-1">
                    <span
                      className="pill w-fit"
                      style={{ background: bucketColor(lead.bucket).bg, color: bucketColor(lead.bucket).text, fontWeight: 700 }}
                    >
                      🔒 {prettyBucket(lead.bucket)}
                    </span>
                    <span className="text-xs text-muted">
                      Bucket permanently locked
                      {lead.bucketLockedBy ? ` by ${lead.bucketLockedBy}` : ""}
                      {lead.bucketLockedAt ? ` on ${formatDateOnly(lead.bucketLockedAt)}` : ""}.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <span className="text-sm text-ink">
                      Bucket: <span className="font-semibold">{prettyBucket(lead.bucket || "unassigned")}</span>
                    </span>
                    {!readOnly && (
                      <div className="flex flex-wrap gap-2">
                        {BUCKET_ACTIONS.map((b) => {
                          const currentBucket = lead.bucket || "unassigned";
                          const isCurrent = currentBucket === b;
                          return (
                            <button
                              key={b}
                              type="button"
                              className="btn-sm"
                              style={isCurrent ? { background: "var(--accent-soft-rgb, #eef2ff)", fontWeight: 700 } : undefined}
                              onClick={() => {
                                // Moving to Lost is reversible, so it applies
                                // immediately — Qualified/Retail are
                                // permanent, so they go through the arm +
                                // confirm step below instead.
                                if (b === "lost") {
                                  if (!isCurrent) changeBucket("lost");
                                } else {
                                  setBucketArmed(b);
                                }
                              }}
                              disabled={changingBucket || isCurrent}
                            >
                              {isCurrent ? "✓ " : ""}
                              {prettyBucket(b)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {bucketArmed && (
                      <div className="rounded-lg border border-border bg-bg p-3 flex flex-col gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink m-0">Move this lead to {prettyBucket(bucketArmed)}?</p>
                          <p className="text-xs text-muted m-0 mt-1">
                            Once assigned to {prettyBucket(bucketArmed)}, this lead cannot be moved to another bucket.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className="btn-sm" onClick={() => setBucketArmed(null)} disabled={changingBucket}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-sm"
                            style={{ background: "#f5f3ff", borderColor: "#c4b5fd", color: "#6d28d9" }}
                            onClick={() => changeBucket(bucketArmed)}
                            disabled={changingBucket}
                          >
                            {changingBucket ? "Saving..." : `Confirm ${prettyBucket(bucketArmed)}`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              <Section title="Lead Details">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                  {editing ? (
                    <EditableField label="Model">
                      <select
                        className={editInputClass}
                        value={editForm.canonicalModel}
                        onChange={(e) => setEditForm((f) => ({ ...f, canonicalModel: e.target.value }))}
                      >
                        {CANONICAL_MODELS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </EditableField>
                  ) : (
                    <Field label="Model" value={lead.canonicalModel || lead.model} />
                  )}
                  <Field label="Source" value={lead.source || "Meta Ads"} />
                  {leadFieldColumns.map((col) => (
                    <Field
                      key={col.key}
                      label={col.label}
                      value={prettify(pickField(data, (col.matchers || []).map((m) => new RegExp(m, "i"))))}
                    />
                  ))}
                  <Field label="Created" value={formatDate(lead.sheetCreatedAt)} />
                  <Field
                    label="Repeat Enquiries"
                    value={lead.duplicateCount > 0 ? `${lead.duplicateCount} repeat${lead.duplicateCount === 1 ? "" : "s"}` : "None"}
                  />
                  <Field label="Pending Follow-ups" value={pendingFollowUps > 0 ? pendingFollowUps : "None"} />
                </div>
              </Section>

              <Section title="Customer Details">
                {editing ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                      <EditableField label="Name">
                        <input
                          className={editInputClass}
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        />
                      </EditableField>
                      <EditableField label="Phone">
                        <input
                          className={editInputClass}
                          value={editForm.phone}
                          onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                        />
                      </EditableField>
                      <EditableField label="Email">
                        <input
                          className={editInputClass}
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        />
                      </EditableField>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button type="button" className="btn-sm btn-export" onClick={saveEdit} disabled={savingEdit}>
                        {savingEdit ? "Saving..." : "Save Changes"}
                      </button>
                      <button type="button" className="btn-sm" onClick={() => setEditing(false)} disabled={savingEdit}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                    <Field label="Name" value={lead.name} />
                    <Field label="Phone" value={lead.phone} />
                    <Field label="Email" value={lead.email} />
                  </div>
                )}
              </Section>

              {(lead.enquiryHistory || []).length > 1 && (
                <Section
                  title="Enquiry History"
                  meta={`${lead.enquiryHistory.length} total, ${lead.duplicateCount || 0} repeat`}
                  collapsible
                  defaultOpen={false}
                >
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
                </Section>
              )}

              <Section title="Sheet Details" collapsible defaultOpen={false}>
                <div className="kv-grid">
                  {Object.entries(data).map(([k, v]) => (
                    <div key={k} className="kv-row">
                      <div className="kv-key">{k}</div>
                      <div className="kv-value">{v || "-"}</div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            {/* Side column — activity feed + quick-add, sticky so it's always
                reachable while the reference info on the left scrolls. */}
            <div className="lg:sticky lg:top-0 flex flex-col gap-4 min-w-0">
              {!readOnly && (
                <form
                  onSubmit={handleSave}
                  className="rounded-xl border border-border bg-bg p-3.5 flex flex-col gap-2.5"
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide text-accent">Add Activity</div>

                  <div className="flex gap-2.5 rounded-lg bg-card border border-border px-3 py-2.5 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/15">
                    <NoteIcon className="mt-1.5 shrink-0 text-muted" width={15} height={15} />
                    <div className="flex-1">
                      <label className="block text-[12px] font-semibold text-ink mb-0.5">Remark</label>
                      <input
                        className="w-full border-none bg-transparent p-0 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0"
                        value={remarkText}
                        onChange={(e) => setRemarkText(e.target.value)}
                        placeholder="What did the customer say?"
                      />
                    </div>
                  </div>

                  <div
                    className={`flex gap-2.5 rounded-lg bg-card border px-3 py-2.5 transition-colors ${
                      logCall ? "border-accent ring-[3px] ring-accent/15" : "border-border"
                    }`}
                  >
                    <PhoneIcon className="mt-1.5 shrink-0 text-muted" width={14} height={14} />
                    <div className="flex-1">
                      <label className="flex items-center gap-2 text-[12px] font-semibold text-ink mb-0.5 cursor-pointer select-none">
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
                        placeholder="Note (optional)"
                        disabled={!logCall}
                      />
                    </div>
                  </div>

                  <div
                    className={`flex gap-2.5 rounded-lg bg-card border px-3 py-2.5 transition-colors ${
                      followDate ? "border-accent ring-[3px] ring-accent/15" : "border-border"
                    }`}
                  >
                    <CalendarIcon className="mt-1.5 shrink-0 text-muted" width={15} height={15} />
                    <div className="flex-1 flex flex-col gap-2">
                      <div>
                        <label className="block text-[12px] font-semibold text-ink mb-0.5">Follow-up date</label>
                        <input
                          type="date"
                          className="w-full border-none bg-transparent p-0 text-sm text-ink focus:outline-none focus:ring-0"
                          value={followDate}
                          onChange={(e) => setFollowDate(e.target.value)}
                        />
                      </div>
                      <input
                        className="w-full border-none border-t border-border bg-transparent pt-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
                        value={followNote}
                        onChange={(e) => setFollowNote(e.target.value)}
                        placeholder="Note (optional)"
                        disabled={!followDate}
                      />
                    </div>
                  </div>

                  <button
                    className="btn disabled:opacity-60 w-full justify-center"
                    type="submit"
                    disabled={saving || (!remarkText.trim() && !logCall && !followDate)}
                  >
                    {saving ? "Saving..." : "Save Activity"}
                  </button>

                  {clearedBanner && (
                    <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 px-3 py-2 text-[12px] font-semibold text-success">
                      <CalendarIcon width={13} height={13} className="shrink-0" />
                      {clearedBanner}
                    </div>
                  )}
                </form>
              )}

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3.5 py-2.5 bg-accent-soft text-[11px] font-bold uppercase tracking-wide text-accent"
                >
                  Activity History
                </button>
                <ul className="max-h-[360px] overflow-y-auto px-3.5 py-2 m-0 list-none">
                  {history.map((item) => (
                    <li key={`${item.type}-${item.id}`} className="flex gap-2.5 py-2.5 border-b border-border last:border-0">
                      <TimelineIcon type={item.type} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-ink">
                            {TYPE_LABELS[item.type]} {item.typeIndex}
                          </span>
                          <span className="timeline-date">{item.type === "followup" ? formatDateOnly(item.date) : formatDate(item.at)}</span>
                        </div>
                        {item.type === "followup" ? (
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <label className="followup-row m-0">
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={(e) => toggleFollowUp(item.id, e.target.checked)}
                                disabled={readOnly}
                              />
                              <span className={`text-sm ${item.completed ? "done" : "text-ink"}`}>
                                {item.note || "Follow-up scheduled"}
                              </span>
                            </label>
                            {!readOnly && !item.completed && isDue(item.date) && (
                              <button
                                type="button"
                                className="btn-sm shrink-0"
                                onClick={() => snoozeFollowUp(item.id)}
                                title="Push this follow-up to tomorrow without logging any activity"
                              >
                                Snooze
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-ink mt-0.5">{item.text}</div>
                        )}
                      </div>
                    </li>
                  ))}
                  {history.length === 0 && <li className="hint py-2">No activity yet.</li>}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
