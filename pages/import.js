import { useState, useRef, useEffect, useCallback } from "react";
import Layout from "../components/Layout";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";
import { useToast } from "../components/ToastProvider";
import { UploadIcon } from "../components/icons";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role !== "super_admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: { username: session.username } };
}

const RECOGNIZED_COLUMNS = [
  { field: "Name", aliases: "name, full_name, customer_name, customer" },
  { field: "Phone", aliases: "phone, mobile, phone_number, contact" },
  { field: "Email", aliases: "email, email_address" },
  { field: "Model", aliases: "model, vehicle, car_model, product" },
  { field: "Location", aliases: "location, showroom, city" },
  { field: "Message", aliases: "message, note, remarks, comment" },
  { field: "Created Date (optional)", aliases: "created_time, created date, date, enquiry date" },
];

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ImportLeadsPage({ username }) {
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
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

  function pickFile(f) {
    setResult(null);
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

  async function handleUpload() {
    if (!file || !companyId) return;
    setUploading(true);
    setResult(null);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await apiFetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64, filename: file.name, companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult({ type: "ok", data });
      setFile(null);
      toast(`Imported ${data.created} new lead${data.created === 1 ? "" : "s"}`);
    } catch (err) {
      setResult({ type: "err", message: err.message });
      toast(err.message, { type: "err" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Layout username={username} role="super_admin">
      <h1 className="page-title">Import Leads</h1>
      <p className="hint mb-5">
        Upload a CSV or Excel file to bulk-add leads into any company. Every row runs through the same
        duplicate-detection and auto-assignment as Google Sheets sync — a customer who already has a lead for the
        same model gets merged as a repeat enquiry instead of duplicated.
      </p>

      <div className="rounded-xl border border-border bg-card px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
        <label className="toolbar-label m-0">Import into company</label>
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.length === 0 && <option value="">No companies yet</option>}
          {companies.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

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
            <button className="btn" onClick={handleUpload} disabled={!file || !companyId || uploading}>
              {uploading ? "Importing..." : "Upload & Import"}
            </button>
            {file && !uploading && (
              <button className="btn-sm" onClick={() => setFile(null)}>
                Clear
              </button>
            )}
          </div>

          {result && (
            <div className="panel mt-4" style={{ padding: 20 }}>
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
            </div>
          )}
        </div>

        <div className="panel" style={{ padding: 20, height: "fit-content" }}>
          <h3 className="mb-3">Recognized Columns</h3>
          <p className="hint mb-3">
            Column names are matched automatically (case-insensitive). Each row needs at least a phone or an
            email to be imported.
          </p>
          <table>
            <tbody>
              {RECOGNIZED_COLUMNS.map((c) => (
                <tr key={c.field}>
                  <td className="font-semibold">{c.field}</td>
                  <td className="text-muted">{c.aliases}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint mt-3">
            Imported leads are tagged with source &quot;Bulk Upload&quot; — visible in that company&apos;s Leads
            Source filter and Dashboard Leads by Source chart.
          </div>
        </div>
      </div>
    </Layout>
  );
}
