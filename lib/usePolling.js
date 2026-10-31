import { useEffect, useRef } from "react";

// Runs `fn` now and then every `intervalMs` — but only while the tab is
// visible. A CRM tends to stay open in background tabs all day across a whole
// showroom team; polling those just loads the server for nobody. When the
// tab comes back into view it refreshes straight away instead of waiting
// for the next tick. `deps` restart it, like useEffect's.
export function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let timer = null;
    const run = () => fnRef.current();
    const start = () => {
      clearInterval(timer);
      timer = setInterval(run, intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        run();
        start();
      }
    };
    run();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
