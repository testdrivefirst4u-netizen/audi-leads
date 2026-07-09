import Link from "next/link";
import { bucketFollowUps } from "./FollowUpsCard";

export default function DueTodayBanner({ followUps }) {
  const { overdue, today } = bucketFollowUps(followUps || []);
  if (overdue.length === 0 && today.length === 0) return null;

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
    </Link>
  );
}
