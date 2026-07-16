import { useEffect, useState, useCallback } from "react";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import SyncStatusCard from "../components/SyncStatusCard";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";

const STATUS_POLL_MS = 5000;

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  if (session.role && session.role !== "admin") {
    return { redirect: { destination: "/", permanent: false } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, ...branding } };
}

export default function SettingsPage({ username, companyName, companyLogoUrl, companyBrandColor }) {
  const [syncStatus, setSyncStatus] = useState(null);

  const fetchSyncStatus = useCallback(async () => {
    const res = await apiFetch("/api/sync-status");
    if (res.ok) setSyncStatus(await res.json());
  }, []);

  useEffect(() => {
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchSyncStatus]);

  return (
    <Layout username={username} role="admin" companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Sync Status</h1>

      {syncStatus ? <SyncStatusCard status={syncStatus} /> : <Skeleton height={60} className="mb-5" />}

      <div className="hint mt-3">
        Your Google Sheet connection is configured and managed by the platform administrator. This page shows
        live sync status only.
      </div>
    </Layout>
  );
}
