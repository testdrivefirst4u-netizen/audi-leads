import Link from "next/link";
import { ChevronRightIcon } from "../icons";

/**
 * One dashboard component (Zoho-style): a card with a title, an optional
 * one-line note under it, an optional "View all"-type link, and its chart or
 * list. `span` is how many of the dashboard's 12 grid columns it takes on a
 * wide screen (globals.css "Dashboard grid"); it goes full width on phones.
 */
export default function Panel({ title, note, href, linkLabel = "View all", span = 4, className = "", children }) {
  return (
    <section className={`dash2-panel dash2-span-${span} ${className}`} aria-label={title}>
      <header className="dash2-panel-head">
        <div className="min-w-0">
          <h3 className="dash2-panel-title">{title}</h3>
          {note && <p className="dash2-panel-note">{note}</p>}
        </div>
        {href && (
          <Link href={href} className="dash2-panel-link">
            {linkLabel}
            <ChevronRightIcon width={13} height={13} />
          </Link>
        )}
      </header>
      <div className="dash2-panel-body">{children}</div>
    </section>
  );
}
