import Layout from "../components/Layout";
import AgentsPanel from "../components/AgentsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Super admin gets a company-picker-driven view of this same page — they
  // can view any company's agents and (uniquely) create new ones, but can't
  // otherwise edit/deactivate a company's existing agents. Anyone who isn't
  // an admin or the super admin (i.e. an agent) is redirected away, same as before.
  if (session.role === "super_admin") {
    return { props: { username: session.username, role: "super_admin" } };
  }
  if (session.role && session.role !== "admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

export default function AgentsPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Agents</h1>
      <AgentsPanel role={role} />
    </Layout>
  );
}
