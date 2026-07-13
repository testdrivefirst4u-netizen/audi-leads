import Layout from "../components/Layout";
import AgentsPanel from "../components/AgentsPanel";
import { getSessionFromCookieHeader } from "../lib/auth";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role && session.role !== "admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: { username: session.username } };
}

export default function AgentsPage({ username }) {
  return (
    <Layout username={username} role="admin">
      <h1 className="page-title">Agents</h1>
      <AgentsPanel />
    </Layout>
  );
}
