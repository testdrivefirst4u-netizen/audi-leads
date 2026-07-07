import { useState } from "react";
import { apiFetch } from "../lib/apiFetch";

export default function SettingsForm({ initial, onSaved }) {
  const [sheetId, setSheetId] = useState(initial.sheetId || "");
  const [sheetName, setSheetName] = useState(initial.sheetName || "");
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(initial.syncIntervalMinutes || 1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId, sheetName, syncIntervalMinutes: Number(syncIntervalMinutes) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save settings");
      }
      const data = await res.json();
      setMessage({ type: "ok", text: "Settings saved. Syncing now..." });
      onSaved?.(data.settings);
    } catch (err) {
      setMessage({ type: "err", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form panel" onSubmit={handleSubmit} style={{ padding: 20 }}>
      <div className="field">
        <label>Google Sheet ID</label>
        <input
          value={sheetId}
          onChange={(e) => setSheetId(e.target.value)}
          placeholder="1AbCDefGhIJkLmNoPQRstuVwxyZ..."
          required
        />
        <div className="hint">The ID from the sheet's URL: docs.google.com/spreadsheets/d/&lt;ID&gt;/edit</div>
      </div>

      <div className="field">
        <label>Sheet Tabs (optional)</label>
        <input
          value={sheetName}
          onChange={(e) => setSheetName(e.target.value)}
          placeholder="Leave blank to sync every tab"
        />
        <div className="hint">
          Comma-separated tab names, e.g. <code>A6,Q3,Q5</code>. Leave blank to automatically sync every tab in the spreadsheet.
        </div>
      </div>

      <div className="field">
        <label>Sync Interval</label>
        <select value={syncIntervalMinutes} onChange={(e) => setSyncIntervalMinutes(e.target.value)}>
          <option value={1}>Every 1 minute</option>
          <option value={5}>Every 5 minutes</option>
          <option value={15}>Every 15 minutes</option>
        </select>
      </div>

      <button className="btn" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {message && <div className={`save-msg ${message.type}`}>{message.text}</div>}
    </form>
  );
}
