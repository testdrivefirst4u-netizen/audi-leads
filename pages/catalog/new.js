import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import CatalogEditor from "../../components/catalog/CatalogEditor";
import { ChevronLeftIcon } from "../../components/icons";
import { catalogEditProps } from "../../lib/catalogPageProps";

export const getServerSideProps = catalogEditProps;

export default function NewCatalogModelPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const router = useRouter();
  // The super admin adds a model to the company picked in the switcher on the
  // Models page, which passes it along as ?companyId=.
  const isSuperAdmin = role === "super_admin";
  const companyId = router.query.companyId;
  const companyQuery = isSuperAdmin && companyId ? `?companyId=${companyId}` : "";
  const needsCompany = isSuperAdmin && router.isReady && !companyId;

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <Link href={`/catalog${companyQuery}`} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-muted no-underline hover:text-ink">
        <ChevronLeftIcon width={14} height={14} /> All models
      </Link>
      <h1 className="page-title">Add a model</h1>
      {needsCompany ? (
        <div className="panel px-6 py-10 text-center">
          <p className="m-0 mb-3 text-[15px] font-semibold">Pick a company first</p>
          <p className="hint m-0 mb-4">Choose the company on the Models page, then click Add model.</p>
          <Link href="/catalog" className="btn no-underline">
            Go to Models
          </Link>
        </div>
      ) : (
        (!isSuperAdmin || companyId) && <CatalogEditor model={null} companyQuery={companyQuery} />
      )}
    </Layout>
  );
}
