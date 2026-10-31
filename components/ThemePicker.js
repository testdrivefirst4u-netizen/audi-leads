import { useEffect, useState } from "react";
import { FiSun, FiMoon, FiSidebar } from "react-icons/fi";
import { THEMES, THEME_EVENT, getTheme, saveTheme } from "../lib/theme";

const THEME_ICONS = { showroom: FiSidebar, light: FiSun, midnight: FiMoon };

/** Showroom / Light / Midnight, as a segmented control (lives in the profile menu). */
export default function ThemePicker() {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(getTheme());
    const onChange = (e) => setTheme(e.detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Colour theme">
      {THEMES.map(({ key, label, hint }) => {
        const Icon = THEME_ICONS[key];
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            title={hint}
            onClick={() => saveTheme(key)}
            className={`flex flex-col items-center gap-1 rounded-md border-none py-2 text-[11px] font-semibold cursor-pointer transition-colors duration-150 ${
              active ? "bg-accent text-white shadow-[0_4px_12px_-4px_rgb(var(--accent-rgb)/0.7)]" : "bg-transparent text-muted hover:text-ink"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
