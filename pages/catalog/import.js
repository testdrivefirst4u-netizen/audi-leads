import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import { ChevronLeftIcon } from "../../components/icons";
import { useToast } from "../../components/ToastProvider";
import { apiFetch } from "../../lib/apiFetch";
import { catalogEditProps } from "../../lib/catalogPageProps";

export const getServerSideProps = catalogEditProps;

// The template's sheets, with one example row each (the same columns
// lib/catalogImport.js reads; example rows are marked so nobody imports them by accident).
const TEMPLATE = {
  Models: [{ Model: "Q5 (example)", Tagline: "The everyday SUV", "Body type": "SUV", Fuel: "Petrol", Description: "", Highlights: "quattro all-wheel drive | Virtual cockpit plus", Aliases: "Audi Q5", Offers: "" }],
  Variants: [
    { Model: "Q5 (example)", Variant: "Premium Plus", "Ex-showroom price": 6500000, "On-road price": 7800000, "Price city": "Hyderabad", "Price date": "2026-11-01", Fuel: "", Transmission: "Automatic", Engine: "2.0 TFSI", Power: "", Torque: "", Mileage: "", Seats: "5", Features: "Panoramic sunroof | 3-zone climate" },
  ],
  Specs: [{ Model: "Q5 (example)", Variant: "", Group: "Dimensions", Name: "Boot space", Value: "520 litres" }],
  Colours: [{ Model: "Q5 (example)", Colour: "Navarra Blue", Hex: "#1f3a6b" }],
  "Quick answers": [{ Model: "Q5 (example)", Question: "What is the warranty?", Answer: "2 years, unlimited km" }],
};

export default function CatalogImportPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const toast = useToast();
  const isSuperAdmin = role === "super_admin";
  const companyId = router.query.companyId;
  const companyQuery = isSuperAdmin && companyId ? `?companyId=${companyId}` : "";
  const needsCompany = isSuperAdmin && router.isReady && !companyId;
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(TEMPLATE)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    XLSX.writeFile(wb, "models-import-template.xlsx");
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setPreview(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const read = {};
      for (const name of wb.SheetNames) {
        // drop the template's example rows
        read[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }).filter((r) => !String(r.Model || r.model || "").includes("(example)"));
      }
      setFileName(file.name);
      setSheets(read);
      const res = await apiFetch(`/api/catalog/import${companyQuery}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheets: read, apply: false }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't read the spreadsheet");
      setPreview(data);
    } catch (err) {
      toast(err.message || "Couldn't read that file. Use the template's .xlsx format.", { type: "err" });
      setSheets(null);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/catalog/import${companyQuery}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheets, apply: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast(`Imported ${data.plan.length} model${data.plan.length === 1 ? "" : "s"}`);
      router.push(`/catalog${companyQuery}`);
    } catch (err) {
      toast(err.message, { type: "err" });
      setBusy(false);
    }
  }

  const hasErrors = preview?.plan?.some((p) => p.errors.length);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <Link href={`/catalog${companyQuery}`} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted no-underline hover:text-ink">
        <ChevronLeftIcon width={14} height={14} /> All models
      </Link>
      <h1 className="page-title mb-1">Import models from a spreadsheet</h1>
      <p className="hint mb-5">Load a whole line-up, or a new price list, in one go. Matching models and variants are updated, not duplicated. Photos and brochures are added in each model's editor afterwards.</p>

      {needsCompany ? (
        <div className="panel px-6 py-10 text-center">
          <p className="m-0 mb-3 text-[15px] font-semibold">Pick a company first</p>
          <p className="hint m-0">Choose the company in the top bar, then come back to Import.</p>
        </div>
      ) : (
        <>
          <section className="panel mb-5 p-5">
            <ol className="m-0 pl-5 flex flex-col gap-3 text-[14px]">
              <li>
                <span className="font-semibold">Download the template</span> and fill its sheets: Models, Variants, Specs, Colours and Quick answers. Leave a sheet empty if you have nothing for it.
                <div className="mt-2">
                  <button type="button" className="btn-sm" onClick={downloadTemplate}>
                    Download template (.xlsx)
                  </button>
                </div>
              </li>
              <li>
                <span className="font-semibold">Upload the filled spreadsheet.</span> You'll see what changes before anything is saved.
                <div className="mt-2 flex items-center gap-3">
                  <label className={`btn inline-flex cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
                    {busy && !preview ? "Reading…" : "Choose spreadsheet"}
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPick} />
                  </label>
                  {fileName && <span className="text-[13px] text-muted">{fileName}</span>}
                </div>
              </li>
            </ol>
          </section>

          {preview && (
            <section className="panel mb-5">
              <div className="panel-header">
                <div>
                  <h2>Preview</h2>
                  <p className="hint m-0 mt-1">
                    {preview.plan.filter((p) => p.action === "create").length} new · {preview.plan.filter((p) => p.action === "update").length} updated. Nothing is saved until you apply.
                  </p>
                </div>
                <button type="button" className="btn" onClick={apply} disabled={busy || hasErrors || !preview.plan.length}>
                  {busy ? "Importing…" : "Apply import"}
                </button>
              </div>
              {preview.warnings?.length > 0 && (
                <div className="mx-5 mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-ink">
                  {preview.warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              )}
              {!preview.plan.length && <p className="m-0 p-5 text-[13px] text-muted">No models found in the spreadsheet.</p>}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Action</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.plan.map((p) => (
                      <tr key={p.name}>
                        <td className="font-semibold">{p.name}</td>
                        <td>
                          <span className={`pill ${p.action === "create" ? "bg-success/10 text-success" : "bg-accent-soft text-accent"}`}>{p.action === "create" ? "New" : "Update"}</span>
                        </td>
                        <td className="whitespace-normal">
                          {p.errors.length ? <span className="font-semibold text-danger">{p.errors.join(" · ")}</span> : p.changes.join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </Layout>
  );
}
