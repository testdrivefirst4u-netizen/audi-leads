import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/apiFetch";
import { loadCompanies } from "../../lib/viewCompany";
import { useToast } from "../ToastProvider";

/**
 * Super admin, Models page: copy a brand's line-up from one dealer's catalog
 * into the dealer being viewed (pages/api/catalog/copy.js) — enter Audi once,
 * use it for every Audi dealer. Preview first; the target keeps its own
 * on-road prices, city, offers and its own uploads. Copying again updates.
 */
export default function CopyFromDealer({ toCompanyId, onCopied }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [from, setFrom] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) loadCompanies().then(setCompanies);
  }, [open]);
  useEffect(() => setPreview(null), [from, toCompanyId]);

  async function run(apply) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/catalog/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromCompanyId: from, toCompanyId, apply }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Copy failed");
      if (apply) {
        toast(`Copied ${data.copied.length} model${data.copied.length === 1 ? "" : "s"} from ${data.from}`);
        setOpen(false);
        setPreview(null);
        onCopied?.();
      } else setPreview(data);
    } catch (err) {
      toast(err.message, { type: "err" });
    } finally {
      setBusy(false);
    }
  }

  if (!toCompanyId) return null;
  if (!open) {
    return (
      <button type="button" className="btn-sm" onClick={() => setOpen(true)}>
        Copy models from another dealer
      </button>
    );
  }
  const others = companies.filter((c) => String(c._id) !== String(toCompanyId));
  return (
    <section className="panel mb-5 p-5 w-full">
      <div className="flex flex-wrap items-end gap-3">
        <div className="field mb-0 min-w-[240px]">
          <label htmlFor="copy-from">Copy models from</label>
          <select id="copy-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Pick a dealer…</option>
            {others.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-sm" disabled={!from || busy} onClick={() => run(false)}>
          {busy && !preview ? "Checking…" : "Preview"}
        </button>
        <button type="button" className="btn-sm ml-auto" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="hint m-0 mt-3">
        Brings over models, variants, ex-showroom prices, specs, highlights, quick answers, colours, photos and brochures. This dealer keeps its own on-road prices, price city, offers, on-sale settings and anything it uploaded itself. Copying again updates the earlier copies.
      </p>
      {preview && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink">
            From <strong>{preview.from}</strong> into <strong>{preview.to}</strong>: {preview.plan.filter((p) => p.action === "create").length} new, {preview.plan.filter((p) => p.action === "update").length} updated.
          </div>
          <div className="table-scroll rounded-lg border border-border">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Action</th>
                  <th>Variants</th>
                  <th>Photos</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.map((p) => (
                  <tr key={p.name}>
                    <td className="font-semibold">{p.name}</td>
                    <td>
                      <span className={`pill ${p.action === "create" ? "bg-success/10 text-success" : "bg-accent-soft text-accent"}`}>{p.action === "create" ? "New" : "Update"}</span>
                    </td>
                    <td>{p.variants}</td>
                    <td>{p.photos}</td>
                    <td>{p.files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn" disabled={busy || !preview.plan.length} onClick={() => run(true)}>
              {busy ? "Copying…" : `Copy ${preview.plan.length} model${preview.plan.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
