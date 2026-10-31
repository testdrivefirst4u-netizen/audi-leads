import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FiPlus, FiCheckCircle } from "react-icons/fi";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import { CANONICAL_MODELS } from "../lib/leadFields";
import { getViewCompany } from "../lib/viewCompany";
import FloatingWindow from "./FloatingWindow";

// Kept in step with MANUAL_SOURCES in pages/api/leads/manual.js.
const SOURCES = ["Walk-in", "Phone call", "Referral", "Other"];
const EMPTY = { name: "", phone: "", email: "", model: "", source: "Walk-in", note: "" };

const isDirty = (form) => Object.keys(EMPTY).some((k) => k !== "source" && form[k].trim());

/**
 * Top bar "+ New lead": for the walk-ins and phone enquiries that never come
 * through a sheet or a Meta form. Opens in a FloatingWindow — draggable,
 * minimizable, and the page behind keeps working, so a customer can be
 * looked up mid-entry. Saved through /api/leads/manual, which merges a
 * repeat enquiry into the existing lead instead of duplicating it. A super
 * admin adds to the company picked in the top bar.
 */
export default function QuickAddLead({ role }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // { name, leadId, phone, duplicate }
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const firstField = useRef(null);

  const focusFirst = () => setTimeout(() => firstField.current?.focus(), 0);

  function openWindow() {
    setOpen(true);
    setMinimized(false);
    focusFirst();
  }

  const minimize = useCallback(() => {
    setConfirmDiscard(false);
    setMinimized(true);
  }, []);

  function reset() {
    setForm(EMPTY);
    setError(null);
    setSaved(null);
    setConfirmDiscard(false);
  }

  function close() {
    // typed something and not saved yet: ask first (the window shows it un-minimized)
    if (!saved && isDirty(form) && !confirmDiscard) {
      setMinimized(false);
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
    setMinimized(false);
    reset();
  }

  const set = (key) => (e) => {
    setConfirmDiscard(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Add the customer's name.");
    if (!form.phone.trim() && !form.email.trim()) return setError("Add a phone number or an email.");
    setSaving(true);
    try {
      const company = role === "super_admin" ? getViewCompany() : null;
      if (role === "super_admin" && !company) throw new Error("Pick a company in the top bar first.");
      const url = company ? `/api/leads/manual?companyId=${encodeURIComponent(company.id)}` : "/api/leads/manual";
      const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the lead");
      const duplicate = data.status === "duplicate";
      setSaved({ name: data.name, leadId: data.leadId, phone: data.phone, duplicate });
      toast(duplicate ? `${data.name} already exists — added as a repeat enquiry` : `${data.name} added`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openSavedLead() {
    const { phone, name, leadId } = saved;
    setOpen(false);
    reset();
    router.push(`/leads?q=${encodeURIComponent(phone || name)}&open=${leadId}`);
  }

  const fieldCls =
    "w-full h-10 rounded-lg border border-border bg-bg px-3 text-[13.5px] text-ink placeholder:text-muted focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15";

  const typedName = form.name.trim();

  return (
    <>
      <button
        type="button"
        onClick={openWindow}
        className="flex items-center gap-1.5 h-10 px-3 sm:px-3.5 rounded-xl border-none bg-accent text-white text-[13px] font-semibold cursor-pointer shadow-[0_8px_18px_-8px_rgb(var(--accent-rgb)/0.8)] hover:bg-accent-hover"
        aria-label="Add a new lead"
      >
        <FiPlus size={16} strokeWidth={2.5} />
        <span className="hidden sm:inline">New lead</span>
      </button>

      {open && (
        <FloatingWindow
          title="Add a new lead"
          subtitle="Walk-ins and phone enquiries"
          minimizedLabel={saved ? `Added · ${saved.name}` : typedName ? `New lead · ${typedName}` : "New lead (draft)"}
          minimized={minimized}
          onMinimize={minimize}
          onRestore={() => {
            setMinimized(false);
            focusFirst();
          }}
          onClose={close}
          storageKey="broaddcast:quick-add-pos"
        >
          {saved ? (
            <div className="flex flex-col items-center text-center gap-3 px-6 py-8">
              <FiCheckCircle size={34} className="text-success" />
              <div>
                <div className="text-[15px] font-bold text-ink">{saved.name} {saved.duplicate ? "already existed" : "added"}</div>
                <div className="mt-1 text-[13px] text-muted">
                  {saved.duplicate ? "Saved as a repeat enquiry on the existing lead." : "They're in your Leads list now."}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-sm" onClick={() => { reset(); focusFirst(); }}>
                  Add another
                </button>
                <button type="button" className="btn" onClick={openSavedLead}>
                  Open lead
                </button>
              </div>
            </div>
          ) : (
            <form className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4" onSubmit={submit}>
              <label className="sm:col-span-2 flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Name
                <input ref={firstField} autoFocus className={fieldCls} value={form.name} onChange={set("name")} placeholder="Customer's full name" autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Phone
                <input className={fieldCls} value={form.phone} onChange={set("phone")} placeholder="98200 11223" inputMode="tel" autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Email
                <input className={fieldCls} type="email" value={form.email} onChange={set("email")} placeholder="Optional" autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Model
                <input className={fieldCls} value={form.model} onChange={set("model")} placeholder="e.g. Q5" list="quick-add-models" autoComplete="off" />
                <datalist id="quick-add-models">
                  {CANONICAL_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Came in through
                <select className={fieldCls} value={form.source} onChange={set("source")}>
                  {SOURCES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Note
                <textarea className={`${fieldCls} h-20 py-2 resize-none`} value={form.note} onChange={set("note")} placeholder="What they're looking for, budget, best time to call…" />
              </label>

              {error && (
                <div role="alert" className="sm:col-span-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] font-medium text-danger">
                  {error}
                </div>
              )}

              {confirmDiscard ? (
                <div role="alert" className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] font-medium text-ink">
                  Discard this lead? What you typed will be lost.
                  <span className="flex gap-2">
                    <button type="button" className="btn-sm" onClick={() => setConfirmDiscard(false)}>
                      Keep editing
                    </button>
                    <button type="button" className="btn-sm !text-danger !border-danger/40" onClick={close}>
                      Discard
                    </button>
                  </span>
                </div>
              ) : (
                <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-1">
                  <button type="button" className="btn-sm" onClick={minimize} title="Keep it for later — the page stays usable">
                    Minimize
                  </button>
                  <button type="submit" className="btn" disabled={saving}>
                    {saving ? "Saving…" : "Add lead"}
                  </button>
                </div>
              )}
            </form>
          )}
        </FloatingWindow>
      )}
    </>
  );
}
