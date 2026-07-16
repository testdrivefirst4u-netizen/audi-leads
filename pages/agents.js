import Layout from "../components/Layout";
import AgentsPanel from "../components/AgentsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role && session.role !== "admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, ...branding } };
}

export default function AgentsPage({ username, companyName, companyLogoUrl, companyBrandColor }) {
  return (
    <Layout username={username} role="admin" companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Agents</h1>
      <AgentsPanel />
    </Layout>
  );
}
