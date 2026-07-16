import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";

function barColor(percent) {
  if (percent >= 90) return "#e5484d";
  if (percent >= 70) return "#d48806";
  return "#12b76a";
}

export default function StoragePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/storage");
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel mb-6">
      <div className="panel-header">
        <h2>Storage</h2>
      </div>
      <div className="p-5">
        {loading ? (
          <Skeleton count={3} height={28} />
        ) : !data ? (
          <div className="empty-state">Couldn't load storage stats.</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <strong>
                {data.usedMB} MB used of {data.limitMB} MB ({data.percentUsed}%)
              </strong>
              <span className="text-muted">{data.remainingMB} MB left</span>
            </div>
            <div className="bar-track" style={{ height: 10 }}>
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(data.percentUsed, 100)}%`,
                  background: barColor(data.percentUsed),
                }}
              />
            </div>
            <div className="hint mt-2">
              Data size {data.usedMB} MB + index size {data.indexSizeMB} MB ≈ {data.storageSizeMB} MB on disk.
              Limit is configured for a {data.limitMB} MB cluster — update MONGODB_STORAGE_LIMIT_MB if you upgrade
              your Atlas plan.
            </div>

            <table className="mt-4">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Used</th>
                  <th>% of total limit</th>
                </tr>
              </thead>
              <tbody>
                {data.perCompany.map((c) => (
                  <tr key={c.companyId}>
                    <td>{c.name}</td>
                    <td>{c.usedMB} MB</td>
                    <td>{((c.usedMB / data.limitMB) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {data.perCompany.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-state">
                      No companies yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
