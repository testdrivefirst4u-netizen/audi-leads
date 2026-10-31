// Colour themes for the CRM (not the login page), applied as
// <html data-crm-theme="...">, which globals.css ("Themes") reads inside
// .app-shell.
//
// The choice is saved to the person's account (/api/preferences) so it
// follows them across devices, and cached in localStorage so
// public/theme-boot.js can apply it before the first paint. That script gets
// the list below from pages/_document.js (data-themes / data-default on its
// <script> tag), so THEMES here is the only place themes are defined.

export const THEMES = [
  { key: "showroom", label: "Showroom", hint: "Dark sidebar, light pages" },
  { key: "light", label: "Light", hint: "Light sidebar and pages" },
  { key: "midnight", label: "Midnight", hint: "Dark everywhere" },
];

export const DEFAULT_THEME = "showroom";
export const THEME_STORAGE_KEY = "broaddcast:theme";
export const THEME_EVENT = "broaddcast:theme-change";

const isTheme = (key) => THEMES.some((t) => t.key === key);

export function getTheme() {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const current = document.documentElement.getAttribute("data-crm-theme");
  return isTheme(current) ? current : DEFAULT_THEME;
}

// Applies a theme in this browser (attribute + localStorage cache) and tells
// any open theme pickers. Doesn't touch the account — see saveTheme.
export function applyTheme(key) {
  const theme = isTheme(key) ? key : DEFAULT_THEME;
  document.documentElement.setAttribute("data-crm-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode / blocked storage: the theme still applies for this page
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  return theme;
}

// The person picked a theme: apply it now and save it to their account.
export function saveTheme(key) {
  const theme = applyTheme(key);
  fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
  return theme;
}

// Once per full page load: pick up the theme saved on the account (e.g. chosen
// on another device). Each page renders its own Layout, so this guards against
// refetching on every in-app navigation.
let accountThemeLoaded = false;
export function loadAccountTheme() {
  if (accountThemeLoaded || typeof window === "undefined") return;
  accountThemeLoaded = true;
  fetch("/api/preferences")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.theme && data.theme !== getTheme()) applyTheme(data.theme);
    })
    .catch(() => {});
}
