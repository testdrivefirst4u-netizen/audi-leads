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
    <div className="toast">
      <BellIcon />
      <span>{message}</span>
    </div>
  );
}
