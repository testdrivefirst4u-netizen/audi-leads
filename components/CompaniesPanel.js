import { Fragment, useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "./ToastProvider";
import LogoUploadField from "./LogoUploadField";

const EMPTY_SHEET = { label: "", sheetId: "", sheetName: "" };

function LogoRow({ company, onClose, onSaved }) {
  const toast = useToast();
  const [logoUrl, setLogoUrl] = useState(company.logoUrl || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save logo");
      }
      toast("Logo saved");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="form" style={{ padding: "16px 0" }}>
          <div className="hint mb-3">Upload the logo shown in {company.name}'s sidebar and login screen.</div>
          <div className="mb-3" style={{ maxWidth: 480 }}>
            <LogoUploadField value={logoUrl} onChange={setLogoUrl} />
          </div>
          <div className="flex gap-2">
            <button className="btn" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function AdminAccountRow({ company, onClose, onSaved }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/companies/${company._id}/admin`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUsername(data.username);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [company._id]);

  async function handleSave() {
    if (newPassword && newPassword !== confirmPassword) {
      toast("New password and confirmation don't match", { type: "err" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}/admin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, ...(newPassword ? { password: newPassword } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save admin account");
      toast("Admin account updated");
      setNewPassword("");
      setConfirmPassword("");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="form" style={{ padding: "16px 0" }}>
          <div className="hint mb-3">
            Manage the login {company.name}'s own admin signs in with. Passwords are hashed and can&apos;t be viewed —
            only reset to a new one.
          </div>
          {loading ? (
            <div className="hint">Loading...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end mb-3" style={{ maxWidth: 720 }}>
              <div className="field mb-0">
                <label>Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="acme-admin" />
              </div>
              <div className="field mb-0">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div className="field mb-0">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn" type="button" onClick={handleSave} disabled={saving || loading}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function SheetConfigRow({ company, onClose, onSaved }) {
  const toast = useToast();
  const [sheets, setSheets] = useState(
    company.sheets && company.sheets.length > 0 ? company.sheets.map((s) => ({ ...s })) : [{ ...EMPTY_SHEET }]
  );
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(company.syncIntervalMinutes || 1);
  const [saving, setSaving] = useState(false);

  function updateSheet(index, field, value) {
    setSheets((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addSheet() {
    setSheets((prev) => [...prev, { ...EMPTY_SHEET }]);
  }

  function removeSheet(index) {
    setSheets((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets, syncIntervalMinutes: Number(syncIntervalMinutes) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save sheet config");
      }
      toast("Saved. Syncing now...");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="form" style={{ padding: "16px 0" }}>
          {sheets.map((sheet, i) => (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-3" key={i}>
              <div className="field mb-0">
                <label>Label (optional)</label>
                <input
                  value={sheet.label}
                  onChange={(e) => updateSheet(i, "label", e.target.value)}
                  placeholder="Primary, CarDekho Export..."
                />
              </div>
              <div className="field mb-0">
                <label>Google Sheet ID</label>
                <input
                  value={sheet.sheetId}
                  onChange={(e) => updateSheet(i, "sheetId", e.target.value)}
                  placeholder="1AbCDefGhIJkLmNoPQRstuVwxyZ..."
                />
              </div>
              <div className="field mb-0">
                <label>Sheet Tabs (optional)</label>
                <input
                  value={sheet.sheetName}
                  onChange={(e) => updateSheet(i, "sheetName", e.target.value)}
                  placeholder="Leave blank to sync every tab"
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-sm"
                  type="button"
                  onClick={() => removeSheet(i)}
                  disabled={sheets.length === 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 items-end mb-3">
            <button className="btn-sm" type="button" onClick={addSheet}>
              + Add Another Sheet
            </button>
            <div className="field mb-0">
              <label>Sync Interval</label>
              <select value={syncIntervalMinutes} onChange={(e) => setSyncIntervalMinutes(e.target.value)}>
                <option value={1}>Every 1 minute</option>
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={1440}>Daily</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="hint mt-2">
            The ID from each sheet's URL: docs.google.com/spreadsheets/d/&lt;ID&gt;/edit. Keep tab names unique
            across a company's sheets — duplicate-detection matches by tab name, not by which sheet it came from.
          </div>
        </div>
      </td>
    </tr>
  );
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EMPTY_COLUMN = { key: "", label: "", matcherSource: "" };

// Lets a super admin pick which raw lead fields (beyond the fixed core
// columns) show up in this company's Leads table — see
// pages/api/companies/[id]/lead-fields/discover.js for where the field list
// comes from, and lib/leadFields.js's FIELD_MATCHERS for why this is stored
// as a regex (a literal, escaped one here) rather than an exact key: sheet
// headers vary slightly per tab/export even within one company.
function LeadFieldColumnsRow({ company, onClose, onSaved }) {
  const toast = useToast();
  const [discovered, setDiscovered] = useState([]);
  const [loadingDiscovered, setLoadingDiscovered] = useState(true);
  const [columns, setColumns] = useState(
    (company.leadFieldColumns || []).map((c) => ({ key: c.key, label: c.label, matcherSource: (c.matchers || [])[0] || "" }))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/companies/${company._id}/lead-fields/discover`)
      .then((res) => (res.ok ? res.json() : { fields: [] }))
      .then((data) => {
        if (!cancelled) {
          setDiscovered(data.fields || []);
          setLoadingDiscovered(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [company._id]);

  function updateColumn(index, field, value) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function addColumn() {
    setColumns((prev) => [...prev, { ...EMPTY_COLUMN }]);
  }

  function removeColumn(index) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  }

  function moveColumn(index, dir) {
    setColumns((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handlePickField(index, rawKey) {
    // Auto-fill a sensible label the first time a field is picked, without
    // clobbering a label the admin already typed in.
    const guessedLabel = rawKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setColumns((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, matcherSource: rawKey, key: c.key || rawKey, label: c.label || guessedLabel } : c
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const leadFieldColumns = columns
        .filter((c) => c.matcherSource && c.label)
        .map((c) => ({ key: c.key || c.matcherSource, label: c.label, matchers: [escapeRegExp(c.matcherSource)] }));
      const res = await apiFetch(`/api/companies/${company._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadFieldColumns }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save table columns");
      }
      toast("Table columns saved");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="form" style={{ padding: "16px 0" }}>
          <div className="hint mb-3">
            Pick which raw fields from this company's leads show up as extra Leads-table columns, beyond the fixed
            core ones (Name/Phone/Status/Agent/etc).{" "}
            {loadingDiscovered
              ? "Scanning recent leads for fields..."
              : discovered.length === 0
              ? "No leads synced yet — import or sync at least one lead first, then come back here."
              : `${discovered.length} field(s) found across this company's recent leads.`}
          </div>
          {columns.map((col, i) => (
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_auto] gap-3 items-end mb-3" key={i}>
              <div className="field mb-0">
                <label>Source field</label>
                <select value={col.matcherSource} onChange={(e) => handlePickField(i, e.target.value)}>
                  <option value="">Select a field...</option>
                  {discovered.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.key} ({f.example})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field mb-0">
                <label>Column label</label>
                <input
                  value={col.label}
                  onChange={(e) => updateColumn(i, "label", e.target.value)}
                  placeholder="Preferred Service Location"
                />
              </div>
              <div className="flex gap-2">
                <button className="btn-sm" type="button" onClick={() => moveColumn(i, -1)} disabled={i === 0} title="Move up">
                  &uarr;
                </button>
                <button
                  className="btn-sm"
                  type="button"
                  onClick={() => moveColumn(i, 1)}
                  disabled={i === columns.length - 1}
                  title="Move down"
                >
                  &darr;
                </button>
                <button className="btn-sm" type="button" onClick={() => removeColumn(i)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 mb-3">
            <button className="btn-sm" type="button" onClick={addColumn}>
              + Add Column
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// Lets a super admin give one company its own Lead Status / Lead Source /
// Location filter option lists (see models/Settings.js's
// statusOptions/sourceOptions/sourceMap/locationField), independent of every
// other company's — empty fields here mean "use the app-wide default,"
// which is exactly today's behavior for a company that never configures
// this row. Reuses the same field-discovery endpoint LeadFieldColumnsRow
// above already calls, so the Location field picker offers real raw sheet
// keys instead of the admin typing one blind.
function FilterConfigRow({ company, onClose, onSaved }) {
  const toast = useToast();
  const [discovered, setDiscovered] = useState([]);
  const [statusOptions, setStatusOptions] = useState(company.statusOptions?.length ? company.statusOptions : [""]);
  const [sourceOptions, setSourceOptions] = useState(company.sourceOptions?.length ? company.sourceOptions : [""]);
  const [sourceMap, setSourceMap] = useState(
    company.sourceMap?.length ? company.sourceMap.map((e) => ({ ...e })) : [{ from: "", to: "" }]
  );
  const [locationField, setLocationField] = useState(company.locationField || "");
  const [locationOptions, setLocationOptions] = useState(company.locationOptions?.length ? company.locationOptions : [""]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/companies/${company._id}/lead-fields/discover`)
      .then((res) => (res.ok ? res.json() : { fields: [] }))
      .then((data) => {
        if (!cancelled) setDiscovered(data.fields || []);
      });
    return () => {
      cancelled = true;
    };
  }, [company._id]);

  function updateListItem(setter, index, value) {
    setter((prev) => prev.map((v, i) => (i === index ? value : v)));
  }
  function addListItem(setter) {
    setter((prev) => [...prev, ""]);
  }
  function removeListItem(setter, index) {
    setter((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMapEntry(index, field, value) {
    setSourceMap((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }
  function addMapEntry() {
    setSourceMap((prev) => [...prev, { from: "", to: "" }]);
  }
  function removeMapEntry(index) {
    setSourceMap((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statusOptions: statusOptions.map((s) => s.trim()).filter(Boolean),
          sourceOptions: sourceOptions.map((s) => s.trim()).filter(Boolean),
          sourceMap: sourceMap.filter((e) => e.from.trim() && e.to.trim()),
          locationField: locationField.trim(),
          locationOptions: locationOptions.map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save filter config");
      }
      toast("Filter config saved");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7}>
        <div className="form" style={{ padding: "16px 0" }}>
          <div className="hint mb-3">
            Give {company.name} its own Lead Status / Lead Source / Location filter options on the Leads page,
            independent of every other company. Leave a section empty to keep using the app-wide default.
          </div>

          <div className="mb-4">
            <label className="block mb-1.5 text-sm font-semibold">Lead Status options</label>
            {statusOptions.map((s, i) => (
              <div className="flex gap-2 mb-2" key={i}>
                <input value={s} onChange={(e) => updateListItem(setStatusOptions, i, e.target.value)} placeholder="e.g. Appointments" />
                <button className="btn-sm" type="button" onClick={() => removeListItem(setStatusOptions, i)}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn-sm" type="button" onClick={() => addListItem(setStatusOptions)}>
              + Add Status
            </button>
          </div>

          <div className="mb-4">
            <label className="block mb-1.5 text-sm font-semibold">Lead Source options</label>
            {sourceOptions.map((s, i) => (
              <div className="flex gap-2 mb-2" key={i}>
                <input value={s} onChange={(e) => updateListItem(setSourceOptions, i, e.target.value)} placeholder="e.g. Website" />
                <button className="btn-sm" type="button" onClick={() => removeListItem(setSourceOptions, i)}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn-sm" type="button" onClick={() => addListItem(setSourceOptions)}>
              + Add Source
            </button>
          </div>

          <div className="mb-4">
            <label className="block mb-1.5 text-sm font-semibold">Source Map (raw synced value &rarr; option above)</label>
            <div className="hint mb-2">
              Applied to new leads as they sync, so the values above actually match what gets stored — e.g. a
              sheet's literal "Meta Ads" &rarr; "Meta". Existing leads aren't retroactively changed by this.
            </div>
            {sourceMap.map((entry, i) => (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mb-2" key={i}>
                <input value={entry.from} onChange={(e) => updateMapEntry(i, "from", e.target.value)} placeholder="Raw value, e.g. Meta Ads" />
                <input value={entry.to} onChange={(e) => updateMapEntry(i, "to", e.target.value)} placeholder="Maps to, e.g. Meta" />
                <button className="btn-sm" type="button" onClick={() => removeMapEntry(i)}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn-sm" type="button" onClick={addMapEntry}>
              + Add Mapping
            </button>
          </div>

          <div className="mb-4" style={{ maxWidth: 420 }}>
            <label className="block mb-1.5 text-sm font-semibold">Location field</label>
            <input
              value={locationField}
              onChange={(e) => setLocationField(e.target.value)}
              placeholder="e.g. city|location"
              list={`location-field-fields-${company._id}`}
            />
            <datalist id={`location-field-fields-${company._id}`}>
              {discovered.map((f) => (
                <option key={f.key} value={f.key} />
              ))}
            </datalist>
            <div className="hint mt-1">
              A regex matched (case-insensitive) against this company's raw sheet field names — a lead's location is
              read from whichever field matches first. Leave empty to use the default
              Hyderabad/Vijayawada/Visakhapatnam classifier. Different lead forms often name this differently (e.g.
              a plain "city" field on one form, "preferred_service_location" on another) — separate alternatives
              with <code>|</code>, e.g. <code>city|location</code>. Needed for the Location filter to match
              anything at all, but doesn't by itself decide what shows in the dropdown below.
            </div>
          </div>

          <div className="mb-4">
            <label className="block mb-1.5 text-sm font-semibold">Location options (filter dropdown)</label>
            <div className="hint mb-2">
              A fixed, hand-picked list — takes priority over auto-discovering every distinct value real leads have
              ever had (which, for raw ad-form data, is often noisy). Leave empty to fall back to auto-discovery.
            </div>
            {locationOptions.map((s, i) => (
              <div className="flex gap-2 mb-2" key={i}>
                <input
                  value={s}
                  onChange={(e) => updateListItem(setLocationOptions, i, e.target.value)}
                  placeholder="e.g. Kompally"
                />
                <button className="btn-sm" type="button" onClick={() => removeListItem(setLocationOptions, i)}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn-sm" type="button" onClick={() => addListItem(setLocationOptions)}>
              + Add Location
            </button>
          </div>

          <div className="flex gap-2 mt-3">
            <button className="btn" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

const MAPPING_FIELDS = [
  { key: "name", label: "Name field", placeholder: "e.g. full_name" },
  { key: "phone", label: "Phone field", placeholder: "e.g. mobile" },
  { key: "email", label: "Email field", placeholder: "e.g. email" },
  { key: "model", label: "Model field", placeholder: "e.g. car_variant" },
  { key: "message", label: "Message field", placeholder: "e.g. remarks" },
  { key: "location", label: "Location field", placeholder: "e.g. city" },
];

const EMPTY_MAPPING = { name: "", phone: "", email: "", model: "", message: "", location: "" };

function FieldMappingInputs({ mapping, onChange }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {MAPPING_FIELDS.map((f) => (
        <div className="field mb-0" key={f.key}>
          <label>{f.label}</label>
          <input
            value={mapping[f.key] || ""}
            onChange={(e) => onChange({ ...mapping, [f.key]: e.target.value })}
            placeholder={f.placeholder}
          />
        </div>
      ))}
    </div>
  );
}

function MappingEditRow({ company, apiKey, onClose, onSaved }) {
  const toast = useToast();
  const [mapping, setMapping] = useState({ ...EMPTY_MAPPING, ...apiKey.fieldMapping });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/companies/${company._id}/api-keys/${apiKey._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldMapping: mapping }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save field mapping");
      }
      toast("Field mapping saved");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={5}>
        <div style={{ padding: "12px 0" }}>
          <div className="hint mb-2">
            Blank fields fall back to auto-detection (common aliases like name/full_name, phone/mobile, etc.). Fill
            these in only if {apiKey.sourceName}'s payload uses field names our auto-detection wouldn't catch.
          </div>
          <FieldMappingInputs mapping={mapping} onChange={setMapping} />
          <div className="flex gap-2 mt-3">
            <button className="btn-sm" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Mapping"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function LimitsEditRow({ company, apiKey, onClose, onSaved }) {
  const toast = useToast();
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(apiKey.rateLimitPerMinute || 60);
  const [allowedIps, setAllowedIps] = useState((apiKey.allowedIps || []).join(", "));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const ips = allowedIps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch(`/api/companies/${company._id}/api-keys/${apiKey._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateLimitPerMinute: Number(rateLimitPerMinute), allowedIps: ips }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save limits");
      }
      toast("Limits saved");
      onSaved();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={5}>
        <div style={{ padding: "12px 0" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="field mb-0">
              <label>Rate Limit (requests/minute)</label>
              <input
                type="number"
                min={1}
                value={rateLimitPerMinute}
                onChange={(e) => setRateLimitPerMinute(e.target.value)}
              />
            </div>
            <div className="field mb-0">
              <label>IP Allowlist (optional, comma-separated)</label>
              <input
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                placeholder="Leave blank to allow any IP"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-sm" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Limits"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function LogsViewRow({ company, apiKey, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/companies/${company._id}/api-keys/${apiKey._id}/logs`)
      .then((res) => (res.ok ? res.json() : { logs: [] }))
      .then((data) => {
        if (!cancelled) {
          setLogs(data.logs || []);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [company._id, apiKey._id]);

  return (
    <tr>
      <td colSpan={5}>
        <div style={{ padding: "12px 0" }}>
          <div className="flex items-center justify-between mb-2">
            <strong>Recent deliveries — {apiKey.sourceName}</strong>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
          {loading ? (
            <Skeleton count={3} height={26} />
          ) : logs.length === 0 ? (
            <div className="empty-state">No deliveries logged yet for this key.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>IP</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td className="text-muted">{new Date(log.createdAt).toLocaleString()}</td>
                    <td>
                      <span
                        className={`pill ${
                          log.status === "created" || log.status === "duplicate"
                            ? "bg-success/10 text-success"
                            : "bg-danger/10 text-danger"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="text-muted">{log.ip || "-"}</td>
                    <td className="text-muted">{log.errorMessage || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="hint mt-2">Logs auto-expire after 30 days.</div>
        </div>
      </td>
    </tr>
  );
}

function TestLeadRow({ company, apiKey, onClose }) {
  const toast = useToast();
  const [payloadText, setPayloadText] = useState('{\n  "name": "Test Customer",\n  "phone": "9876543210",\n  "model": "Q5"\n}');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const samplePayload = JSON.parse(payloadText);
      const res = await apiFetch(`/api/companies/${company._id}/api-keys/${apiKey._id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samplePayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      setResult(data);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <tr>
      <td colSpan={5}>
        <div style={{ padding: "12px 0" }}>
          <div className="hint mb-2">
            Paste a sample payload as {apiKey.sourceName} would send it, and see exactly how it would be parsed
            using this key's field mapping — this is a dry run, no lead is created.
          </div>
          <textarea
            className="w-full"
            rows={6}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 13 }}
          />
          <div className="flex gap-2 mt-2">
            <button className="btn-sm" type="button" onClick={handleRun} disabled={running}>
              {running ? "Running..." : "Run Test"}
            </button>
            <button className="btn-sm" type="button" onClick={onClose}>
              Close
            </button>
          </div>
          {result && (
            <div className="panel mt-3" style={{ padding: 14 }}>
              {result.wouldReject && (
                <div className="save-msg err mb-2">
                  Would be rejected: at least one of phone or email is required.
                </div>
              )}
              <table>
                <tbody>
                  {Object.entries(result.parsed).map(([field, value]) => (
                    <tr key={field}>
                      <td className="text-muted" style={{ textTransform: "capitalize" }}>
                        {field}
                      </td>
                      <td>{value || <span className="hint">(empty)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function ApiKeysRow({ company, onClose }) {
  const toast = useToast();
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceName, setSourceName] = useState("");
  const [newMapping, setNewMapping] = useState(EMPTY_MAPPING);
  const [newRateLimit, setNewRateLimit] = useState(60);
  const [newAllowedIps, setNewAllowedIps] = useState("");
  const [showMappingForNew, setShowMappingForNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null); // { rawKey, sourceName } — shown once
  const [expanded, setExpanded] = useState(null); // { id, view: "mapping"|"limits"|"logs"|"test" }

  function toggle(id, view) {
    setExpanded((prev) => (prev?.id === id && prev.view === view ? null : { id, view }));
  }

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/companies/${company._id}/api-keys`);
    if (res.ok) {
      const data = await res.json();
      setKeys(data.apiKeys || []);
    }
    setLoading(false);
  }, [company._id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setNewKey(null);
    try {
      const ips = newAllowedIps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch(`/api/companies/${company._id}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName,
          fieldMapping: newMapping,
          rateLimitPerMinute: Number(newRateLimit),
          allowedIps: ips,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create API key");
      setNewKey({ rawKey: data.rawKey, sourceName: data.apiKey.sourceName });
      setSourceName("");
      setNewMapping(EMPTY_MAPPING);
      setNewRateLimit(60);
      setNewAllowedIps("");
      setShowMappingForNew(false);
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(key) {
    const res = await apiFetch(`/api/companies/${company._id}/api-keys/${key._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !key.active }),
    });
    toast(res.ok ? (key.active ? "Key revoked" : "Key reactivated") : "Failed to update key", {
      type: res.ok ? "ok" : "err",
    });
    load();
  }

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/public/leads` : "/api/public/leads";

  return (
    <tr>
      <td colSpan={7}>
        <div style={{ padding: "16px 0" }}>
          <form onSubmit={handleCreate} className="mb-3">
            <div className="flex gap-3 items-end mb-2">
              <div className="field mb-0">
                <label>New Lead Source</label>
                <input
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="CarDekho, CarWale, Website Form..."
                  required
                />
              </div>
              <button className="btn" type="submit" disabled={creating}>
                {creating ? "Generating..." : "Generate Key"}
              </button>
              <button
                className="btn-sm"
                type="button"
                onClick={() => setShowMappingForNew((v) => !v)}
              >
                {showMappingForNew ? "Hide Advanced" : "Advanced Settings"}
              </button>
              <button className="btn-sm" type="button" onClick={onClose}>
                Close
              </button>
            </div>
            {showMappingForNew && (
              <div className="mt-2">
                <div className="hint mb-2">
                  Optional — only fill in fields whose incoming name this source uses that our auto-detection
                  wouldn't recognize (e.g. CarDekho sending "candidate_name" instead of "name").
                </div>
                <FieldMappingInputs mapping={newMapping} onChange={setNewMapping} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="field mb-0">
                    <label>Rate Limit (requests/minute)</label>
                    <input type="number" min={1} value={newRateLimit} onChange={(e) => setNewRateLimit(e.target.value)} />
                  </div>
                  <div className="field mb-0">
                    <label>IP Allowlist (optional, comma-separated)</label>
                    <input
                      value={newAllowedIps}
                      onChange={(e) => setNewAllowedIps(e.target.value)}
                      placeholder="Leave blank to allow any IP"
                    />
                  </div>
                </div>
              </div>
            )}
          </form>

          {newKey && (
            <div className="panel mb-4" style={{ padding: 14, background: "#fffbeb", borderColor: "#f59e0b" }}>
              <strong>{newKey.sourceName} key created — copy it now, it won't be shown again:</strong>
              <div className="flex items-center gap-2 mt-2">
                <code style={{ wordBreak: "break-all" }}>{newKey.rawKey}</code>
                <button
                  className="btn-sm"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(newKey.rawKey)}
                >
                  Copy
                </button>
              </div>
              <div className="hint mt-2">
                Give {newKey.sourceName} this endpoint URL and key: <code>{webhookUrl}</code>, sent as header{" "}
                <code>Authorization: Bearer &lt;key&gt;</code> (or <code>X-Api-Key</code>, or a{" "}
                <code>?key=</code> query param if their integration only supports a plain URL).
              </div>
            </div>
          )}

          {loading ? (
            <Skeleton count={2} height={30} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Key</th>
                  <th>Last Used</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <Fragment key={k._id}>
                    <tr>
                      <td>{k.sourceName}</td>
                      <td className="text-muted">
                        <code>{k.keyPrefix}</code>
                      </td>
                      <td className="text-muted">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                      <td>
                        <span className={`pill ${k.active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                          {k.active ? "Active" : "Revoked"}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2 flex-wrap">
                          <button className="btn-sm" onClick={() => toggle(k._id, "mapping")}>
                            {expanded?.id === k._id && expanded.view === "mapping" ? "Cancel" : "Field Mapping"}
                          </button>
                          <button className="btn-sm" onClick={() => toggle(k._id, "limits")}>
                            {expanded?.id === k._id && expanded.view === "limits" ? "Cancel" : "Limits"}
                          </button>
                          <button className="btn-sm" onClick={() => toggle(k._id, "logs")}>
                            {expanded?.id === k._id && expanded.view === "logs" ? "Cancel" : "Logs"}
                          </button>
                          <button className="btn-sm" onClick={() => toggle(k._id, "test")}>
                            {expanded?.id === k._id && expanded.view === "test" ? "Cancel" : "Test Lead"}
                          </button>
                          <button className="btn-sm" onClick={() => toggleActive(k)}>
                            {k.active ? "Revoke" : "Reactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded?.id === k._id && expanded.view === "mapping" && (
                      <MappingEditRow
                        company={company}
                        apiKey={k}
                        onClose={() => setExpanded(null)}
                        onSaved={() => {
                          setExpanded(null);
                          load();
                        }}
                      />
                    )}
                    {expanded?.id === k._id && expanded.view === "limits" && (
                      <LimitsEditRow
                        company={company}
                        apiKey={k}
                        onClose={() => setExpanded(null)}
                        onSaved={() => {
                          setExpanded(null);
                          load();
                        }}
                      />
                    )}
                    {expanded?.id === k._id && expanded.view === "logs" && (
                      <LogsViewRow company={company} apiKey={k} onClose={() => setExpanded(null)} />
                    )}
                    {expanded?.id === k._id && expanded.view === "test" && (
                      <TestLeadRow company={company} apiKey={k} onClose={() => setExpanded(null)} />
                    )}
                  </Fragment>
                ))}
                {keys.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      No lead-source API keys yet — generate one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function CompaniesPanel() {
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#3d5afe");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [apiKeysId, setApiKeysId] = useState(null);
  const [leadFieldsId, setLeadFieldsId] = useState(null);
  const [logoRowId, setLogoRowId] = useState(null);
  const [adminAccountId, setAdminAccountId] = useState(null);
  const [filterConfigId, setFilterConfigId] = useState(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/companies");
    if (!res.ok) return;
    const data = await res.json();
    setCompanies(data.companies || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminUsername, adminPassword, logoUrl, brandColor }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add company");
      }
      setName("");
      setAdminUsername("");
      setAdminPassword("");
      setLogoUrl("");
      setBrandColor("#3d5afe");
      toast("Company added");
      load();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(company) {
    const res = await apiFetch(`/api/companies/${company._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !company.active }),
    });
    toast(res.ok ? (company.active ? `${company.name} deactivated` : `${company.name} reactivated`) : "Failed to update company", {
      type: res.ok ? "ok" : "err",
    });
    load();
  }

  async function changeBrandColor(company, newColor) {
    setCompanies((prev) => prev.map((c) => (c._id === company._id ? { ...c, brandColor: newColor } : c)));
    const res = await apiFetch(`/api/companies/${company._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandColor: newColor }),
    });
    if (res.ok) toast(`${company.name}'s brand color updated`);
    else toast("Failed to update brand color", { type: "err" });
  }

  return (
    <div className="panel mt-6">
      <div className="panel-header">
        <h2>Companies</h2>
      </div>

      <div className="p-5">
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-5">
          <div className="field mb-0">
            <label>Company Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Motors" required />
          </div>
          <div className="field mb-0">
            <label>Admin Username</label>
            <input
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="acme-admin"
              required
            />
          </div>
          <div className="field mb-0">
            <label>Admin Password</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <div className="field mb-0">
            <label>Logo (optional)</label>
            <LogoUploadField value={logoUrl} onChange={setLogoUrl} />
          </div>
          <div className="field mb-0">
            <label>Brand Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-12 rounded-md border border-border cursor-pointer p-0.5"
              />
              <input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="flex-1"
                placeholder="#3d5afe"
              />
            </div>
          </div>
          <div className="sm:col-span-4">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Company"}
            </button>
          </div>
        </form>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Color</th>
              <th>Agents</th>
              <th>Leads</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j}><Skeleton /></td>
                  ))}
                </tr>
              ))
            ) : (
              <>
                {companies.map((c) => (
                  <Fragment key={c._id}>
                    <tr>
                      <td>{c.name}</td>
                      <td className="text-muted">{c.slug}</td>
                      <td>
                        <input
                          type="color"
                          value={c.brandColor || "#3d5afe"}
                          onChange={(e) => changeBrandColor(c, e.target.value)}
                          className="h-7 w-9 rounded border border-border cursor-pointer p-0.5"
                          title="Company brand color"
                        />
                      </td>
                      <td>{c.agentCount}</td>
                      <td>{c.leadCount}</td>
                      <td>
                        <span className={`pill ${c.active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                          {c.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setApiKeysId(null);
                              setLeadFieldsId(null);
                              setLogoRowId(null);
                              setAdminAccountId(null);
                              setFilterConfigId(null);
                              setEditingId(editingId === c._id ? null : c._id);
                            }}
                          >
                            {editingId === c._id ? "Cancel" : c.sheets?.length ? "Sheet Config" : "Connect Sheet"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingId(null);
                              setLeadFieldsId(null);
                              setLogoRowId(null);
                              setAdminAccountId(null);
                              setFilterConfigId(null);
                              setApiKeysId(apiKeysId === c._id ? null : c._id);
                            }}
                          >
                            {apiKeysId === c._id ? "Cancel" : "Lead Source API Keys"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingId(null);
                              setApiKeysId(null);
                              setLogoRowId(null);
                              setAdminAccountId(null);
                              setFilterConfigId(null);
                              setLeadFieldsId(leadFieldsId === c._id ? null : c._id);
                            }}
                          >
                            {leadFieldsId === c._id ? "Cancel" : "Table Columns"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingId(null);
                              setApiKeysId(null);
                              setLeadFieldsId(null);
                              setAdminAccountId(null);
                              setFilterConfigId(null);
                              setLogoRowId(logoRowId === c._id ? null : c._id);
                            }}
                          >
                            {logoRowId === c._id ? "Cancel" : "Logo"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingId(null);
                              setApiKeysId(null);
                              setLeadFieldsId(null);
                              setLogoRowId(null);
                              setFilterConfigId(null);
                              setAdminAccountId(adminAccountId === c._id ? null : c._id);
                            }}
                          >
                            {adminAccountId === c._id ? "Cancel" : "Admin Login"}
                          </button>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingId(null);
                              setApiKeysId(null);
                              setLeadFieldsId(null);
                              setLogoRowId(null);
                              setAdminAccountId(null);
                              setFilterConfigId(filterConfigId === c._id ? null : c._id);
                            }}
                          >
                            {filterConfigId === c._id ? "Cancel" : "Filters"}
                          </button>
                          <button className="btn-sm" onClick={() => toggleActive(c)}>
                            {c.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingId === c._id && (
                      <SheetConfigRow
                        key={`${c._id}-config`}
                        company={c}
                        onClose={() => setEditingId(null)}
                        onSaved={() => {
                          setEditingId(null);
                          load();
                        }}
                      />
                    )}
                    {apiKeysId === c._id && (
                      <ApiKeysRow key={`${c._id}-keys`} company={c} onClose={() => setApiKeysId(null)} />
                    )}
                    {leadFieldsId === c._id && (
                      <LeadFieldColumnsRow
                        key={`${c._id}-lead-fields`}
                        company={c}
                        onClose={() => setLeadFieldsId(null)}
                        onSaved={() => {
                          setLeadFieldsId(null);
                          load();
                        }}
                      />
                    )}
                    {logoRowId === c._id && (
                      <LogoRow
                        key={`${c._id}-logo`}
                        company={c}
                        onClose={() => setLogoRowId(null)}
                        onSaved={() => {
                          setLogoRowId(null);
                          load();
                        }}
                      />
                    )}
                    {adminAccountId === c._id && (
                      <AdminAccountRow
                        key={`${c._id}-admin`}
                        company={c}
                        onClose={() => setAdminAccountId(null)}
                        onSaved={() => setAdminAccountId(null)}
                      />
                    )}
                    {filterConfigId === c._id && (
                      <FilterConfigRow
                        key={`${c._id}-filters`}
                        company={c}
                        onClose={() => setFilterConfigId(null)}
                        onSaved={() => {
                          setFilterConfigId(null);
                          load();
                        }}
                      />
                    )}
                  </Fragment>
                ))}
                {companies.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No companies yet — add one above.
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        <div className="hint mt-3">
          Each company gets its own admin login, own Google Sheet config, own agents, and own leads — completely
          isolated from every other company. Only the platform admin manages each company's Google Sheet connection
          and its Lead Source API keys (for integrations like CarDekho/CarWale); company admins see sync status
          only. Deactivating a company blocks its sync and hides it from new onboarding, but keeps its data intact.
        </div>
      </div>
    </div>
  );
}
