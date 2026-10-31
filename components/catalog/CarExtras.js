import { useEffect, useRef, useState } from "react";
import Portal from "../Portal";
import { GALLERY_KINDS, groupSpecs, isPriceStale, priceAsOfLabel } from "../../lib/catalog";

// Full-size photo viewer: ← / → or the buttons to move, Esc or a click outside to close.
function Lightbox({ images, index, onClose, onMove }) {
  const closeRef = useRef(null);
  // Focus moves into the viewer (and back to the photo afterwards) so the lead
  // window's own Esc / Alt+arrow keys don't fire underneath it.
  useEffect(() => {
    const before = document.activeElement;
    closeRef.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (e.key !== "Escape" && !move) return;
      e.preventDefault();
      e.stopPropagation();
      if (move) onMove(move);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, onMove]);
  const img = images[index];
  if (!img) return null;
  const btn = "absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full border-none bg-white/15 text-white text-[22px] cursor-pointer hover:bg-white/25";
  return (
    <Portal>
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
        <figure className="m-0 max-w-[1100px] w-full" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.caption || ""} className="block max-h-[78vh] w-full object-contain rounded-xl" />
          <figcaption className="mt-3 text-center text-[13px] text-white/80">
            {[img.caption, `${index + 1} of ${images.length}`].filter(Boolean).join(" · ")}
          </figcaption>
        </figure>
        {images.length > 1 && (
          <>
            <button type="button" className={`${btn} left-4`} onClick={(e) => (e.stopPropagation(), onMove(-1))} aria-label="Previous photo">
              ‹
            </button>
            <button type="button" className={`${btn} right-4`} onClick={(e) => (e.stopPropagation(), onMove(1))} aria-label="Next photo">
              ›
            </button>
          </>
        )}
        <button ref={closeRef} type="button" className="absolute top-4 right-4 w-10 h-10 rounded-full border-none bg-white/15 text-white text-[20px] cursor-pointer hover:bg-white/25" onClick={onClose} aria-label="Close photo">
          ×
        </button>
      </div>
    </Portal>
  );
}

const Heading = ({ children }) => <h3 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{children}</h3>;

/**
 * What a telecaller needs beyond names and prices — used on the model page
 * and in a lead's Car panel: the price's date (flagged when stale), this
 * dealer's offer, the photo gallery, highlights, grouped specs and quick
 * answers. Each part shows only when the catalog has it.
 */
export default function CarExtras({ model, compact = false }) {
  const [viewing, setViewing] = useState(null);
  const images = [...(model.imageUrl ? [{ url: model.imageUrl, caption: model.name, kind: "exterior" }] : []), ...(model.gallery || [])];
  const groups = groupSpecs(model.specs);
  const stale = isPriceStale(model);
  const move = (dir) => setViewing((i) => (i + dir + images.length) % images.length);

  return (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${stale ? "bg-warning/10 text-ink" : "bg-bg text-muted"}`}>
        <span className="font-semibold">{priceAsOfLabel(model)}</span>
        {stale && <span className="pill bg-warning/20 text-[#b45309]">Check with sales before quoting</span>}
      </div>

      {model.offers && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-[13px] text-ink">
          <span className="font-bold text-success">Current offer: </span>
          {model.offers}
        </div>
      )}

      {images.length > 1 && (
        <section>
          <Heading>Photos ({images.length})</Heading>
          <div className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"}`}>
            {images.map((img, i) => (
              <button
                key={img._id || img.url}
                type="button"
                onClick={() => setViewing(i)}
                className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-bg p-0 cursor-zoom-in"
                aria-label={`Open photo ${i + 1}${img.caption ? `: ${img.caption}` : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                {img.kind && img.kind !== "exterior" && (
                  <span className="absolute left-1 bottom-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">{GALLERY_KINDS.find((k) => k.value === img.kind)?.label}</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {model.highlights?.length > 0 && (
        <section>
          <Heading>Highlights</Heading>
          <ul className="list-none m-0 p-0 grid gap-1.5 sm:grid-cols-2">
            {model.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2 text-[13px] text-ink">
                <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">✓</span>
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section>
          <Heading>Specifications</Heading>
          <div className="flex flex-col gap-1.5">
            {groups.map(([group, rows], gi) => (
              <details key={group} open={!compact || gi === 0} className="rounded-lg border border-border">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">
                  {group} <span className="font-normal text-muted">({rows.length})</span>
                </summary>
                <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-t border-border text-[13px]">
                  {rows.map((r) => (
                    <div key={r._id || r.name} className="contents">
                      <dt className="px-3 py-1.5 text-muted border-b border-border last:border-b-0">{r.name}</dt>
                      <dd className="m-0 px-3 py-1.5 font-medium text-ink border-b border-border">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
        </section>
      )}

      {model.faqs?.length > 0 && (
        <section>
          <Heading>Quick answers</Heading>
          <div className="flex flex-col gap-1.5">
            {model.faqs.map((f) => (
              <details key={f._id || f.q} className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-[13px] font-semibold text-ink">{f.q}</summary>
                <p className="m-0 mt-1.5 text-[13px] text-ink whitespace-pre-line">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {viewing != null && <Lightbox images={images} index={viewing} onClose={() => setViewing(null)} onMove={move} />}
    </div>
  );
}
