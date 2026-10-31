import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FiPlus, FiX } from "react-icons/fi";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import { CANONICAL_MODELS } from "../lib/leadFields";
import { getViewCompany } from "../lib/viewCompany";
import Portal from "./Portal";

// Kept in step with MANUAL_SOURCES in pages/api/leads/manual.js.
const SOURCES = ["Walk-in", "Phone call", "Referral", "Other"];
const EMPTY = { name: "", phone: "", email: "", model: "", source: "Walk-in", note: "" };

/**
 * Top bar "+ New lead": for the walk-ins and phone enquiries that never come
 * through a sheet or a Meta form. Saved through /api/leads/manual, which
 * merges a repeat enquiry into the existing lead instead of duplicating it.
 * A super admin adds to the company picked in the top bar.
 */
export default function QuickAddLead({ role }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstField = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => firstField.current?.focus(), 0);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
      toast(data.status === "duplicate" ? `${data.name} already exists — added as a repeat enquiry` : `${data.name} added`);
      setOpen(false);
      setForm(EMPTY);
      router.push(`/leads?q=${encodeURIComponent(data.phone || data.name)}&open=${data.leadId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const fieldCls =
    "w-full h-10 rounded-lg border border-border bg-bg px-3 text-[13.5px] text-ink placeholder:text-muted focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 h-10 px-3 sm:px-3.5 rounded-xl border-none bg-accent text-white text-[13px] font-semibold cursor-pointer shadow-[0_8px_18px_-8px_rgb(var(--accent-rgb)/0.8)] hover:bg-accent-hover"
        aria-label="Add a new lead"
      >
        <FiPlus size={16} strokeWidth={2.5} />
        <span className="hidden sm:inline">New lead</span>
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <form className="modal max-w-[480px]" role="dialog" aria-modal="true" aria-label="Add a new lead" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <div className="modal-header">
              <div>
                <h2>Add a new lead</h2>
                <div className="hint mt-0.5">For walk-ins and phone enquiries.</div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
                <FiX size={18} />
              </button>
            </div>
            <div className="modal-body grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="sm:col-span-2 flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Name
                <input ref={firstField} className={fieldCls} value={form.name} onChange={set("name")} placeholder="Customer's full name" autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Phone
                <input className={fieldCls} value={form.phone} onChange={set("phone")} placeholder="98200 11223" inputMode="tel" autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
                Email <span className="sr-only">(optional)</span>
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
              <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
                <button type="button" className="btn-sm" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "Saving…" : "Add lead"}
                </button>
              </div>
            </div>
          </form>
        </div>
        </Portal>
      )}
    </>
  );
}
