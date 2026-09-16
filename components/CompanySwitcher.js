import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiFetch";

// Super-admin-only control shown at the top of Leads/Dashboard/Reports/Agents
// — picks which company's data to work with (no super-admin session belongs
// to a company, so every page it appears on must know which one is currently
// selected before it can fetch anything). Pages that let the super admin
// change things (Leads, Agents) pass editable so the badge doesn't claim
// they're read-only; Dashboard/Reports leave it off.
export default function CompanySwitcher({ companyId, onChange, editable = false }) {
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
    <div className="panel mb-5" style={{ padding: 20 }}>
      <span className="pill mb-3 inline-block bg-accent-soft text-accent">
        {editable ? "Super Admin — Full Access" : "Super Admin View — Read Only"}
      </span>
      <div className="field mb-0" style={{ maxWidth: 280 }}>
        <label>Company</label>
        <select
          value={companyId || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          className="disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {companies.length === 0 && <option value="">No companies yet</option>}
          {companies.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint m-0 mt-3">
        {editable
          ? "Acting on this company's data with the same access as its admin — edits, reassignments, and remarks are saved to this company."
          : "Viewing this company's data as read-only."}
      </p>
    </div>
  );
}
