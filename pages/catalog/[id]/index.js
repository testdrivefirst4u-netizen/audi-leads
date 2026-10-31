import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Skeleton from "react-loading-skeleton";
import Layout from "../../../components/Layout";
import { CarIcon, ChevronLeftIcon, WhatsAppIcon } from "../../../components/icons";
import { useToast } from "../../../components/ToastProvider";
import { apiFetch } from "../../../lib/apiFetch";
import { catalogViewProps } from "../../../lib/catalogPageProps";
import { fileKindLabel, formatBytes, formatPrice, formatPriceShort, startingPrice } from "../../../lib/catalog";

export const getServerSideProps = catalogViewProps;

// Rows of the variant comparison; a row is hidden when no variant fills it.
const SPEC_ROWS = [
  ["Ex-showroom", (v) => formatPrice(v.exShowroomPrice), (v) => v.exShowroomPrice != null],
  ["On-road", (v) => formatPrice(v.onRoadPrice), (v) => v.onRoadPrice != null],
  ["Fuel", (v, m) => v.fuel || m.fuel],
  ["Transmission", (v) => v.transmission],
  ["Engine", (v) => v.engine],
  ["Power", (v) => v.power],
  ["Torque", (v) => v.torque],
  ["Mileage", (v) => v.mileage],
  ["Seats", (v) => v.seats],
];

function copyText(text, toast, what) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast(`${what} copied`))
    .catch(() => toast("Couldn't copy — long-press the link instead", { type: "err" }));
}

export default function CatalogModelPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const toast = useToast();
  const { id, companyId } = router.query;
  const companyQuery = role === "super_admin" && companyId ? `?companyId=${companyId}` : "";
  const [model, setModel] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState([]); // variant ids chosen for comparison; empty = all

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/catalog/${id}${companyQuery}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Couldn't load this model");
        setModel(data.model);
        setCanEdit(Boolean(data.canEdit));
      })
      .catch((err) => setError(err.message));
  }, [id, companyQuery]);

  const variants = model?.variants || [];
  const compared = picked.length ? variants.filter((v) => picked.includes(v._id)) : variants;
  const rows = useMemo(() => SPEC_ROWS.filter(([, get, has]) => compared.some((v) => (has ? has(v) : get(v, model || {})))), [compared, model]);
  const togglePick = (vid) => setPicked((p) => (p.includes(vid) ? p.filter((x) => x !== vid) : [...p, vid]));

  const layoutProps = { username, role, companyName, companyLogoUrl, companyBrandColor };

  if (error) {
    return (
      <Layout {...layoutProps}>
        <div className="panel px-6 py-14 text-center">
          <p className="m-0 mb-3 text-[15px] font-semibold">{error}</p>
          <Link href={`/catalog${companyQuery}`} className="btn-sm no-underline">
            Back to models
          </Link>
        </div>
      </Layout>
    );
  }

  if (!model) {
    return (
      <Layout {...layoutProps}>
        <Skeleton height={36} width={200} className="mb-5" />
        <Skeleton height={300} borderRadius={12} className="mb-5" />
        <Skeleton height={240} borderRadius={12} />
      </Layout>
    );
  }

  const fromEx = startingPrice(model, "exShowroomPrice");
  const fromOnRoad = startingPrice(model, "onRoadPrice");
  const brochures = model.files || [];

  return (
    <Layout {...layoutProps}>
      <Link href={`/catalog${companyQuery}`} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted no-underline hover:text-ink">
        <ChevronLeftIcon width={14} height={14} /> All models
      </Link>

      <section className="panel mb-5">
        <div className="grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex aspect-[16/10] items-center justify-center bg-bg md:aspect-auto md:min-h-[300px]">
            {model.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={model.imageUrl} alt={model.name} className="h-full w-full object-cover" />
            ) : (
              <CarIcon width={56} height={56} className="text-muted/50" />
            )}
          </div>
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="page-title mb-1">{model.name}</h1>
                {model.tagline && <p className="m-0 text-[15px] text-muted">{model.tagline}</p>}
              </div>
              {canEdit && (
                <Link href={`/catalog/${model._id}/edit${companyQuery}`} className="btn-sm no-underline">
                  Edit
                </Link>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!model.onSale && <span className="pill bg-ink text-white">Not on sale</span>}
              {model.bodyType && <span className="pill bg-bg text-muted">{model.bodyType}</span>}
              {model.fuel && <span className="pill bg-bg text-muted">{model.fuel}</span>}
              <span className="pill bg-bg text-muted">
                {variants.length} variant{variants.length === 1 ? "" : "s"}
              </span>
              {model.colours?.length > 0 && <span className="pill bg-bg text-muted">{model.colours.length} colours</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-bg p-4">
                <div className="text-[12px] text-muted">Ex-showroom from</div>
                <div className="mt-1 text-[22px] font-bold text-ink">{formatPriceShort(fromEx)}</div>
              </div>
              <div className="rounded-xl bg-bg p-4">
                <div className="text-[12px] text-muted">On-road from</div>
                <div className="mt-1 text-[22px] font-bold text-ink">{formatPriceShort(fromOnRoad)}</div>
              </div>
            </div>
            {model.description && <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-ink">{model.description}</p>}
            {model.aliases?.length > 0 && <p className="hint m-0">Leads may call it: {model.aliases.join(", ")}</p>}
          </div>
        </div>
      </section>

      <section className="panel mb-5">
        <div className="panel-header">
          <h2>Brochures &amp; files</h2>
        </div>
        <div className="p-5">
          {brochures.length === 0 ? (
            <p className="hint m-0">No brochure uploaded yet{canEdit ? " — add one from Edit." : "."}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {brochures.map((f) => (
                <div key={f._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                  <span className="pill bg-accent-soft text-accent">{fileKindLabel(f.kind)}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{f.title}</span>
                  <span className="text-[12px] text-muted">
                    {formatBytes(f.size)}
                    {f.uploadedAt ? ` · updated ${new Date(f.uploadedAt).toLocaleDateString()}` : ""}
                  </span>
                  <a href={f.url} target="_blank" rel="noreferrer" className="btn-sm no-underline">
                    Open
                  </a>
                  <button type="button" className="btn-sm" onClick={() => copyText(f.url, toast, "Link")}>
                    Copy link
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${model.name} — ${f.title}: ${f.url}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-sm inline-flex items-center gap-1.5 no-underline"
                  >
                    <WhatsAppIcon width={14} height={14} className="text-[#25d366]" /> Share
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel mb-5">
        <div className="panel-header flex-wrap gap-3">
          <h2>Compare variants</h2>
          {variants.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">Show:</span>
              {variants.map((v) => (
                <button
                  key={v._id}
                  type="button"
                  onClick={() => togglePick(v._id)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${picked.includes(v._id) ? "border-accent bg-accent text-white" : "border-border bg-card text-ink"}`}
                >
                  {v.name}
                </button>
              ))}
              {picked.length > 0 && (
                <button type="button" className="btn-sm" onClick={() => setPicked([])}>
                  Show all
                </button>
              )}
            </div>
          )}
        </div>
        {variants.length === 0 ? (
          <p className="hint m-0 p-5">No variants added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] bg-[#fafbfd]"></th>
                  {compared.map((v) => (
                    <th key={v._id} className="min-w-[180px] normal-case tracking-normal text-[13px] text-ink">
                      {v.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get]) => (
                  <tr key={label}>
                    <td className="sticky left-0 bg-card font-semibold text-muted">{label}</td>
                    {compared.map((v) => (
                      <td key={v._id} className={label === "Ex-showroom" || label === "On-road" ? "font-semibold" : ""}>
                        {get(v, model) || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                {compared.some((v) => v.features?.length) && (
                  <tr>
                    <td className="sticky left-0 bg-card align-top font-semibold text-muted">Key features</td>
                    {compared.map((v) => (
                      <td key={v._id} className="whitespace-normal align-top">
                        {v.features?.length ? (
                          <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
                            {v.features.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {model.colours?.length > 0 && (
        <section className="panel mb-5">
          <div className="panel-header">
            <h2>Colours</h2>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {model.colours.map((c) => (
              <div key={c._id} className="overflow-hidden rounded-xl border border-border">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt={c.name} className="aspect-[16/10] w-full object-cover" />
                ) : (
                  <div className="aspect-[16/10] w-full" style={{ background: c.hex || "#e5e8f0" }} />
                )}
                <div className="flex items-center gap-2 p-3 text-[13px] font-semibold">
                  <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ background: c.hex || "#e5e8f0" }} />
                  {c.name}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {model.updatedAt && (
        <p className="hint">
          Last updated {new Date(model.updatedAt).toLocaleDateString()}
          {model.updatedBy ? ` by ${model.updatedBy}` : ""}
        </p>
      )}
    </Layout>
  );
}
