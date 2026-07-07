function formatTime(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export default function SyncStatusCard({ status }) {
  if (!status) return null;

  return (
    <div className="status-grid">
      <div className="card">
        <div className="label">Last Sync Time</div>
        <div className="value" style={{ fontSize: 16 }}>
          {formatTime(status.lastSyncTime)}
        </div>
      </div>
      <div className="card">
        <div className="label">Total Records Imported</div>
        <div className="value">{status.totalRecords ?? 0}</div>
      </div>
      <div className="card">
        <div className="label">New Leads Today</div>
        <div className="value">{status.newLeadsToday ?? 0}</div>
      </div>
      <div className="card">
        <div className="label">Sync Status</div>
        <div className={`badge ${status.online ? "online" : "offline"}`}>
          <span className="dot" />
          {status.online ? "Online" : "Offline"}
        </div>
        {status.errorMessage && (
          <div className="hint" style={{ color: "#e5484d" }}>
            {status.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
