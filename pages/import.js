import { useState, useRef, useEffect, useCallback } from "react";
import Layout from "../components/Layout";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "../components/ToastProvider";
import { UploadIcon } from "../components/icons";
import { LEAD_SOURCES } from "../lib/leadSources";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role !== "super_admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: { username: session.username } };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Steps: upload -> mapping -> preview -> result. Each step's screen replaces
// the previous one entirely (no wizard chrome) — matches this page's
// existing plain-panel style rather than introducing a new stepper component.
export default function ImportLeadsPage({ username }) {
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [sourceSlug, setSourceSlug] = useState("");
  const [file, setFile] = useState(null);
  const [fileBase64, setFileBase64] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState("upload");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState(null); // { headers, suggestedMapping, unmappedColumns, crmFields, preview, rows, counts }
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [revokeArmedId, setRevokeArmedId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const fileInputRef = useRef(null);

  const loadCompanies = useCallback(() => {
    apiFetch("/api/companies")
      .then((res) => res.json())
      .then((data) => {
        const list = data.companies || [];
        setCompanies(list);
        setCompanyId((prev) => prev || list[0]?._id || "");
      });
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const loadHistory = useCallback(() => {
    if (!companyId) return;
    setHistoryLoading(true);
    apiFetch(`/api/leads/import-history?companyId=${companyId}`)
      .then((res) => res.json())
      .then((data) => setHistory(data.batches || []))
      .finally(() => setHistoryLoading(false));
  }, [companyId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function handleRevoke(batchId) {
    if (revokeArmedId !== batchId) {
      setRevokeArmedId(batchId);
      return;
    }
    setRevokeArmedId(null);
    setRevokingId(batchId);
    try {
      const res = await apiFetch(`/api/leads/import-history/${batchId}/revoke`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed");
      toast(`Revoked — removed ${data.revokedCount} lead${data.revokedCount === 1 ? "" : "s"}`);
      loadHistory();
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setRevokingId(null);
    }
  }

  const selectedSource = LEAD_SOURCES.find((s) => s.slug === sourceSlug) || null;

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setFileBase64("");
    setParseResult(null);
    setMapping({});
    setResult(null);
    setErrorMessage("");
  }

  function pickFile(f) {
    setErrorMessage("");
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  }

  function handleFileInput(e) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (f) pickFile(f);
  }

  async function runPreview(mappingToUse) {
    setErrorMessage("");
    try {
      const res = await apiFetch("/api/leads/import-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, filename: file?.name, companyId, sourceSlug, mapping: mappingToUse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that file");
      setParseResult(data);
      return data;
    } catch (err) {
      setErrorMessage(err.message);
      toast(err.message, { type: "err" });
      return null;
    }
  }

  async function handleUploadAndPreview() {
    if (!file || !companyId || !sourceSlug) return;
    setParsing(true);
    try {
      const b64 = await readFileAsBase64(file);
      setFileBase64(b64);
      const res = await apiFetch("/api/leads/import-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: b64, filename: file.name, companyId, sourceSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that file");
      setParseResult(data);
      setMapping(data.suggestedMapping);
      setStep("mapping");
    } catch (err) {
      setErrorMessage(err.message);
      toast(err.message, { type: "err" });
    } finally {
      setParsing(false);
    }
  }

  function handleMappingChange(fieldKey, header) {
    setMapping((prev) => ({ ...prev, [fieldKey]: header || null }));
  }

  async function handleContinueToPreview() {
    setParsing(true);
    const data = await runPreview(mapping);
    setParsing(false);
    if (data) setStep("preview");
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await apiFetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, sourceSlug, mapping, rows: parseResult.rows, filename: file?.name || "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult({ type: "ok", data });
      setStep("result");
      toast(`Imported ${data.created} new lead${data.created === 1 ? "" : "s"}`);
      loadHistory();
    } catch (err) {
      setResult({ type: "err", message: err.message });
      setStep("result");
      toast(err.message, { type: "err" });
    } finally {
      setImporting(false);
    }
  }

  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));

  return (
    <Layout username={username} role="super_admin">
      <h1 className="page-title">Import Leads</h1>
      <p className="hint mb-5">
        Upload a CSV or Excel file to bulk-add leads into any company. Every row runs through the same
        duplicate-detection and auto-assignment as Google Sheets sync — a customer who already has a lead for the
        same model gets merged as a repeat enquiry instead of duplicated.
      </p>

      <div className="panel mb-5" style={{ padding: 20 }}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="field mb-0">
            <label>Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={step !== "upload"}
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

          <div className="field mb-0">
            <label>Lead Source</label>
            <select
              value={sourceSlug}
              onChange={(e) => setSourceSlug(e.target.value)}
              disabled={step !== "upload"}
              className="disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="">Select a source...</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field mb-0">
            <label>Channel</label>
            <div
              className={`w-full rounded-lg border px-3 py-2.5 text-sm ${
                selectedSource ? "border-accent/30 bg-accent/5 font-semibold text-accent" : "border-border bg-bg text-muted"
              }`}
            >
              {selectedSource ? selectedSource.channel : "Select a source first"}
            </div>
          </div>
        </div>
      </div>

      {step === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <div
              className={`panel flex flex-col items-center justify-center text-center p-10 border-2 border-dashed cursor-pointer transition-colors ${
                dragOver ? "border-accent bg-accent/5" : "border-border"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon width={40} height={40} className="text-muted mb-3" />
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={handleFileInput}
              />
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span className="hint mt-1">{(file.size / 1024).toFixed(1)} KB — click to choose a different file</span>
                </>
              ) : (
                <>
                  <strong>Drag &amp; drop a CSV or Excel file here</strong>
                  <span className="hint mt-1">or click to browse — .csv, .xlsx, .xls (up to 2000 rows)</span>
                </>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <button className="btn" onClick={handleUploadAndPreview} disabled={!file || !companyId || !sourceSlug || parsing}>
                {parsing ? "Reading file..." : "Upload & Preview"}
              </button>
              {file && !parsing && (
                <button className="btn-sm" onClick={() => setFile(null)}>
                  Clear
                </button>
              )}
            </div>

            {errorMessage && <div className="save-msg err mt-3">{errorMessage}</div>}
            {!sourceSlug && <div className="hint mt-3">Select a lead source above before uploading — it's stored against every lead you import.</div>}
          </div>

          <div className="panel" style={{ padding: 20, height: "fit-content" }}>
            <h3 className="mb-3">How this works</h3>
            <p className="hint mb-2">
              After upload, you'll see exactly which column maps to which CRM field (auto-detected per source, and
              editable), then a preview with counts before anything is actually imported.
            </p>
            <p className="hint">
              Columns that don't match any CRM field aren't lost — they're kept on each lead's raw data for later
              reference.
            </p>
          </div>
        </div>
      )}

      {step === "mapping" && parseResult && (
        <div className="panel" style={{ padding: 20 }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="m-0">Column Mapping — {selectedSource?.name}</h3>
            <span className="hint">{parseResult.headers.length} columns found in {file?.name}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Excel Column</th>
                <th></th>
                <th>CRM Field</th>
              </tr>
            </thead>
            <tbody>
              {parseResult.crmFields.map((field) => (
                <tr key={field.key}>
                  <td className="text-muted">{mapping[field.key] || <span className="hint">(not mapped)</span>}</td>
                  <td className="text-muted">→</td>
                  <td>
                    <select
                      value={mapping[field.key] || ""}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    >
                      <option value="">-- Not mapped --</option>
                      {parseResult.headers.map((h) => (
                        <option key={h} value={h} disabled={mappedHeaders.has(h) && mapping[field.key] !== h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="hint ml-2">{field.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {parseResult.unmappedColumns.length > 0 && (
            <div className="mt-4">
              <strong>Unmapped Columns:</strong>
              <p className="hint mt-1 mb-1">
                Not shown on the lead form, but kept on the lead's raw data so nothing is lost.
              </p>
              <ul className="mt-1">
                {parseResult.unmappedColumns
                  .filter((h) => !mappedHeaders.has(h))
                  .map((h) => (
                    <li key={h} className="hint">
                      {h}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button className="btn" onClick={handleContinueToPreview} disabled={parsing}>
              {parsing ? "Checking..." : "Continue to Preview"}
            </button>
            <button className="btn-sm" onClick={resetToUpload}>
              Back
            </button>
          </div>
          {errorMessage && <div className="save-msg err mt-3">{errorMessage}</div>}
        </div>
      )}

      {step === "preview" && parseResult && (
        <div className="panel" style={{ padding: 20 }}>
          <h3 className="mb-3">Preview — {selectedSource?.name}</h3>
          <div className="status-grid mb-4">
            <div className="card">
              <div className="label">Total Rows</div>
              <div className="value">{parseResult.counts.totalRows}</div>
            </div>
            <div className="card">
              <div className="label">Valid Leads</div>
              <div className="value">{parseResult.counts.validLeads}</div>
            </div>
            <div className="card">
              <div className="label">Missing Phone/Email</div>
              <div className="value">{parseResult.counts.missingContact}</div>
            </div>
            <div className="card">
              <div className="label">Likely Duplicates</div>
              <div className="value">{parseResult.counts.duplicates}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Model</th>
                <th>Source</th>
                <th>Campaign</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {parseResult.preview.map((row, i) => (
                <tr key={i}>
                  <td>{row.name || "-"}</td>
                  <td>{row.phone || "-"}</td>
                  <td>{row.email || "-"}</td>
                  <td>{row.model || "-"}</td>
                  <td>{selectedSource?.name}</td>
                  <td>{row.campaign || "-"}</td>
                  <td className={row.status === "Valid" ? "text-success" : "text-danger"}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint mt-2">Showing the first {parseResult.preview.length} of {parseResult.counts.totalRows} rows.</p>

          <div className="flex gap-2 mt-4">
            <button className="btn" onClick={handleImport} disabled={importing || parseResult.counts.validLeads === 0}>
              {importing ? "Importing..." : `Import ${parseResult.counts.validLeads.toLocaleString()} Leads`}
            </button>
            <button className="btn-sm" onClick={() => setStep("mapping")} disabled={importing}>
              Back to Mapping
            </button>
            <button className="btn-sm" onClick={resetToUpload} disabled={importing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="panel" style={{ padding: 20 }}>
          {result.type === "err" ? (
            <div className="save-msg err">{result.message}</div>
          ) : (
            <>
              <div className="save-msg ok mb-3">Import complete.</div>
              <div className="status-grid">
                <div className="card">
                  <div className="label">Total Rows</div>
                  <div className="value">{result.data.totalRows}</div>
                </div>
                <div className="card">
                  <div className="label">Created</div>
                  <div className="value">{result.data.created}</div>
                </div>
                <div className="card">
                  <div className="label">Merged (Repeat Enquiry)</div>
                  <div className="value">{result.data.duplicate}</div>
                </div>
                <div className="card">
                  <div className="label">Skipped</div>
                  <div className="value">{result.data.skipped}</div>
                </div>
              </div>
              {result.data.errors?.length > 0 && (
                <div className="mt-3">
                  <strong>{result.data.errorCount} row error(s):</strong>
                  <ul className="mt-1">
                    {result.data.errors.map((e, i) => (
                      <li key={i} className="hint">
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <button className="btn mt-4" onClick={resetToUpload}>
            Import Another File
          </button>
        </div>
      )}

      <div className="panel mt-6" style={{ padding: 20 }}>
        <h3 className="mb-3">Import History</h3>
        <p className="hint mb-3">
          Every past import for this company. If the wrong file or mapping was used, Revoke deletes the leads it
          created — including any an agent may have since called or added notes to. Leads it merged into an
          existing customer's history as a repeat enquiry are left untouched.
        </p>
        {historyLoading ? (
          <div className="hint">Loading...</div>
        ) : history.length === 0 ? (
          <div className="empty-state">No imports yet for this company.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>File</th>
                <th>Created</th>
                <th>Merged</th>
                <th>Skipped</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b._id}>
                  <td className="text-muted">{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.sourceName}</td>
                  <td className="text-muted">{b.filename || "-"}</td>
                  <td>{b.created}</td>
                  <td>{b.duplicate}</td>
                  <td>{b.skipped}</td>
                  <td>
                    {b.revoked ? (
                      <span className="pill bg-danger/10 text-danger" title={b.revokedAt ? new Date(b.revokedAt).toLocaleString() : ""}>
                        Revoked ({b.revokedCount ?? 0})
                      </span>
                    ) : (
                      <span className="pill bg-success/10 text-success">Active</span>
                    )}
                  </td>
                  <td>
                    {!b.revoked && b.created > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          className="btn-sm"
                          style={revokeArmedId === b._id ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" } : undefined}
                          onClick={() => handleRevoke(b._id)}
                          disabled={revokingId === b._id}
                        >
                          {revokingId === b._id ? "Revoking..." : revokeArmedId === b._id ? `Confirm — delete ${b.created}?` : "Revoke Import"}
                        </button>
                        {revokeArmedId === b._id && revokingId !== b._id && (
                          <button className="btn-sm" onClick={() => setRevokeArmedId(null)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
