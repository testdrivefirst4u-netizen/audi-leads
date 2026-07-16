import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";

// Super-admin-only control shown at the top of Leads/Dashboard/Reports —
// picks which company's data to view (read-only monitoring, no session of
// its own belongs to a company, so every page it appears on must know which
// one is currently selected before it can fetch anything).
export default function CompanySwitcher({ companyId, onChange }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/companies")
      .then((res) => res.json())
      .then((data) => {
        const list = data.companies || [];
        setCompanies(list);
        if (!companyId && list.length > 0) onChange(list[0]._id);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
      <span className="pill bg-accent-soft text-accent">Super Admin View — Read Only</span>
      <label className="toolbar-label m-0">Company</label>
      <select value={companyId || ""} onChange={(e) => onChange(e.target.value)} disabled={loading}>
        {companies.length === 0 && <option value="">No companies yet</option>}
        {companies.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="hint m-0">Viewing this company&apos;s data as read-only — no edits, reassignments, or remarks.</span>
    </div>
  );
}
