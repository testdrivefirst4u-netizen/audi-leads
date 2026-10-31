import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiMinus, FiX, FiMaximize2 } from "react-icons/fi";
import Portal from "./Portal";

const MARGIN = 16;

const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

// All minimized windows share one tray in the bottom-right corner, so two
// docked windows (say a new lead and an open lead) stack instead of overlapping.
function useDockTray() {
  const [tray, setTray] = useState(null);
  useEffect(() => {
    const host = document.querySelector(".app-shell") || document.body;
    let el = host.querySelector(":scope > .float-dock-tray");
    if (!el) {
      el = document.createElement("div");
      el.className = "float-dock-tray";
      host.appendChild(el);
    }
    setTray(el);
  }, []);
  return tray;
}

/**
 * A window that floats over the CRM without blocking it: no backdrop, so the
 * page behind keeps working (look a customer up, open another lead) while
 * it's open. Drag it by its title bar; minimize it to a bar in the
 * bottom-right corner and bring it back exactly as it was.
 *
 * Its content stays mounted while minimized, so form state survives. The
 * position is remembered for the tab (sessionStorage, under `storageKey`).
 * `width` is capped to the screen; `placement` picks where it first opens
 * ("bottom-right" for small forms, "right" for tall panels). On phones it's
 * a bottom sheet instead (dragging around a phone screen isn't useful).
 *
 * Esc minimizes rather than closes — closing is the caller's decision
 * (onClose), e.g. after confirming unsaved input is to be discarded.
 */
export default function FloatingWindow({
  title,
  subtitle,
  minimizedLabel,
  minimized,
  onMinimize,
  onRestore,
  onClose,
  storageKey,
  width = 460,
  placement = "bottom-right",
  tall = false,
  children,
}) {
  const winRef = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(null); // null until placed on the client
  const [narrow, setNarrow] = useState(false);
  const [vw, setVw] = useState(1440);
  const tray = useDockTray();

  const w = Math.min(width, vw - 2 * MARGIN);
  const maxX = (viewport) => viewport - Math.min(width, viewport - 2 * MARGIN) - MARGIN;

  // Phone layout + first placement: remembered spot, else the placement's default.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    setVw(window.innerWidth);

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {}
    const height = Math.min(620, window.innerHeight - 2 * MARGIN);
    const fallback =
      placement === "right"
        ? { x: maxX(window.innerWidth), y: MARGIN }
        : { x: maxX(window.innerWidth) - 8, y: Math.max(MARGIN, window.innerHeight - height - 24) };
    setPos(
      saved && Number.isFinite(saved.x)
        ? { x: clamp(saved.x, MARGIN, maxX(window.innerWidth)), y: clamp(saved.y, MARGIN, window.innerHeight - 120) }
        : fallback
    );
    return () => mq.removeEventListener("change", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, placement]);

  // Keep it on screen when the browser window shrinks.
  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setPos((p) => p && { x: clamp(p.x, MARGIN, maxX(window.innerWidth)), y: clamp(p.y, MARGIN, window.innerHeight - 120) });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc minimizes (only while it's open and focus is inside it).
  useEffect(() => {
    if (minimized) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && winRef.current?.contains(document.activeElement)) {
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
      x: clamp(d.x + e.clientX - d.startX, MARGIN, maxX(window.innerWidth)),
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

  const dock = minimized && (
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
  );

  return (
    <>
      {dock && tray && createPortal(dock, tray)}
      <Portal>
        {/* kept mounted (only hidden) while minimized, so what's on it stays */}
        <section
          ref={winRef}
          role="dialog"
          aria-modal="false"
          aria-label={title}
          hidden={minimized}
          className={`float-window ${narrow ? "is-sheet" : ""} ${tall && !narrow ? "is-tall" : ""}`}
          style={narrow ? undefined : { left: pos.x, top: pos.y, width: w }}
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
                <div className="text-[11.5px] text-white/65 truncate">{[subtitle, narrow ? null : "drag to move"].filter(Boolean).join(" · ")}</div>
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
    </>
  );
}
