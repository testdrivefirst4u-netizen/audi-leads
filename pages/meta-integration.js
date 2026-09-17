import { useState } from "react";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import MetaIntegrationPanel from "../components/MetaIntegrationPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";

// Meta Lead Ads settings — the "admin settings → Meta integration" page.
// A company admin manages their own company's connection; the super admin
// picks a company first (same CompanySwitcher pattern as Leads/Dashboard).
// Agents have no business here and are sent back to their leads.
export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role === "agent") return { redirect: { destination: "/leads", permanent: false } };
  if (session.role === "super_admin") {
    return { props: { username: session.username, role: "super_admin" } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

export default function MetaIntegrationPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");

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
