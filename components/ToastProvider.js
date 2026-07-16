import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

let nextId = 1;

// App-wide stacking toast system — distinct from the single-message Toast
// component NotificationBell already uses. Used for save/error
// acknowledgements across forms (agents, companies, lead activity, imports)
// so those don't rely on a static inline message the user has to notice.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const showToast = useCallback(
    (message, { type = "ok", duration = 4000 } = {}) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      timers.current[id] = setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto animate-toast-in cursor-pointer max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-toast ${
              t.type === "err"
                ? "bg-danger/10 border-danger/30 text-danger"
                : "bg-success/10 border-success/30 text-success"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Returns a showToast(message, { type: "ok" | "err", duration }) function.
// Falls back to a no-op if used outside the provider (shouldn't happen once
// _app.js wraps the tree, but keeps a stray usage from crashing the page).
export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx || (() => {});
}
