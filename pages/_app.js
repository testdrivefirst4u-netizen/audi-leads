import { useEffect } from "react";
import "react-loading-skeleton/dist/skeleton.css";
import "../styles/globals.css";
import { ToastProvider } from "../components/ToastProvider";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("Service worker registration failed:", err));
    }
  }, []);

  return (
    <ToastProvider>
      <Component {...pageProps} />
    </ToastProvider>
  );
}
