import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Renders a pop-up (modal) at the app-shell level instead of where it's
// declared. Needed for anything opened from the sticky TopBar: its
// backdrop-filter makes it the containing block for position:fixed
// children, so a full-screen backdrop inside it would only cover the bar.
// Targets .app-shell (not <body>) so the pop-up keeps the theme's colours.
export default function Portal({ children }) {
  const [target, setTarget] = useState(null);
  useEffect(() => setTarget(document.querySelector(".app-shell") || document.body), []);
  return target ? createPortal(children, target) : null;
}
