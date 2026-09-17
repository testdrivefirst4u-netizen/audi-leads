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
  const [importProgress, setImportProgress] = useState(null); // { done, total }
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

  // The file is posted in chunks of CHUNK_ROWS, one request after another,
  // all appended to the same import batch on the server — each request
  // stays short (one bulk write), so big files can't hit a serverless
  // timeout, and the page can show real progress.
  const CHUNK_ROWS = 500;
  async function handleImport() {
    setImporting(true);
    const rows = parseResult.rows;
    setImportProgress({ done: 0, total: rows.length });
    try {
      let batchId = null;
      let data = null;
      const allErrors = [];
      for (let offset = 0; offset < rows.length; offset += CHUNK_ROWS) {
        const chunk = rows.slice(offset, offset + CHUNK_ROWS);
        const res = await apiFetch("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            sourceSlug,
            mapping,
            rows: chunk,
            filename: file?.name || "",
            batchId,
            totalRows: rows.length,
            rowOffset: offset,
            isLast: offset + CHUNK_ROWS >= rows.length,
          }),
        });
        data = await res.json();
        if (!res.ok) {
          throw new Error(
            `${data.error || "Import failed"}${offset > 0 ? ` (${offset.toLocaleString()} of ${rows.length.toLocaleString()} rows were imported before the error — see Import History to revoke if needed)` : ""}`
          );
        }
        batchId = data.batchId;
        allErrors.push(...(data.errors || []));
        setImportProgress({ done: Math.min(offset + chunk.length, rows.length), total: rows.length });
      }
      setResult({ type: "ok", data: { ...data, errors: allErrors.slice(0, 20) } });
      setStep("result");
      toast(`Imported ${data.created} new lead${data.created === 1 ? "" : "s"}`);
      loadHistory();
    } catch (err) {
      setResult({ type: "err", message: err.message });
      setStep("result");
      toast(err.message, { type: "err" });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  const selectedCompany = companies.find((c) => c._id === companyId) || null;
  const stepIndex = { upload: 0, mapping: 1, preview: 2, result: 3 }[step] ?? 0;
  const STEPS = ["Set up", "Map columns", "Preview", "Done"];
  const activeHistory = history.filter((b) => !b.revoked);
  const historyTotals = {
    imports: activeHistory.length,
    created: activeHistory.reduce((s, b) => s + (b.created || 0), 0),
    merged: activeHistory.reduce((s, b) => s + (b.duplicate || 0), 0),
  };
  const autoMapped = parseResult?.suggestedMapping || {};

  return (
    <Layout username={username} role="super_admin">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title mb-1">Import Leads</h1>
          <p className="hint m-0">
            Bulk-add leads from a CSV or Excel export. Every row goes through the same duplicate detection and auto-assignment as the
            Google Sheet sync.
          </p>
        </div>
        {!historyLoading && selectedCompany && (
          <div className="hint m-0 text-right">
            <strong className="text-ink">{selectedCompany.name}</strong> · {historyTotals.imports} import{historyTotals.imports === 1 ? "" : "s"} ·{" "}
            {historyTotals.created.toLocaleString()} leads created · {historyTotals.merged.toLocaleString()} merged
          </div>
        )}
      </div>

      {/* Stepper */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                  active ? "border-accent bg-accent text-white" : done ? "border-success/30 bg-success/10 text-success" : "border-border bg-card text-muted"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    active ? "bg-white/20" : done ? "bg-success text-white" : "bg-bg"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                {label}
              </div>
              {i < STEPS.length - 1 && <span className={`h-px w-6 ${i < stepIndex ? "bg-success/40" : "bg-border"}`} />}
            </div>
          );
        })}
      </div>

      {step === "upload" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-5 lg:col-span-2">
            {/* 1. Company + source */}
            <div className="panel">
              <div className="panel-header">
                <h2>1 · Where do these leads belong?</h2>
              </div>
              <div className="p-5">
                <div className="field" style={{ maxWidth: 360 }}>
                  <label>Company</label>
                  <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    {companies.length === 0 && <option value="">No companies yet</option>}
                    {companies.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="block text-[13px] font-semibold text-muted mb-1.5">Lead source</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {LEAD_SOURCES.map((s) => {
                    const active = sourceSlug === s.slug;
                    return (
                      <button
                        key={s.slug}
                        type="button"
                        onClick={() => setSourceSlug(s.slug)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active ? "border-accent bg-accent-soft ring-[3px] ring-accent/15" : "border-border bg-card hover:border-accent/40 hover:bg-bg"
                        }`}
                      >
                        <div className={`text-[13px] font-semibold ${active ? "text-accent" : "text-ink"}`}>{s.name}</div>
                        <div className="hint m-0">{s.channel}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="hint mt-2">
                  The source is stored on every imported lead and drives column auto-detection (e.g. a Meta export&apos;s <code>full_name</code>
                  / <code>phone_number</code>).
                </div>
              </div>
            </div>

            {/* 2. File */}
            <div className="panel">
              <div className="panel-header">
                <h2>2 · Upload the file</h2>
                <span className="hint">.csv, .xlsx, .xls · up to 5,000 rows</span>
              </div>
              <div className="p-5">
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                    dragOver ? "border-accent bg-accent/5" : file ? "border-success/40 bg-success/5" : "border-border bg-bg hover:border-accent/40"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleFileInput} />
                  <div className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${file ? "bg-success/10 text-success" : "bg-accent-soft text-accent"}`}>
                    <UploadIcon width={26} height={26} />
                  </div>
                  {file ? (
                    <>
                      <strong className="text-[15px]">{file.name}</strong>
                      <span className="mt-1 hint">{(file.size / 1024).toFixed(1)} KB · click to choose a different file</span>
                    </>
                  ) : (
                    <>
                      <strong className="text-[15px]">Drag &amp; drop your export here</strong>
                      <span className="mt-1 hint">or click to browse</span>
                    </>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button className="btn" onClick={handleUploadAndPreview} disabled={!file || !companyId || !sourceSlug || parsing}>
                    {parsing ? "Reading file…" : "Continue → Map columns"}
                  </button>
                  {file && !parsing && (
                    <button className="btn-sm" onClick={() => setFile(null)}>
                      Clear file
                    </button>
                  )}
                  {!sourceSlug && <span className="hint">Pick a lead source first.</span>}
                  {sourceSlug && !file && <span className="hint">Now add the file.</span>}
                </div>
                {errorMessage && <div className="mt-3 save-msg err">{errorMessage}</div>}
              </div>
            </div>
          </div>

          {/* Side: how it works */}
          <div className="flex flex-col gap-5">
            <div className="panel p-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold">How it works</h3>
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {[
                  ["Map columns", "We auto-detect which column is the name, phone, email, model, campaign… you can adjust before anything is saved."],
                  ["Preview", "Row counts — valid, missing contact, likely repeats — plus the first rows exactly as they will be imported."],
                  ["Import", "Uploads in 500-row chunks with live progress. Repeat enquiries fold into the existing lead; new leads are auto-assigned to agents."],
                  ["Undo", "Every import is a batch. Revoke removes the leads it created if the wrong file or mapping was used."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{i + 1}</span>
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{t}</div>
                      <div className="hint m-0">{d}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="panel p-5">
              <h3 className="m-0 mb-2 text-[15px] font-bold">Tips</h3>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 hint">
                <li>Keep the header row — column names are how auto-detection works.</li>
                <li>Rows without a phone <em>and</em> email are skipped; everything else is kept, including unmapped columns.</li>
                <li>Per-source column overrides live in Companies → Sources.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {step === "mapping" && parseResult && (
        <div className="panel">
          <div className="panel-header flex-wrap gap-2">
            <h2>
              Map columns <span className="hint">— {selectedSource?.name} · {file?.name}</span>
            </h2>
            <span className="hint">
              {parseResult.headers.length} columns · {Object.values(mapping).filter(Boolean).length} mapped
            </span>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {parseResult.crmFields.map((field) => {
                const value = mapping[field.key] || "";
                const auto = value && autoMapped[field.key] === value;
                return (
                  <div key={field.key} className={`rounded-xl border p-3 ${value ? "border-border bg-card" : "border-dashed border-border bg-bg"}`}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink">{field.label}</span>
                      {value ? (
                        <span className={`pill ${auto ? "bg-success/10 text-success" : "bg-accent-soft text-accent"}`}>{auto ? "auto-detected" : "manual"}</span>
                      ) : (
                        <span className="pill bg-bg text-muted">not mapped</span>
                      )}
                    </div>
                    <select value={value} onChange={(e) => handleMappingChange(field.key, e.target.value)} className="w-full">
                      <option value="">— Not mapped —</option>
                      {parseResult.headers.map((h) => (
                        <option key={h} value={h} disabled={mappedHeaders.has(h) && value !== h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {parseResult.unmappedColumns.filter((h) => !mappedHeaders.has(h)).length > 0 && (
              <div className="mt-5">
                <div className="text-[13px] font-semibold text-ink">Columns kept as raw data</div>
                <div className="hint mt-0.5 mb-2">Not shown as CRM fields, but saved on each lead and visible under its details.</div>
                <div className="flex flex-wrap gap-1.5">
                  {parseResult.unmappedColumns
                    .filter((h) => !mappedHeaders.has(h))
                    .map((h) => (
                      <span key={h} className="pill bg-bg text-muted">
                        {h}
                      </span>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn" onClick={handleContinueToPreview} disabled={parsing}>
                {parsing ? "Checking…" : "Continue → Preview"}
              </button>
              <button className="btn-sm" onClick={resetToUpload}>
                Back
              </button>
            </div>
            {errorMessage && <div className="mt-3 save-msg err">{errorMessage}</div>}
          </div>
        </div>
      )}

      {step === "preview" && parseResult && (
        <div className="panel">
          <div className="panel-header flex-wrap gap-2">
            <h2>
              Preview <span className="hint">— {selectedSource?.name} → {selectedCompany?.name}</span>
            </h2>
            <span className="hint">Nothing is saved until you click Import.</span>
          </div>
          <div className="p-5">
            <div className="dash-stat-grid">
              {[
                ["Rows in file", parseResult.counts.totalRows, "rgb(var(--accent-rgb))", "excluding the header"],
                ["Will import", parseResult.counts.validLeads, "#1baf7a", "have a phone or email"],
                ["Skipped", parseResult.counts.missingContact, "#94a3b8", "no phone and no email"],
                ["Likely repeats", parseResult.counts.duplicates, "#eda100", "same customer + model already in CRM — merged, not duplicated"],
              ].map(([label, value, accent, caption]) => (
                <div className="dash-card" key={label} style={{ "--dash-accent": accent }}>
                  <div className="label">{label}</div>
                  <div className="value">{Number(value).toLocaleString()}</div>
                  <div className="dash-card-caption">{caption}</div>
                </div>
              ))}
            </div>

            <div className="table-scroll rounded-xl border border-border">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Model</th>
                    <th>Campaign</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.preview.map((row, i) => (
                    <tr key={i}>
                      <td>{row.name || "-"}</td>
                      <td>{row.phone || "-"}</td>
                      <td className="text-muted">{row.email || "-"}</td>
                      <td>{row.model || "-"}</td>
                      <td className="text-muted">{row.campaign || "-"}</td>
                      <td>
                        <span className={`pill ${row.status === "Valid" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 hint">
              First {parseResult.preview.length} of {parseResult.counts.totalRows.toLocaleString()} rows.
            </p>

            {importing && importProgress && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[12px] font-semibold">
                  <span>Importing…</span>
                  <span>
                    {importProgress.done.toLocaleString()} / {importProgress.total.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-bg">
                  <div className="h-2 rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }} />
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn" onClick={handleImport} disabled={importing || parseResult.counts.validLeads === 0}>
                {importing ? "Importing…" : `Import ${parseResult.counts.validLeads.toLocaleString()} leads into ${selectedCompany?.name || "company"}`}
              </button>
              <button className="btn-sm" onClick={() => setStep("mapping")} disabled={importing}>
                Back to mapping
              </button>
              <button className="btn-sm" onClick={resetToUpload} disabled={importing}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="panel">
          <div className="p-6">
            {result.type === "err" ? (
              <>
                <div className="mb-1 text-[17px] font-bold text-danger">Import failed</div>
                <div className="save-msg err m-0">{result.message}</div>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success/10 text-success text-xl font-bold">✓</div>
                  <div>
                    <div className="text-[17px] font-bold text-ink">Import complete</div>
                    <div className="hint m-0">
                      {result.data.created.toLocaleString()} new lead{result.data.created === 1 ? "" : "s"} added to {selectedCompany?.name} from {file?.name}
                    </div>
                  </div>
                </div>
                <div className="dash-stat-grid">
                  {[
                    ["Rows processed", result.data.totalRows, "rgb(var(--accent-rgb))", ""],
                    ["Created", result.data.created, "#1baf7a", "new leads, auto-assigned"],
                    ["Merged", result.data.duplicate, "#eda100", "repeat enquiries on existing leads"],
                    ["Skipped", result.data.skipped, "#94a3b8", "no phone and no email"],
                  ].map(([label, value, accent, caption]) => (
                    <div className="dash-card" key={label} style={{ "--dash-accent": accent }}>
                      <div className="label">{label}</div>
                      <div className="value">{Number(value).toLocaleString()}</div>
                      {caption && <div className="dash-card-caption">{caption}</div>}
                    </div>
                  ))}
                </div>
                {result.data.errors?.length > 0 && (
                  <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
                    <strong className="text-danger">{result.data.errorCount} row error(s)</strong>
                    <ul className="mt-1 mb-0 list-disc pl-5 hint">
                      {result.data.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button className="btn" onClick={resetToUpload}>
                Import another file
              </button>
              {result.type === "ok" && (
                <a className="btn-sm" href="/leads">
                  View leads
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="panel mt-6">
        <div className="panel-header flex-wrap gap-2">
          <h2>
            Import history <span className="hint">— {selectedCompany?.name || "company"}</span>
          </h2>
          <span className="hint">Revoke deletes the leads an import created (repeat-enquiry merges are left untouched).</span>
        </div>
        {historyLoading ? (
          <div className="p-5 hint">Loading…</div>
        ) : history.length === 0 ? (
          <div className="empty-state">No imports yet for this company.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>File</th>
                  <th>Created</th>
                  <th>Merged</th>
                  <th>Skipped</th>
                  <th>By</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b._id} className={b.revoked ? "opacity-60" : ""}>
                    <td className="text-muted">{new Date(b.createdAt).toLocaleString()}</td>
                    <td>
                      <span className="pill bg-accent-soft text-accent">{b.sourceName}</span>
                    </td>
                    <td className="text-muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }} title={b.filename}>
                      {b.filename || "-"}
                    </td>
                    <td className="font-semibold">{b.created}</td>
                    <td>{b.duplicate}</td>
                    <td className="text-muted">{b.skipped}</td>
                    <td className="text-muted">{b.importedBy || "-"}</td>
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
                            {revokingId === b._id ? "Revoking…" : revokeArmedId === b._id ? `Confirm — delete ${b.created}?` : "Revoke"}
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
          </div>
        )}
      </div>
    </Layout>
  );
}
