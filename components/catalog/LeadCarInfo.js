import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/apiFetch";
import {
  fileKindLabel,
  formatPriceShort,
  matchCatalogModel,
  startingPrice,
} from "../../lib/catalog";
import { WhatsAppIcon } from "../icons";

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

// "About this car" in the lead modal: the catalog entry for the lead's model,
// with prices and one-tap brochure sharing to the customer's WhatsApp.
// Renders nothing (not even its heading) until a matching model is found.
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
        About this car
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
                    href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hi ${firstName(lead.name)}, here is the ${model.name} ${fileKindLabel(f.kind).toLowerCase()}: ${f.url}`)}`}
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
      </div>
    </section>
  );
}
