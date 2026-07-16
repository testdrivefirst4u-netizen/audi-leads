import Layout from "../components/Layout";
import CompaniesPanel from "../components/CompaniesPanel";
import StoragePanel from "../components/StoragePanel";
import { getSessionFromCookieHeader } from "../lib/auth";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role !== "super_admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: { username: session.username } };
}

export default function CompaniesPage({ username }) {
  return (
    <Layout username={username} role="super_admin">
      <h1 className="page-title">Companies</h1>
      <StoragePanel />
      <CompaniesPanel />
    </Layout>
  );
}
