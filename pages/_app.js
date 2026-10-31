import { useEffect } from "react";
import Router from "next/router";
import "react-loading-skeleton/dist/skeleton.css";
import "../styles/globals.css";
import { ToastProvider } from "../components/ToastProvider";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("Service worker registration failed:", err));
    }
  }, []);

  // Plays the BroaddCast loader (public/brand-loader.js) when moving to another
  // screen — but only if that screen is slow to arrive: most switches finish
  // well inside SLOW_NAV_MS and then show nothing at all. Filter/query changes
  // on the same page (shallow or same pathname) don't count — those update
  // in place.
  useEffect(() => {
    const SLOW_NAV_MS = 400;
    let timer = null;
    const pathOf = (url) => url.split(/[?#]/)[0];
    const onStart = (url, { shallow }) => {
      if (shallow || pathOf(url) === location.pathname) return;
      clearTimeout(timer);
      timer = setTimeout(() => window.bcLoaderShow?.(), SLOW_NAV_MS);
    };
    const onDone = () => {
      clearTimeout(timer);
      window.bcLoaderDone?.();
    };
    Router.events.on("routeChangeStart", onStart);
    Router.events.on("routeChangeComplete", onDone);
    Router.events.on("routeChangeError", onDone);
    return () => {
      clearTimeout(timer);
      Router.events.off("routeChangeStart", onStart);
      Router.events.off("routeChangeComplete", onDone);
      Router.events.off("routeChangeError", onDone);
    };
  }, []);

  return (
    <ToastProvider>
      <Component {...pageProps} />
    </ToastProvider>
  );
}
