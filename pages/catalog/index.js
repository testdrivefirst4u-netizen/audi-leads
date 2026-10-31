import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Skeleton from "react-loading-skeleton";
import Layout from "../../components/Layout";
import CompanySwitcher from "../../components/CompanySwitcher";
import CopyFromDealer from "../../components/catalog/CopyFromDealer";
import { CarIcon } from "../../components/icons";
import { apiFetch } from "../../lib/apiFetch";
import { catalogViewProps } from "../../lib/catalogPageProps";
import { formatPriceShort, startingPrice } from "../../lib/catalog";

export const getServerSideProps = catalogViewProps;

function ModelCard({ model, href }) {
  const from = startingPrice(model);
  const brochure = (model.files || []).some((f) => f.kind === "brochure");
  return (
    <Link href={href} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card no-underline shadow-card transition-shadow hover:shadow-card-hover">
      <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-bg">
        {model.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.imageUrl} alt={model.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <CarIcon width={40} height={40} className="text-muted/50" />
        )}
        {!model.onSale && <span className="pill absolute left-3 top-3 bg-ink/80 text-white">Not on sale</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[17px] font-bold text-ink">{model.name}</span>
          {from && <span className="text-[13px] font-semibold text-ink">from {formatPriceShort(from)}</span>}
        </div>
        {model.tagline && <span className="text-[13px] text-muted">{model.tagline}</span>}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {model.bodyType && <span className="pill bg-bg text-muted">{model.bodyType}</span>}
          {model.fuel && <span className="pill bg-bg text-muted">{model.fuel}</span>}
          <span className="pill bg-bg text-muted">
            {model.variants?.length || 0} variant{model.variants?.length === 1 ? "" : "s"}
          </span>
          {brochure && <span className="pill bg-accent-soft text-accent">Brochure</span>}
        </div>
      </div>
    </Link>
  );
}

export default function CatalogPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [models, setModels] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [reloadKey, setReloadKey] = useState(0); // bumped after a copy from another dealer
  const companyQuery = isSuperAdminView && viewCompanyId ? `?companyId=${viewCompanyId}` : "";

  useEffect(() => {
    if (isSuperAdminView && !viewCompanyId) return;
    setLoading(true);
    apiFetch(`/api/catalog${companyQuery}`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((data) => {
        setModels(data.models || []);
        setCanEdit(Boolean(data.canEdit));
      })
      .finally(() => setLoading(false));
  }, [isSuperAdminView, viewCompanyId, companyQuery, reloadKey]);

  const bodyTypes = useMemo(() => [...new Set(models.map((m) => m.bodyType).filter(Boolean))].sort(), [models]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (!bodyType || m.bodyType === bodyType) &&
        (!q || [m.name, m.tagline, m.bodyType, m.fuel, ...(m.aliases || []), ...(m.variants || []).map((v) => v.name)].some((s) => String(s || "").toLowerCase().includes(q)))
    );
  }, [models, query, bodyType]);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title mb-1">Models</h1>
          <p className="hint m-0">Every car we sell — variants, prices, colours and brochures.</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/catalog/import${companyQuery}`} className="btn-sm no-underline">
              Import from spreadsheet
            </Link>
            <Link href={`/catalog/new${companyQuery}`} className="btn no-underline">
              + Add model
            </Link>
          </div>
        )}
      </div>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} editable />}
      {isSuperAdminView && viewCompanyId && (
        <div className="mb-5 flex">
          <CopyFromDealer toCompanyId={viewCompanyId} onCopied={() => setReloadKey((n) => n + 1)} />
        </div>
      )}

      {(loading || models.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input className="search-input" placeholder="Search model, variant, fuel..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
          {bodyTypes.length > 1 &&
            ["", ...bodyTypes].map((b) => (
              <button
                key={b || "all"}
                type="button"
                onClick={() => setBodyType(b)}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                  bodyType === b ? "border-accent bg-accent text-white" : "border-border bg-card text-ink hover:border-accent/50"
                }`}
              >
                {b || "All"}
              </button>
            ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={280} borderRadius={12} />
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
          <CarIcon width={36} height={36} className="text-muted" />
          <h2 className="m-0 text-[17px] font-bold">No models yet</h2>
          <p className="hint m-0 max-w-[420px]">
            {canEdit
              ? "Add each car you sell with its variants, prices and brochure, so every agent — new ones especially — can look them up."
              : "Your admin hasn't added any models yet."}
          </p>
          {canEdit && (
            <Link href={`/catalog/new${companyQuery}`} className="btn mt-1 no-underline">
              + Add your first model
            </Link>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">No models match “{query}”.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => (
            <ModelCard key={m._id} model={m} href={`/catalog/${m._id}${companyQuery}`} />
          ))}
        </div>
      )}
    </Layout>
  );
}
