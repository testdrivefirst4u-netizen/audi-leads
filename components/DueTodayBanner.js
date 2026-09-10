import { useState } from "react";
import Link from "next/link";
import { bucketFollowUps } from "./FollowUpsCard";
import { CloseIcon } from "./icons";
import { isBannerDismissedToday, dismissBannerToday } from "../lib/dashboardBanners";

const BANNER_ID = "due-today";

export default function DueTodayBanner({ followUps }) {
  const [dismissed, setDismissed] = useState(() => isBannerDismissedToday(BANNER_ID));
  const { overdue, today } = bucketFollowUps(followUps || []);
  if (dismissed || (overdue.length === 0 && today.length === 0)) return null;

  function handleDismiss(e) {
    e.preventDefault();
    e.stopPropagation();
    dismissBannerToday(BANNER_ID);
    setDismissed(true);
  }

  return (
    <Link href="/followups" className="due-banner">
      <span className="due-banner-dot" />
      <span>
        {overdue.length > 0 && (
          <strong>
            {overdue.length} overdue follow-up{overdue.length > 1 ? "s" : ""}
          </strong>
        )}
        {overdue.length > 0 && today.length > 0 && " · "}
        {today.length > 0 && (
          <strong>
            {today.length} due today
          </strong>
        )}
        {" — click to review"}
      </span>
      <button type="button" className="banner-dismiss" onClick={handleDismiss} title="Dismiss for today" aria-label="Dismiss for today">
        <CloseIcon width={13} height={13} />
      </button>
    </Link>
  );
}
