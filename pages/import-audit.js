import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import { useToast } from "../components/ToastProvider";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Platform-level page: super admin only. Company admins and agents are
  // sent to their own dashboard.
  if (session.role !== "super_admin") return { redirect: { destination: "/", permanent: false } };
  return { props: { username: session.username, role: "super_admin" } };
}

// Status vocabulary comes from lib/importAudit.js — keep the two in sync.
const STATUS_META = {
  imported: { label: "Imported", pill: "bg-[#ecfdf5] text-[#047857]", accent: "#1baf7a", help: "Created its own lead in the CRM." },
  merged: {
    label: "Merged",
    pill: "bg-[#fffbeb] text-[#b45309]",
    accent: "#eda100",
    help: "Same customer + same model as an earlier row — recorded as a repeat enquiry on that lead, not a separate lead.",
  },
  missing: { label: "Missing", pill: "bg-[#fef2f2] text-[#b91c1c]", accent: "#e5484d", help: "Valid row that is not in the CRM at all." },
  mismatch: {
    label: "Mismatch",
    pill: "bg-[#f5f3ff] text-[#6d28d9]",
    accent: "#6d28d9",
    help: "A different customer sits at this row in the CRM — rows shifted in the sheet.",
  },
  skipped: { label: "Skipped", pill: "bg-[#f1f5f9] text-[#475569]", accent: "#94a3b8", help: "Deliberately not imported (test lead / no phone or lead ID)." },
};
const NEEDS_ATTENTION = ["missing", "mismatch", "skipped"];
const FILTERS = [
  { key: "attention", label: "Needs attention" },
  { key: "missing", label: "Missing" },
  { key: "mismatch", label: "Mismatch" },
  { key: "skipped", label: "Skipped" },
  { key: "merged", label: "Merged" },
  { key: "imported", label: "Imported" },
  { key: "all", label: "All rows" },
];

function emptyTotals() {
  return { totalRows: 0, imported: 0, merged: 0, skipped: 0, missing: 0, mismatch: 0, orphaned: 0, leadsInCrm: 0, duplicateLeads: 0 };
}

function formatDateTime(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

export default function ImportAuditPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const toast = useToast();
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("attention");
  const [tabFilter, setTabFilter] = useState("");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState(null); // { done, total, current }
  const runRef = useRef(0); // bumps per run so a stale run stops updating state

  const companyParam = useCallback(() => {
    const params = new URLSearchParams();
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    return params;
  }, [isSuperAdminView, viewCompanyId]);

  // The audit is fetched one sheet tab per request (each ~1 s) rather than
  // one request for the whole sheet — a 36-tab sheet takes ~25 s in total,
  // longer than a serverless function may run — and the table fills in
  // tab by tab with a progress bar.
  const load = useCallback(async () => {
    if (isSuperAdminView && !viewCompanyId) return;
    const run = ++runRef.current;
    setLoading(true);
    setError("");
    setAudit(null);
    setProgress(null);
    try {
      const params = companyParam();
      params.set("mode", "tabs");
      const res = await apiFetch(`/api/import-audit?${params.toString()}`);
      const head = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(head.error || "Failed to start the import audit");
      if (head.error) {
        setAudit({ tabs: [], rows: [], duplicates: [], totals: emptyTotals(), lastSync: head.lastSync, error: head.error, auditedAt: new Date() });
        return;
      }
      const acc = { tabs: [], rows: [], duplicates: [], totals: emptyTotals(), lastSync: head.lastSync, auditedAt: null };
      for (let i = 0; i < head.tabs.length; i++) {
        if (runRef.current !== run) return; // company changed / re-run started
        const t = head.tabs[i];
        setProgress({ done: i, total: head.tabs.length, current: t.tab });
        const p = companyParam();
        p.set("mode", "tab");
        p.set("sheetId", t.sheetId);
        p.set("tab", t.tab);
        const r = await apiFetch(`/api/import-audit?${p.toString()}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`${t.tab}: ${d.error || "audit failed"}`);
        acc.tabs.push(d.tab);
        acc.rows.push(...d.rows);
        acc.duplicates.push(...d.duplicates);
        for (const k of Object.keys(acc.totals)) acc.totals[k] += d.tab[k] || 0;
        setAudit({ ...acc, tabs: [...acc.tabs], rows: [...acc.rows], duplicates: [...acc.duplicates], totals: { ...acc.totals } });
      }
      if (runRef.current !== run) return;
      acc.auditedAt = new Date();
      setAudit({ ...acc });
    } catch (err) {
      if (runRef.current === run) setError(err.message);
    } finally {
      if (runRef.current === run) {
        setLoading(false);
        setProgress(null);
      }
    }
  }, [isSuperAdminView, viewCompanyId, companyParam]);

  // Excel export, built in the browser from what was audited.
  async function downloadExcel() {
    if (!audit) return;
    const XLSX = await import("xlsx");
    const header = ["Status", "Sheet", "Tab", "Sheet Row", "Name", "Phone", "Email", "Created Time", "CRM Lead", "Details"];
    const rowsAoa = audit.rows.map((r) => [STATUS_META[r.status]?.label || r.status, r.sheetLabel, r.tab, r.sheetRow, r.name, r.phone, r.email, r.createdTime, r.leadName || "", r.reason || ""]);
    const summary = [
      ["Tab", "Sheet rows", "Imported", "Merged", "Skipped", "Missing", "Mismatch", "Leads in CRM", "Duplicate records", "Orphaned leads"],
      ...audit.tabs.map((t) => [t.tab, t.totalRows, t.imported, t.merged, t.skipped, t.missing, t.mismatch, t.leadsInCrm, t.duplicateLeads, t.orphaned]),
      ["TOTAL", ...["totalRows", "imported", "merged", "skipped", "missing", "mismatch", "leadsInCrm", "duplicateLeads", "orphaned"].map((k) => audit.totals[k])],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rowsAoa]), "All Rows");
    const attention = audit.rows.map((r, i) => [r, rowsAoa[i]]).filter(([r]) => NEEDS_ATTENTION.includes(r.status)).map(([, a]) => a);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...attention]), `Needs Attention (${attention.length})`);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Tab", "Sheet Row", "Name", "Phone", "Lead records", "Lead IDs"], ...audit.duplicates.map((d) => [d.tab, d.sheetRow, d.name, d.phone, d.count, d.leadIds.join(", ")])]),
      `Duplicate Records (${audit.duplicates.length})`
    );
    XLSX.writeFile(wb, `import-audit-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  useEffect(() => {
    setAudit(null);
    setTabFilter("");
    load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await apiFetch(`/api/import-audit?${companyParam().toString()}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const log = data.log || {};
      if (log.status === "success") {
        toast(`Sync finished — ${log.newCount || 0} new, ${log.duplicateCount || 0} repeat, ${log.skippedCount || 0} skipped`);
      } else {
        toast(log.errorMessage || `Sync ${log.status}`, { type: "err" });
      }
      await load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSyncing(false);
    }
  }

  const visibleRows = useMemo(() => {
    if (!audit) return [];
    const q = search.trim().toLowerCase();
    return audit.rows.filter((r) => {
      if (filter === "attention" && !NEEDS_ATTENTION.includes(r.status)) return false;
      if (filter !== "attention" && filter !== "all" && r.status !== filter) return false;
      if (tabFilter && r.tab !== tabFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.phone} ${r.email} ${r.leadName || ""} ${r.reason || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [audit, filter, tabFilter, search]);

  const totals = audit?.totals;
  const attentionCount = totals ? totals.missing + totals.mismatch + totals.skipped : 0;

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title mb-1">Import Audit</h1>
      <p className="hint mb-5">
        Every row of the Google Sheet, reconciled against the CRM — which rows became leads, which were merged as repeat
        enquiries, and which are missing and why.
      </p>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} editable />}

      <div className="dash-panel flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          {loading ? (
            <Skeleton width={260} />
          ) : audit?.lastSync ? (
            <div className="text-sm">
              <span className="font-semibold">Last sync:</span> {formatDateTime(audit.lastSync.at)} ·{" "}
              <span className={audit.lastSync.status === "success" ? "text-success" : "text-danger"}>{audit.lastSync.status}</span>
              {audit.lastSync.errorMessage && <div className="hint mt-1 text-danger">{audit.lastSync.errorMessage}</div>}
              <div className="hint mt-1">{audit.auditedAt ? `Sheet checked ${formatDateTime(audit.auditedAt)}` : "Checking sheet…"}</div>
            </div>
          ) : (
            <span className="hint">No sync has run yet.</span>
          )}
        </div>
        <button className="btn-sm" onClick={() => load()} disabled={loading || syncing}>
          {loading ? "Checking..." : "Re-check sheet"}
        </button>
        <button className="btn" onClick={syncNow} disabled={syncing || loading}>
          {syncing ? "Syncing..." : "Sync now"}
        </button>
        <button className="btn-sm" onClick={downloadExcel} disabled={loading || !audit || !audit.tabs?.length}>
          Download Excel
        </button>
        {progress && (
          <div className="w-full">
            <div className="mb-1 flex justify-between text-[12px] font-semibold">
              <span>Checking sheet tabs… {progress.current}</span>
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div className="h-2 rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="panel mb-6" style={{ padding: 16, background: "#fef2f2", borderColor: "#fca5a5" }}>
          <strong>Couldn&apos;t audit the sheet.</strong> <span className="hint">{error}</span>
        </div>
      )}

      <div className="dash-stat-grid">
        {[
          ["Sheet rows", totals?.totalRows, "rgb(var(--accent-rgb))", "non-blank rows across all tabs"],
          ["Imported", totals?.imported, STATUS_META.imported.accent, "became their own lead"],
          ["Merged", totals?.merged, STATUS_META.merged.accent, "repeat enquiries folded in"],
          ["Missing", totals?.missing, STATUS_META.missing.accent, "not in the CRM"],
          ["Mismatch", totals?.mismatch, STATUS_META.mismatch.accent, "row shifted in sheet"],
          ["Skipped", totals?.skipped, STATUS_META.skipped.accent, "test / no phone"],
          ["Duplicate records", totals?.duplicateLeads, "#4a3aa7", "same row imported twice"],
        ].map(([label, value, accent, caption]) => (
          <div className="dash-card" key={label} style={{ "--dash-accent": accent }}>
            <div className="label">{label}</div>
            <div className="value">{loading && !audit ? <Skeleton width={50} /> : value ?? 0}</div>
            <div className="dash-card-caption">{caption}</div>
          </div>
        ))}
      </div>

      {!loading && totals && (
        <div className="hint mb-6" style={{ marginTop: -12 }}>
          {totals.totalRows} sheet rows = {totals.imported} imported + {totals.merged} merged + {totals.missing} missing +{" "}
          {totals.mismatch} mismatch + {totals.skipped} skipped. The CRM holds {totals.leadsInCrm} lead records from these tabs
          {totals.duplicateLeads > 0 && ` — ${totals.duplicateLeads} of them are duplicate records of a row already imported`}
          {totals.orphaned > 0 && ` (${totals.orphaned} point at sheet rows that no longer exist)`}.
          {attentionCount === 0 && " Everything reconciles — no missing rows."}
        </div>
      )}

      <div className="panel mb-6">
        <div className="panel-header">
          <h2>By sheet tab</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tab</th>
                <th>Model</th>
                <th>Sheet rows</th>
                <th>Imported</th>
                <th>Merged</th>
                <th>Missing</th>
                <th>Mismatch</th>
                <th>Skipped</th>
                <th>Leads in CRM</th>
                <th>Duplicate records</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && !audit?.tabs?.length ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j}>
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              ) : audit?.tabs?.length ? (
                audit.tabs.map((t) => (
                  <tr key={`${t.sheetId}-${t.tab}`} className={tabFilter === t.tab ? "bg-accent-soft" : ""}>
                    <td>
                      <strong>{t.tab}</strong>
                      {t.sheetLabel && <div className="hint">{t.sheetLabel}</div>}
                    </td>
                    <td className="text-muted">{t.canonicalModel}</td>
                    <td>{t.totalRows}</td>
                    <td>{t.imported}</td>
                    <td>{t.merged}</td>
                    <td className={t.missing ? "text-danger font-semibold" : ""}>{t.missing}</td>
                    <td className={t.mismatch ? "font-semibold" : ""}>{t.mismatch}</td>
                    <td>{t.skipped}</td>
                    <td>
                      {t.leadsInCrm}
                      {t.orphaned > 0 && <span className="hint"> ({t.orphaned} orphaned)</span>}
                    </td>
                    <td className={t.duplicateLeads ? "font-semibold" : "text-muted"}>{t.duplicateLeads || 0}</td>
                    <td>
                      <button className="btn-sm" onClick={() => setTabFilter(tabFilter === t.tab ? "" : t.tab)}>
                        {tabFilter === t.tab ? "Show all tabs" : "Filter rows"}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="empty-state">
                    {audit?.error || "No sheet tabs found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && audit?.duplicates?.length > 0 && (
        <div className="panel mb-6">
          <div className="panel-header">
            <h2>Duplicate lead records ({audit.duplicates.length} rows affected)</h2>
          </div>
          <div className="px-5 pt-3 hint">
            These sheet rows were imported more than once, so the same customer appears as {audit.totals.duplicateLeads}{" "}
            extra lead record{audit.totals.duplicateLeads === 1 ? "" : "s"} in the Leads table and in every count. This
            happened when two sync runs overlapped (now prevented by the sync lock); the records themselves still need to
            be merged.
          </div>
          <div className="table-scroll mt-3">
            <table>
              <thead>
                <tr>
                  <th>Tab</th>
                  <th>Sheet row</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Lead records</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {audit.duplicates
                  .filter((d) => !tabFilter || d.tab === tabFilter)
                  .slice(0, 200)
                  .map((d) => (
                    <tr key={`${d.tab}-${d.rowNumber}`}>
                      <td className="text-muted">{d.tab}</td>
                      <td>{d.sheetRow}</td>
                      <td>{d.name || "-"}</td>
                      <td>{d.phone || "-"}</td>
                      <td>
                        <span className="pill bg-[#f5f3ff] text-[#6d28d9]">{d.count}× in CRM</span>
                      </td>
                      <td>
                        <Link href={`/leads?q=${encodeURIComponent(d.phone || d.name || "")}`} className="btn-sm">
                          View in Leads
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header flex-wrap gap-3">
          <h2>
            Rows {tabFilter && <span className="hint">— {tabFilter}</span>}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="search-input"
              placeholder="Search name, phone, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="px-5 pt-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count =
              !totals ? 0 : f.key === "attention" ? attentionCount : f.key === "all" ? totals.totalRows : totals[f.key] || 0;
            return (
              <button
                key={f.key}
                className={`btn-sm ${filter === f.key ? "btn-export" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="px-5 pt-3 hint">
          {filter !== "all" && filter !== "attention" && STATUS_META[filter]?.help}
          {filter === "attention" && "Rows that are not in the CRM as either a lead or a repeat enquiry."}
        </div>
        <div className="table-scroll mt-3">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Tab</th>
                <th>Sheet row</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Created (sheet)</th>
                <th>CRM lead</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading && !audit?.rows?.length ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j}>
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    {audit ? "No rows match." : "Run the audit to see rows."}
                  </td>
                </tr>
              ) : (
                visibleRows.slice(0, 500).map((r) => {
                  const meta = STATUS_META[r.status] || STATUS_META.skipped;
                  return (
                    <tr key={`${r.tab}-${r.rowNumber}`}>
                      <td>
                        <span className={`pill ${meta.pill}`}>{meta.label}</span>
                      </td>
                      <td className="text-muted">{r.tab}</td>
                      <td>{r.sheetRow}</td>
                      <td>{r.name || "-"}</td>
                      <td>{r.phone || "-"}</td>
                      <td className="text-muted">{r.email || "-"}</td>
                      <td className="text-muted">{r.createdTime || "-"}</td>
                      <td>
                        {r.leadId ? (
                          <Link
                            href={`/leads?q=${encodeURIComponent(r.phone || r.leadName || "")}`}
                            className="text-accent font-semibold"
                          >
                            {r.leadName || "Open lead"}
                          </Link>
                        ) : (
                          <span className="hint">-</span>
                        )}
                      </td>
                      <td className="whitespace-normal" style={{ minWidth: 260 }}>
                        <span className="hint">{r.reason || ""}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {visibleRows.length > 500 && (
          <div className="hint px-5 py-3">Showing the first 500 of {visibleRows.length} rows — use the Excel download for the full list.</div>
        )}
      </div>
    </Layout>
  );
}
