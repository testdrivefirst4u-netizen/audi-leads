import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiSearch } from "react-icons/fi";
import { getViewCompany, loadCompanies, resolveViewCompany, setViewCompany, VIEW_COMPANY_EVENT } from "../lib/viewCompany";

const initialsOf = (name) =>
  (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "C";

function CompanyMark({ company, size = "sm" }) {
  const box = size === "sm" ? "w-7 h-7 text-[10.5px]" : "w-8 h-8 text-[11px]";
  if (company?.logoUrl) {
    return (
      <span className={`${box} rounded-lg bg-white border border-border p-0.5 flex items-center justify-center shrink-0 overflow-hidden`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={company.logoUrl} alt="" className="w-full h-full object-contain" />
      </span>
    );
  }
  return (
    <span className={`${box} rounded-lg bg-gradient-to-br from-accent to-accent-hover text-white font-bold flex items-center justify-center shrink-0`}>
      {initialsOf(company?.name)}
    </span>
  );
}

/**
 * Super admin only, in the top bar: which company the "Company View" pages
 * show. Picked once here and remembered (lib/viewCompany.js); every page's
 * CompanySwitcher follows it, so changing pages never asks again.
 */
export default function CompanyPicker() {
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setCurrent(getViewCompany());
    let cancelled = false;
    loadCompanies().then((list) => {
      if (cancelled) return;
      setCompanies(list);
      const pick = resolveViewCompany(list);
      if (pick) setCurrent({ id: String(pick._id), name: pick.name, logoUrl: pick.logoUrl || "" });
    });
    const onPick = (e) => setCurrent(e.detail);
    window.addEventListener(VIEW_COMPANY_EVENT, onPick);
    return () => {
      cancelled = true;
      window.removeEventListener(VIEW_COMPANY_EVENT, onPick);
    };
  }, []);

  // Close on outside click — same pattern as ProfileMenu / NotificationBell.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? companies.filter((c) => (c.name || "").toLowerCase().includes(q)) : companies;
  }, [companies, query]);

  function choose(company) {
    setViewCompany(company);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Company you're viewing"
        aria-expanded={open}
        className="flex items-center gap-2 h-10 pl-1.5 pr-2.5 rounded-xl border border-border bg-card text-ink cursor-pointer shadow-card transition-colors duration-150 hover:border-accent/40"
      >
        <CompanyMark company={current} />
        <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Viewing</span>
          <span className="text-[13px] font-semibold truncate max-w-[150px]">{current?.name || "Pick a company"}</span>
        </span>
        <FiChevronDown size={15} className={`text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-2xl border border-border bg-card shadow-dropdown overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <FiSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && shown[0]) choose(shown[0]);
                }}
                placeholder="Find a company…"
                className="w-full h-9 rounded-lg border border-border bg-bg pl-8 pr-3 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox" aria-label="Companies">
            {shown.length === 0 && <div className="px-3 py-3 text-[13px] text-muted">No company matches “{query}”.</div>}
            {shown.map((c) => {
              const selected = String(c._id) === current?.id;
              return (
                <button
                  key={c._id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(c)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg border-none text-left cursor-pointer ${selected ? "bg-accent/10" : "bg-transparent hover:bg-bg"}`}
                >
                  <CompanyMark company={c} size="md" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">{c.name}</span>
                    {c.active === false && <span className="block text-[11.5px] text-muted">Inactive</span>}
                  </span>
                  {selected && <FiCheck size={16} className="text-accent shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
