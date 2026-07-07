import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import SettingsForm from "../components/SettingsForm";
import { getSessionFromCookieHeader } from "../lib/auth";
import { apiFetch } from "../lib/apiFetch";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  return { props: { username: session.username } };
}

export default function SettingsPage({ username }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    apiFetch("/api/settings")
      .then((res) => res.json())
      .then((data) => setSettings(data.settings));
  }, []);

  return (
    <Layout username={username}>
      <h1 className="page-title">Google Sheets Sync Settings</h1>
      {settings ? (
        <SettingsForm initial={settings} onSaved={setSettings} />
      ) : (
        <div className="hint">Loading...</div>
      )}
    </Layout>
  );
}
