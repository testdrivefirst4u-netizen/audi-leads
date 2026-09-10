import { useState } from "react";
import Link from "next/link";
import { FireIcon, CloseIcon } from "./icons";
import { isBannerDismissedToday, dismissBannerToday } from "../lib/dashboardBanners";

const BANNER_ID = "hot-leads";

export default function HotLeadsCard({ count }) {
  const [dismissed, setDismissed] = useState(() => isBannerDismissedToday(BANNER_ID));
  if (dismissed || !count) return null;

  function handleDismiss(e) {
    e.preventDefault();
    e.stopPropagation();
    dismissBannerToday(BANNER_ID);
    setDismissed(true);
  }

  return (
    <Link href="/leads?hot=true" className="hot-leads-banner">
      <FireIcon />
      <span>
        <strong>{count}</strong> hot lead{count > 1 ? "s" : ""} — urgent buyers nobody's contacted yet. Click to view.
      </span>
      <button type="button" className="banner-dismiss" onClick={handleDismiss} title="Dismiss for today" aria-label="Dismiss for today">
        <CloseIcon width={13} height={13} />
      </button>
    </Link>
  );
}
