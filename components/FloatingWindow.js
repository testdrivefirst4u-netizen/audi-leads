import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiMinus, FiX, FiMaximize2 } from "react-icons/fi";
import Portal from "./Portal";

const MARGIN = 16; // free windows keep this far from the screen edge
const GAP = 8; // snapped / full-screen windows
const MIN_W = 360;
const MIN_H = 240;
const SNAP_EDGE = 8; // dragging the pointer this close to an edge snaps

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

// Where a snapped / full-screen window goes on the current screen: the area
// beside the sidebar (so the menu stays usable), split in half for left/right.
function snapFrame(mode) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sidebar = document.querySelector("aside.sb")?.getBoundingClientRect();
  const left = sidebar && sidebar.right > 0 && sidebar.right < vw / 2 ? Math.round(sidebar.right) + GAP : GAP;
  const width = vw - left - GAP;
  const half = Math.floor((width - GAP) / 2);
  if (mode === "left") return { x: left, y: GAP, w: half, h: vh - 2 * GAP };
  if (mode === "right") return { x: vw - GAP - half, y: GAP, w: half, h: vh - 2 * GAP };
  return { x: left, y: GAP, w: width, h: vh - 2 * GAP }; // "max"
}

// Keeps a free window's rect usable on the current screen.
function fitRect(r) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = clamp(r.w, MIN_W, vw - 2 * MARGIN);
  const h = r.h == null ? null : clamp(r.h, MIN_H, vh - 2 * MARGIN);
  return { w, h, x: clamp(r.x, MARGIN, vw - w - MARGIN), y: clamp(r.y, MARGIN, vh - 120) };
}

const HalfIcon = ({ side }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <rect x={side === "left" ? 1.75 : 8} y="2.75" width="6.25" height="10.5" rx="1" fill="currentColor" stroke="none" opacity=".85" />
  </svg>
);
const MaxIcon = ({ restore }) =>
  restore ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="5" width="9" height="9" rx="1.5" />
      <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2H12.5A1.5 1.5 0 0 1 14 3.5V9.5A1.5 1.5 0 0 1 12.5 11H11" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
    </svg>
  );

const RESIZE_HANDLES = ["e", "w", "s", "se", "sw"];

/**
 * A window that floats over the CRM without blocking it: no backdrop, so the
 * page behind keeps working (look a customer up, open another lead) while
 * it's open — and it handles like a desktop window:
 *  - drag the title bar to move it;
 *  - drag an edge or bottom corner to make it bigger or smaller;
 *  - snap it to the left or right half, or full screen — with the title-bar
 *    buttons, a double-click on the title bar (full screen), Alt+arrow keys,
 *    or by dragging it to the screen's left / right / top edge (a preview
 *    shows where). Snapping fills the area beside the sidebar;
 *  - minimize it to a bar in the bottom-right corner; restore brings it back
 *    exactly as it was (content stays mounted, so typed text survives).
 * Size, position and snap are remembered for the tab (sessionStorage, under
 * `storageKey`). On phones it's a bottom sheet instead.
 *
 * `width` / `tall` set the first size; `placement` where it first opens
 * ("bottom-right" for small forms, "right" for tall panels). Esc minimizes
 * rather than closes — closing is the caller's decision (onClose).
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
  const gesture = useRef(null); // current drag / resize
  const [rect, setRect] = useState(null); // free-window geometry; null until placed on the client
  const [mode, setMode] = useState("free"); // "free" | "left" | "right" | "max"
  const [preview, setPreview] = useState(null); // snap target while dragging
  const [narrow, setNarrow] = useState(false);
  const [, setViewportTick] = useState(0);
  const tray = useDockTray();

  // Phone layout + first placement: remembered state, else the placement's default.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {}
    const vh = window.innerHeight;
    const w = Math.min(width, window.innerWidth - 2 * MARGIN);
    // Opens below the sticky top bar, so "+ New lead", the bell and the
    // profile menu stay reachable while a window is open.
    const topBar = document.querySelector(".app-shell header.sticky")?.getBoundingClientRect();
    const top = topBar && topBar.bottom > 0 && topBar.bottom < vh / 3 ? Math.round(topBar.bottom) + GAP : MARGIN;
    const h = tall ? vh - top - MARGIN : null;
    const fallback =
      placement === "right"
        ? { x: window.innerWidth - w - MARGIN, y: top, w, h }
        : { x: window.innerWidth - w - 24, y: Math.max(MARGIN, vh - Math.min(620, vh - 2 * MARGIN) - 24), w, h };
    if (saved?.rect && Number.isFinite(saved.rect.x)) {
      setRect(fitRect(saved.rect));
      setMode(["left", "right", "max"].includes(saved.mode) ? saved.mode : "free");
    } else {
      setRect(fitRect(fallback));
    }
    return () => mq.removeEventListener("change", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Remember size / position / snap for the tab.
  useEffect(() => {
    if (!rect) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ rect, mode }));
    } catch {}
  }, [rect, mode, storageKey]);

  // Follow the browser window: keep free windows on screen, re-fit snapped ones.
  useEffect(() => {
    const onResize = () => {
      setRect((r) => r && fitRect(r));
      setViewportTick((n) => n + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keyboard, while focus is inside the window: Esc minimizes; Alt+← / Alt+→
  // snap to the left / right half, Alt+↑ full screen, Alt+↓ back to its own
  // size (or minimizes when it already is).
  useEffect(() => {
    if (minimized) return;
    const onKey = (e) => {
      if (e.defaultPrevented || !winRef.current?.contains(document.activeElement)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onMinimize();
        return;
      }
      if (!e.altKey || narrow) return;
      const target = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "max" }[e.key];
      if (target) {
        e.preventDefault();
        setMode(target);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (mode === "free") onMinimize();
        else setMode("free");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [minimized, onMinimize, narrow, mode]);

  if (!rect) return null;

  const frame = mode === "free" ? rect : snapFrame(mode);
  const toggleMax = () => setMode((m) => (m === "max" ? "free" : "max"));
  const snapTo = (target) => setMode((m) => (m === target ? "free" : target));

  // ---- move (title bar) ----
  function onBarPointerDown(e) {
    if (narrow || e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind: "move", startX: e.clientX, startY: e.clientY, frame, wasSnapped: mode !== "free", lifted: false };
  }
  function onBarPointerMove(e) {
    const g = gesture.current;
    if (!g || g.kind !== "move") return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.lifted && Math.abs(dx) + Math.abs(dy) < 4) return; // a click, not a drag
    let base = g.frame;
    if (g.wasSnapped && !g.lifted) {
      // Pulling a snapped / full-screen window off: back to its normal size,
      // keeping the same spot of the title bar under the pointer.
      const ratio = (g.startX - g.frame.x) / g.frame.w;
      base = { ...rect, x: g.startX - rect.w * ratio, y: g.startY - 18 };
      g.frame = base;
      setMode("free");
    }
    g.lifted = true;
    setRect(fitRect({ ...base, x: base.x + dx, y: base.y + dy }));
    const vw = window.innerWidth;
    setPreview(e.clientX <= SNAP_EDGE ? "left" : e.clientX >= vw - SNAP_EDGE ? "right" : e.clientY <= SNAP_EDGE ? "max" : null);
  }
  function onBarPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "move" && preview) setMode(preview);
    setPreview(null);
  }

  // ---- resize (edges and bottom corners) ----
  function onHandlePointerDown(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = winRef.current.getBoundingClientRect();
    const start = { x: el.left, y: el.top, w: el.width, h: el.height };
    setRect(start);
    setMode("free");
    gesture.current = { kind: "resize", dir, startX: e.clientX, startY: e.clientY, start };
  }
  function onHandlePointerMove(e) {
    const g = gesture.current;
    if (!g || g.kind !== "resize") return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    let { x, y, w, h } = g.start;
    if (g.dir.includes("e")) w = clamp(w + dx, MIN_W, vw - x - GAP);
    if (g.dir.includes("w")) {
      const right = x + w;
      x = clamp(x + dx, GAP, right - MIN_W);
      w = right - x;
    }
    if (g.dir.includes("s")) h = clamp(h + dy, MIN_H, vh - y - GAP);
    setRect({ x, y, w, h });
  }
  function onHandlePointerUp() {
    gesture.current = null;
  }

  const headerBtn =
    "flex items-center justify-center w-8 h-8 rounded-lg border-none bg-transparent text-white/80 cursor-pointer hover:bg-white/15 hover:text-white";
  const activeBtn = "!bg-white/20 !text-white";

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

  const sized = !narrow && (mode !== "free" || frame.h != null);

  return (
    <>
      {dock && tray && createPortal(dock, tray)}
      <Portal>
        {preview && !minimized && (
          <div className="float-snap-preview" style={{ left: snapFrame(preview).x, top: snapFrame(preview).y, width: snapFrame(preview).w, height: snapFrame(preview).h }} aria-hidden="true" />
        )}
        {/* kept mounted (only hidden) while minimized, so what's on it stays */}
        <section
          ref={winRef}
          role="dialog"
          aria-modal="false"
          aria-label={title}
          hidden={minimized}
          className={`float-window ${narrow ? "is-sheet" : ""} ${sized ? "is-sized" : ""}`}
          style={narrow ? undefined : { left: frame.x, top: frame.y, width: frame.w, height: sized ? frame.h : undefined }}
        >
          <header
            className={`float-window-bar ${narrow ? "" : "cursor-move"}`}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onPointerCancel={onBarPointerUp}
            onDoubleClick={(e) => !narrow && !e.target.closest("button") && toggleMax()}
            title={narrow ? undefined : "Drag to move · double-click for full screen"}
          >
            <div className="min-w-0 select-none">
              <div className="text-[14px] font-bold text-white truncate">{title}</div>
              {(subtitle || !narrow) && (
                <div className="text-[11.5px] text-white/65 truncate">{[subtitle, narrow ? null : "drag to move"].filter(Boolean).join(" · ")}</div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-0.5 shrink-0">
              {!narrow && (
                <>
                  <button type="button" className={`${headerBtn} ${mode === "left" ? activeBtn : ""}`} onClick={() => snapTo("left")} aria-label={`Snap ${title} to the left half`} title="Left half (Alt+←)">
                    <HalfIcon side="left" />
                  </button>
                  <button type="button" className={`${headerBtn} ${mode === "right" ? activeBtn : ""}`} onClick={() => snapTo("right")} aria-label={`Snap ${title} to the right half`} title="Right half (Alt+→)">
                    <HalfIcon side="right" />
                  </button>
                  <button
                    type="button"
                    className={headerBtn}
                    onClick={toggleMax}
                    aria-label={mode === "max" ? `Restore ${title} to its size` : `Full screen ${title}`}
                    title={mode === "max" ? "Restore size (Alt+↓)" : "Full screen (Alt+↑)"}
                  >
                    <MaxIcon restore={mode === "max"} />
                  </button>
                  <span className="w-px h-5 bg-white/15 mx-1" aria-hidden="true" />
                </>
              )}
              <button type="button" className={headerBtn} onClick={onMinimize} aria-label={`Minimize ${title}`} title="Minimize (Esc)">
                <FiMinus size={16} />
              </button>
              <button type="button" className={headerBtn} onClick={onClose} aria-label={`Close ${title}`} title="Close">
                <FiX size={16} />
              </button>
            </div>
          </header>
          <div className="float-window-body">{children}</div>

          {!narrow &&
            mode !== "max" &&
            RESIZE_HANDLES.map((dir) => (
              <span
                key={dir}
                className={`float-resize float-resize-${dir}`}
                onPointerDown={(e) => onHandlePointerDown(e, dir)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                aria-hidden="true"
              />
            ))}
        </section>
      </Portal>
    </>
  );
}
