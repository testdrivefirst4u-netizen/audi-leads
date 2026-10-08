import Link from "next/link";
import Layout from "../../components/Layout";
import CatalogEditor from "../../components/catalog/CatalogEditor";
import { ChevronLeftIcon } from "../../components/icons";
import { catalogEditProps } from "../../lib/catalogPageProps";

export const getServerSideProps = catalogEditProps;

export default function NewCatalogModelPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <Link href="/catalog" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted no-underline hover:text-ink">
        <ChevronLeftIcon width={14} height={14} /> All models
      </Link>
      <h1 className="page-title">Add a model</h1>
      <CatalogEditor model={null} />
    </Layout>
  );
}
