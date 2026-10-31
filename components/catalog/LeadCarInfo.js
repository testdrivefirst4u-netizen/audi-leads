import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/apiFetch";
import {
  fileKindLabel,
  formatPrice,
  formatPriceShort,
  isPriceStale,
  matchCatalogModel,
  startingPrice,
} from "../../lib/catalog";
import CarExtras from "./CarExtras";
import { WhatsAppIcon } from "../icons";
import { waHref } from "../../lib/phone";

// One fetch of the catalog per company per page load — the lead modal opens
// and closes often, the catalog rarely changes.
const cache = new Map();
function loadCatalog(companyId) {
  const key = companyId || "";
  if (!cache.has(key)) {
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
    cache.set(
      key,
      apiFetch(`/api/catalog${q}`)
        .then((r) => (r.ok ? r.json() : { models: [] }))
        .then((d) => d.models || [])
        .catch(() => {
          cache.delete(key);
          return [];
        }),
    );
  }
  return cache.get(key);
}

function firstName(name) {
  return (
    String(name || "")
      .trim()
      .split(/\s+/)[0] || "there"
  );
}

// Rows of the two-variant comparison; a row shows only when either variant fills it.
const COMPARE_ROWS = [
  ["Ex-showroom", (v) => (v.exShowroomPrice != null ? formatPrice(v.exShowroomPrice) : "")],
  ["On-road", (v) => (v.onRoadPrice != null ? formatPrice(v.onRoadPrice) : "")],
  ["Fuel", (v, m) => v.fuel || m.fuel],
  ["Transmission", (v) => v.transmission],
  ["Engine", (v) => v.engine],
  ["Power", (v) => v.power],
  ["Torque", (v) => v.torque],
  ["Mileage", (v) => v.mileage],
  ["Seats", (v) => v.seats],
];

// "What's the difference between Premium Plus and Technology?" — two
// variants side by side, plus the features only one of them has.
function CompareVariants({ model }) {
  const variants = model.variants || [];
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.min(1, variants.length - 1));
  if (variants.length < 2) return null;
  const va = variants[a] || variants[0];
  const vb = variants[b] || variants[1];
  const rows = COMPARE_ROWS.map(([label, get]) => [label, get(va, model) || "", get(vb, model) || ""]).filter(([, x, y]) => x || y);
  const fa = new Set(va.features || []);
  const fb = new Set(vb.features || []);
  const onlyA = [...fa].filter((f) => !fb.has(f));
  const onlyB = [...fb].filter((f) => !fa.has(f));
  const pick = (value, set, label) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} aria-label={label} className="w-full min-w-0 rounded-lg border border-border bg-bg px-2 py-1.5 text-[12.5px] font-semibold text-ink">
      {variants.map((v, i) => (
        <option key={v._id || i} value={i}>
          {v.name}
        </option>
      ))}
    </select>
  );
  return (
    <section>
      <h3 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Compare variants</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="!text-[12.5px] min-w-[360px]">
          <thead>
            <tr>
              <th className="!static !px-3 !py-2 w-[28%]"></th>
              <th className="!static !px-2 !py-2 normal-case">{pick(a, setA, "First variant")}</th>
              <th className="!static !px-2 !py-2 normal-case">{pick(b, setB, "Second variant")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, x, y]) => (
              <tr key={label}>
                <td className="!px-3 !py-1.5 text-muted">{label}</td>
                <td className={`!px-3 !py-1.5 whitespace-normal ${x !== y ? "font-semibold" : ""}`}>{x || "—"}</td>
                <td className={`!px-3 !py-1.5 whitespace-normal ${x !== y ? "font-semibold" : ""}`}>{y || "—"}</td>
              </tr>
            ))}
            {(onlyA.length > 0 || onlyB.length > 0) && (
              <tr>
                <td className="!px-3 !py-1.5 text-muted align-top">Only in this one</td>
                <td className="!px-3 !py-1.5 whitespace-normal align-top">{onlyA.join(", ") || "—"}</td>
                <td className="!px-3 !py-1.5 whitespace-normal align-top">{onlyB.join(", ") || "—"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// The Car panel in a lead's window: the catalog entry for the lead's model —
// prices per variant (each one tap to send on WhatsApp, with its date), a
// two-variant comparison, brochures to share, then photos, highlights, specs
// and quick answers (CarExtras). Renders nothing (not even its heading) until
// a matching model is found.
export default function LeadCarInfo({ lead, companyId, readOnly }) {
  const [model, setModel] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    loadCatalog(companyId).then(
      (models) =>
        !cancelled &&
        setModel(matchCatalogModel(models, lead.canonicalModel, lead.model)),
    );
    return () => {
      cancelled = true;
    };
  }, [companyId, lead.canonicalModel, lead.model]);

  if (!model) return null;

  const companyQuery = companyId
    ? `?companyId=${encodeURIComponent(companyId)}`
    : "";
  const fromEx = startingPrice(model, "exShowroomPrice");
  const fromOnRoad = startingPrice(model, "onRoadPrice");
  const phone = String(lead.phone || "").replace(/\D/g, "");

  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-2.5 rounded-md bg-accent-soft px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-accent">
        Car · {model.name}
      </div>
      <div className="rounded-lg border border-border p-3.5">
        <div className="flex items-center gap-3">
          {model.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={model.imageUrl}
              alt=""
              className="h-14 w-20 shrink-0 rounded-md object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-ink">{model.name}</div>
            <div className="text-[12.5px] text-muted">
              {[
                model.bodyType,
                model.fuel,
                `${model.variants?.length || 0} variants`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Link
            href={`/catalog/${model._id}${companyQuery}`}
            target="_blank"
            className="btn-sm shrink-0 no-underline"
          >
            Full details
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 text-[13px]">
          <div className="rounded-md bg-bg px-3 py-2">
            <div className="text-[11px] text-muted">Ex-showroom from</div>
            <div className="font-bold">{formatPriceShort(fromEx)}</div>
          </div>
          <div className="rounded-md bg-bg px-3 py-2">
            <div className="text-[11px] text-muted">On-road from</div>
            <div className="font-bold">{formatPriceShort(fromOnRoad)}</div>
          </div>
        </div>

        {model.variants?.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            {model.variants.map((v) => (
              <div key={v._id || v.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 flex-1 font-semibold text-ink">{v.name}</span>
                <span className="text-muted">Ex {formatPriceShort(v.exShowroomPrice)}</span>
                <span className="font-semibold text-ink">On-road {formatPriceShort(v.onRoadPrice)}</span>
                {!readOnly && phone && (v.onRoadPrice || v.exShowroomPrice) && (
                  <a
                    href={waHref(
                      phone,
                      `Hi ${firstName(lead.name)}, the ${model.name} ${v.name} is ${v.onRoadPrice ? `${formatPrice(v.onRoadPrice)} on-road` : `${formatPrice(v.exShowroomPrice)} ex-showroom`}${model.priceCity ? ` in ${model.priceCity}` : ""}. Happy to arrange a test drive.`
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-sm inline-flex items-center gap-1 no-underline"
                    title={isPriceStale(model) ? "This price may be out of date: check with sales first" : "Opens WhatsApp with this price"}
                  >
                    <WhatsAppIcon width={13} height={13} className="text-[#25d366]" /> Send price
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <CompareVariants model={model} />
        </div>

        {model.files?.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {model.files.map((f) => (
              <div
                key={f._id}
                className="flex flex-wrap items-center gap-2 text-[13px]"
              >
                <span className="pill bg-accent-soft text-accent">
                  {fileKindLabel(f.kind)}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-sm no-underline"
                >
                  Open
                </a>
                {!readOnly && phone && (
                  <a
                    href={waHref(phone, `Hi ${firstName(lead.name)}, here is the ${model.name} ${fileKindLabel(f.kind).toLowerCase()}: ${f.url}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-sm inline-flex items-center gap-1.5 no-underline"
                    title={`Opens WhatsApp with a message to ${lead.name || "the customer"}`}
                  >
                    <WhatsAppIcon
                      width={14}
                      height={14}
                      className="text-[#25d366]"
                    />{" "}
                    Send
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <CarExtras model={model} compact />
        </div>
      </div>
    </section>
  );
}
