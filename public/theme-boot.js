/* Applies the cached CRM colour theme before the first paint (and before the page loader picks its colours).
   A file, not an inline script, because the Content-Security-Policy (next.config.js) only allows 'self' scripts.
   The theme list and default come from lib/theme.js via data-themes / data-default on this script's tag
   (pages/_document.js), so they're defined in one place. */
(function () {
  var tag = document.currentScript;
  var themes = ((tag && tag.getAttribute("data-themes")) || "showroom").split(",");
  var fallback = (tag && tag.getAttribute("data-default")) || themes[0];
  var t;
  try { t = localStorage.getItem("broaddcast:theme"); } catch (e) {}
  if (themes.indexOf(t) < 0) t = fallback;
  document.documentElement.setAttribute("data-crm-theme", t);
})();
