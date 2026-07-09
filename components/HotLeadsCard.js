import Link from "next/link";
import { FireIcon } from "./icons";

export default function HotLeadsCard({ count }) {
  if (!count) return null;

  return (
    <Link href="/leads?hot=true" className="hot-leads-banner">
      <FireIcon />
      <span>
        <strong>{count}</strong> hot lead{count > 1 ? "s" : ""} — urgent buyers nobody's contacted yet. Click to view.
      </span>
    </Link>
  );
}
