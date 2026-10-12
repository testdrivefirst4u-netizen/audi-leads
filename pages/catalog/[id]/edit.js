import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Skeleton from "react-loading-skeleton";
import Layout from "../../../components/Layout";
import CatalogEditor from "../../../components/catalog/CatalogEditor";
import { ChevronLeftIcon } from "../../../components/icons";
import { apiFetch } from "../../../lib/apiFetch";
import { catalogEditProps } from "../../../lib/catalogPageProps";

export const getServerSideProps = catalogEditProps;

export default function EditCatalogModelPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  const { id, companyId } = router.query;
  // Set when the super admin edits the company picked in the switcher.
  const companyQuery = role === "super_admin" && companyId ? `?companyId=${companyId}` : "";
  const [model, setModel] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/catalog/${id}${companyQuery}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Couldn't load this model");
        setModel(data.model);
      })
      .catch((err) => setError(err.message));
  }, [id, companyQuery]);

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <Link href={`/catalog/${id || ""}${companyQuery}`} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted no-underline hover:text-ink">
        <ChevronLeftIcon width={14} height={14} /> Back to {model?.name || "model"}
      </Link>
      <h1 className="page-title">{model ? `Edit ${model.name}` : "Edit model"}</h1>
      {error ? <div className="empty-state">{error}</div> : model ? <CatalogEditor key={model._id} model={model} companyQuery={companyQuery} /> : <Skeleton height={420} borderRadius={12} />}
    </Layout>
  );
}
