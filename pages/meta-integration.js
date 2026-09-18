import { useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import MetaIntegrationPanel from "../components/MetaIntegrationPanel";
import { getSessionFromCookieHeader } from "../lib/auth";

// Meta Lead Ads settings — the "admin settings → Meta integration" page.
// A company admin manages their own company's connection; the super admin
// picks a company first (same CompanySwitcher pattern as Leads/Dashboard).
// Agents have no business here and are sent back to their leads.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Platform-level page: super admin only. Company admins and agents are
  // sent to their own dashboard.
  if (session.role !== "super_admin") return { redirect: { destination: "/", permanent: false } };
  return { props: { username: session.username, role: "super_admin" } };
}

export default function MetaIntegrationPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const router = useRouter();
  // After Facebook Login the callback sends the super admin back with the
  // company they were connecting, so the switcher lands on it again.
  const [viewCompanyId, setViewCompanyId] = useState(() => (typeof router.query.companyId === "string" ? router.query.companyId : ""));

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title mb-1">Meta Lead Ads</h1>
      <p className="hint mb-5">
        Facebook and Instagram lead forms delivered straight into this CRM — connect the Facebook Page, subscribe it to the leadgen webhook,
        and every new submission becomes a lead with the usual assignment, status and follow-ups.
      </p>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} editable />}

      {(!isSuperAdminView || viewCompanyId) && <MetaIntegrationPanel key={viewCompanyId || "own"} companyId={isSuperAdminView ? viewCompanyId : ""} />}
    </Layout>
  );
}
