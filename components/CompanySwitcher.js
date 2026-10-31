import { useEffect, useRef, useState } from "react";
import { FiBriefcase, FiArrowUp } from "react-icons/fi";
import { loadCompanies, resolveViewCompany, VIEW_COMPANY_EVENT } from "../lib/viewCompany";

// Super-admin-only, at the top of every "Company View" page (Leads, Dashboard,
// Reports, Agents…). No super-admin session belongs to a company, so each of
// these pages needs to know which one to fetch. The company is picked once in
// the top bar (components/CompanyPicker.js, lib/viewCompany.js); this keeps
// the page's own companyId in step with it — on arrival and whenever the top
// bar changes — through the page's onChange, so a page's own switch handling
// (e.g. Leads clearing company-specific filters) still runs.
//
// What's left on screen is a slim reminder of which company you're acting on
// and with what access. Pages that let the super admin change things (Leads,
// Agents…) pass editable; Dashboard/Reports leave it off (read-only).
export default function CompanySwitcher({ companyId, onChange, editable = false }) {
  const [company, setCompany] = useState(null);
  const [empty, setEmpty] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;

  // lastSent: the first pick can arrive twice (resolved list + its own event)
  // before the page's state has caught up — only pass each change on once.
  const lastSent = useRef(null);
  const follow = (id) => {
    if (!id) return;
    const next = String(id);
    if (next === String(companyIdRef.current || "") || next === lastSent.current) return;
    lastSent.current = next;
    onChangeRef.current(id);
  };

  useEffect(() => {
    let cancelled = false;
    loadCompanies().then((list) => {
      if (cancelled) return;
      const pick = resolveViewCompany(list);
      setEmpty(!pick);
      if (pick) {
        setCompany({ id: String(pick._id), name: pick.name });
        follow(pick._id);
      }
    });
    const onPick = (e) => {
      setCompany(e.detail);
      follow(e.detail.id);
    };
    window.addEventListener(VIEW_COMPANY_EVENT, onPick);
    return () => {
      cancelled = true;
      window.removeEventListener(VIEW_COMPANY_EVENT, onPick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (empty) {
    return <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-muted">No companies yet — add one on the Companies page.</div>;
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] shadow-card">
      <FiBriefcase size={15} className="shrink-0 text-accent" />
      <span className="text-muted">
        Viewing <strong className="text-ink">{company?.name || "…"}</strong>
      </span>
      <span className={`pill ${editable ? "bg-accent-soft text-accent" : "bg-bg text-muted"}`}>{editable ? "Full access" : "Read only"}</span>
      <span className="ml-auto hidden sm:flex items-center gap-1 text-[12px] text-muted">
        <FiArrowUp size={12} /> Switch company from the top bar
      </span>
    </div>
  );
}
