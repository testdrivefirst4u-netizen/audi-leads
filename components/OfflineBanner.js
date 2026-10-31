import { useEffect, useState } from "react";
import { FiWifiOff } from "react-icons/fi";

// Shown while the device has no connection, so a salesperson on a weak
// showroom signal knows why things aren't loading or saving — instead of
// silent failures. Disappears by itself once the connection is back.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-2 rounded-full bg-[#1c2130] px-4 py-2 text-[13px] font-medium text-white shadow-toast">
      <FiWifiOff size={15} className="text-[#fbbf24]" />
      You&apos;re offline — changes won&apos;t save until you&apos;re back online.
    </div>
  );
}
