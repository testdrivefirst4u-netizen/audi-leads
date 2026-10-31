import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FiSearch, FiArrowRight, FiCornerDownLeft } from "react-icons/fi";
import { apiFetch } from "../lib/apiFetch";
import { navItemsFor } from "./Sidebar";
import { CarIcon } from "./icons";
import { loadCatalogForSearch, searchCars } from "../lib/carSearch";

const MIN_CHARS = 2;
const MAX_LEADS = 6;

const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/**
 * Top bar search: leads by name / phone / model (the same search the Leads
 * page runs) plus "Go to" shortcuts for this role's pages. Ctrl/⌘+K focuses
 * it; arrow keys + Enter pick a result. Choosing a lead opens the Leads page
 * filtered to it with its details open (/leads?q=…&open=<id>).
 *
 * Super admin has no company of its own to search in, so it only gets the
 * page shortcuts and "Search all leads", which hands the term to the Leads
 * page's company view.
 */
export default function GlobalSearch({ role }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const canSearchLeads = role !== "super_admin";
  const term = query.trim();

  // Phones get a shorter placeholder so it isn't cut off mid-word.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Ctrl/⌘+K from anywhere.
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click — same pattern as NotificationBell / ProfileMenu.
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Leads matching the term, debounced like the Leads page's own search box.
  useEffect(() => {
    if (!canSearchLeads || term.length < MIN_CHARS) {
      setLeads([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ search: term, page: "1", pageSize: String(MAX_LEADS), sortBy: "updatedAt", sortDir: "desc" });
      apiFetch(`/api/leads?${params}`)
        .then((res) => (res.ok ? res.json() : { leads: [] }))
        .then((data) => {
          if (!cancelled) setLeads((data.leads || []).slice(0, MAX_LEADS));
        })
        .catch(() => !cancelled && setLeads([]))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, canSearchLeads]);

  // Cars from the Models catalog ("q7 boot space" → the spec), loaded once when the search opens.
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    if (open && canSearchLeads) loadCatalogForSearch().then(setCatalog);
  }, [open, canSearchLeads]);
  const cars = useMemo(() => (term.length >= MIN_CHARS ? searchCars(catalog, term) : []), [catalog, term]);

  const pages = useMemo(() => {
    const items = navItemsFor(role);
    if (!term) return items.slice(0, 6);
    const q = term.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 4);
  }, [role, term]);

  // One flat list for keyboard navigation: leads, "all results", cars, pages.
  const options = useMemo(() => {
    const list = leads.map((lead) => ({ kind: "lead", lead, href: `/leads?q=${encodeURIComponent(term)}&open=${lead._id}` }));
    if (term.length >= MIN_CHARS) list.push({ kind: "all", href: `/leads?q=${encodeURIComponent(term)}` });
    cars.forEach((c) => list.push({ kind: "car", car: c, href: `/catalog/${c.modelId}` }));
    pages.forEach((p) => list.push({ kind: "page", page: p, href: p.href }));
    return list;
  }, [leads, cars, pages, term]);

  useEffect(() => setCursor(0), [term]);

  function go(option) {
    if (!option) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(option.href);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setCursor((c) => Math.min(c + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(options[cursor]);
    } else if (e.key === "Escape") {
      // a search input also clears itself on Escape, which would fire onChange and reopen the list
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const optionCls = (i) =>
    `flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left border-none cursor-pointer text-[13px] ${
      i === cursor ? "bg-accent/10 text-ink" : "bg-transparent text-ink hover:bg-bg"
    }`;
  let index = -1;

  return (
    <div ref={boxRef} className="relative w-full max-w-[520px]">
      <div className="relative">
        <FiSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={narrow ? "Search…" : canSearchLeads ? "Search leads by name, phone or model…" : "Search pages and leads…"}
          aria-label="Search"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          autoComplete="off"
          className="w-full h-10 rounded-xl border border-border bg-card pl-10 pr-16 text-[13.5px] text-ink placeholder:text-muted shadow-card transition-shadow focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        <kbd className="hidden sm:flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-muted pointer-events-none">
          Ctrl K
        </kbd>
      </div>

      {open && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-2xl border border-border bg-card p-2 shadow-dropdown max-h-[70vh] overflow-y-auto"
        >
          {canSearchLeads && term.length >= MIN_CHARS && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Leads</div>
              {loading && leads.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">Searching…</div>}
              {!loading && leads.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">No leads match “{term}”.</div>}
              {leads.map((lead) => {
                index += 1;
                const i = index;
                return (
                  <button key={lead._id} type="button" role="option" aria-selected={i === cursor} className={optionCls(i)} onMouseEnter={() => setCursor(i)} onClick={() => go(options[i])}>
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-hover text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {initials(lead.name)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{lead.name || "Unnamed lead"}</span>
                      <span className="block text-[12px] text-muted truncate">
                        {[lead.phone, lead.canonicalModel || lead.model].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {lead.status && <span className="pill bg-accent/10 text-accent shrink-0">{lead.status}</span>}
                  </button>
                );
              })}
            </>
          )}

          {term.length >= MIN_CHARS &&
            (() => {
              index += 1;
              const i = index;
              return (
                <button type="button" role="option" aria-selected={i === cursor} className={`${optionCls(i)} mt-1`} onMouseEnter={() => setCursor(i)} onClick={() => go(options[i])}>
                  <span className="w-8 h-8 rounded-full bg-bg flex items-center justify-center shrink-0 text-accent">
                    <FiSearch size={15} />
                  </span>
                  <span className="flex-1">
                    See all leads matching <strong>“{term}”</strong>
                  </span>
                  <FiArrowRight size={15} className="text-muted" />
                </button>
              );
            })()}

          {cars.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Cars</div>
              {cars.map((c) => {
                index += 1;
                const i = index;
                return (
                  <button key={`${c.modelId}-${c.title}`} type="button" role="option" aria-selected={i === cursor} className={optionCls(i)} onMouseEnter={() => setCursor(i)} onClick={() => go(options[i])}>
                    <span className="w-8 h-8 rounded-lg bg-bg flex items-center justify-center shrink-0 text-muted">
                      <CarIcon width={16} height={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{c.title}</span>
                      <span className="block text-[12px] text-muted truncate">{c.detail}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {pages.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">Go to</div>
              {pages.map((p) => {
                index += 1;
                const i = index;
                const Icon = p.Icon;
                return (
                  <button key={p.href} type="button" role="option" aria-selected={i === cursor} className={optionCls(i)} onMouseEnter={() => setCursor(i)} onClick={() => go(options[i])}>
                    <span className="w-8 h-8 rounded-lg bg-bg flex items-center justify-center shrink-0 text-muted">
                      <Icon width={16} height={16} />
                    </span>
                    <span className="flex-1 font-medium">{p.label}</span>
                  </button>
                );
              })}
            </>
          )}

          <div className="hidden sm:flex items-center gap-3 px-3 pt-2.5 pb-1 mt-1 border-t border-border text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-bg px-1">↑</kbd>
              <kbd className="rounded border border-border bg-bg px-1">↓</kbd> to move
            </span>
            <span className="flex items-center gap-1">
              <FiCornerDownLeft size={11} /> to open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-bg px-1">Esc</kbd> to close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
