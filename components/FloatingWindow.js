import { useEffect, useRef, useState } from "react";
import { FiMinus, FiX, FiMaximize2 } from "react-icons/fi";
import Portal from "./Portal";

const WIDTH = 460;
const MARGIN = 16;

const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * A window that floats over the CRM without blocking it: no backdrop, so the
 * page behind keeps working (look a customer up, open their lead) while it's
 * open. Drag it by its title bar; minimize it to a bar in the bottom-right
 * corner and bring it back with everything still filled in.
 *
 * Its content stays mounted while minimized, so form state survives. The
 * position is remembered for the tab (sessionStorage, under `storageKey`).
 * On phones it's a bottom sheet instead (dragging a window around a phone
 * screen isn't useful), minimizing to a bar above the tab bar.
 *
 * Esc minimizes rather than closes — closing is the caller's decision
 * (onClose), e.g. after confirming unsaved input is to be discarded.
 */
export default function FloatingWindow({ title, subtitle, minimizedLabel, minimized, onMinimize, onRestore, onClose, storageKey, children }) {
  const winRef = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(null); // null until placed on the client
  const [narrow, setNarrow] = useState(false);

  // Phone layout + first placement: remembered spot, else bottom-right.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {}
    const height = Math.min(620, window.innerHeight - 2 * MARGIN);
    setPos(
      saved && Number.isFinite(saved.x)
        ? { x: clamp(saved.x, MARGIN, window.innerWidth - WIDTH - MARGIN), y: clamp(saved.y, MARGIN, window.innerHeight - 120) }
        : { x: window.innerWidth - WIDTH - 24, y: Math.max(MARGIN, window.innerHeight - height - 24) }
    );
    return () => mq.removeEventListener("change", update);
  }, [storageKey]);

  // Keep it on screen when the browser window shrinks.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => p && { x: clamp(p.x, MARGIN, window.innerWidth - WIDTH - MARGIN), y: clamp(p.y, MARGIN, window.innerHeight - 120) });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc minimizes (only while it's open and focus is inside it).
  useEffect(() => {
    if (minimized) return;
    const onKey = (e) => {
      if (e.key === "Escape" && winRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        onMinimize();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [minimized, onMinimize]);

  function onPointerDown(e) {
    if (narrow || e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startY: e.clientY, x: pos.x, y: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    setPos({
      x: clamp(d.x + e.clientX - d.startX, MARGIN, window.innerWidth - WIDTH - MARGIN),
      y: clamp(d.y + e.clientY - d.startY, MARGIN, window.innerHeight - 120),
    });
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {}
  }

  if (!pos) return null;

  const headerBtn =
    "flex items-center justify-center w-8 h-8 rounded-lg border-none bg-transparent text-white/80 cursor-pointer hover:bg-white/15 hover:text-white";

  return (
    <Portal>
      {/* minimized: a bar in the corner (above the phone tab bar) */}
      {minimized && (
        <div className="float-dock" role="region" aria-label={`${title} (minimized)`}>
          <button type="button" onClick={onRestore} className="flex-1 min-w-0 flex items-center gap-2 border-none bg-transparent text-left text-white cursor-pointer px-1">
            <span className="w-2 h-2 rounded-full bg-[#7ea0ff] shrink-0 animate-pulse" aria-hidden="true" />
            <span className="truncate text-[13px] font-semibold">{minimizedLabel || title}</span>
          </button>
          <button type="button" className={headerBtn} onClick={onRestore} aria-label={`Restore ${title}`} title="Restore">
            <FiMaximize2 size={14} />
          </button>
          <button type="button" className={headerBtn} onClick={onClose} aria-label={`Close ${title}`} title="Close">
            <FiX size={16} />
          </button>
        </div>
      )}

      {/* kept mounted (only hidden) while minimized, so what's typed stays */}
      <section
        ref={winRef}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        hidden={minimized}
        className={`float-window ${narrow ? "is-sheet" : ""}`}
        style={narrow ? undefined : { left: pos.x, top: pos.y, width: WIDTH }}
      >
        <header
          className={`float-window-bar ${narrow ? "" : "cursor-move"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title={narrow ? undefined : "Drag to move"}
        >
          <div className="min-w-0 select-none">
            <div className="text-[14px] font-bold text-white truncate">{title}</div>
            {(subtitle || !narrow) && (
              <div className="text-[11.5px] text-white/65 truncate">
                {[subtitle, narrow ? null : "drag to move"].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button type="button" className={headerBtn} onClick={onMinimize} aria-label={`Minimize ${title}`} title="Minimize (Esc)">
              <FiMinus size={16} />
            </button>
            <button type="button" className={headerBtn} onClick={onClose} aria-label={`Close ${title}`} title="Close">
              <FiX size={16} />
            </button>
          </div>
        </header>
        <div className="float-window-body">{children}</div>
      </section>
    </Portal>
  );
}
