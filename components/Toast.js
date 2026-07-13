import { useEffect } from "react";
import { BellIcon } from "./icons";

export default function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 flex items-center gap-2.5 bg-sidebar text-white px-[18px] py-3.5 rounded-[10px] shadow-toast text-[13px] font-medium z-[100] animate-toast-in [&>svg]:text-accent [&>svg]:shrink-0">
      <BellIcon />
      <span>{message}</span>
    </div>
  );
}
