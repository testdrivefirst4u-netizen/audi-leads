// Builds public/brand-loader.js: the GT coupé scene + the bc mark and the
// loader's runtime (both taken from the sibling realestate-crm project's
// loader) + the "Automobile CRM" wordmark, outlined from Inter Bold.
//
//   npm run build:loader
//
// Needs Microsoft Edge (or Chrome: set BROWSER_PATH) to measure the logo once,
// so the lockup's position can be written into the file — the loader itself
// never measures anything in the page (Next.js keeps <body> hidden until its
// CSS loads, and hidden SVG measures as zero). REALESTATE_LOADER overrides
// where the real-estate loader is read from.
const fs = require("fs");
const path = require("path");
const os = require("os");
const opentype = require("opentype.js");

const APP_ROOT = path.resolve(__dirname, "../..");
const REALESTATE_LOADER = process.env.REALESTATE_LOADER || path.resolve(APP_ROOT, "../realestate-crm/public/brand-loader.js");
const re = fs.readFileSync(REALESTATE_LOADER, "utf8");
const reSvg = JSON.parse(re.match(/var SVG = (".*?");\n/s)[1]);
const defsMark = reSvg.match(/<linearGradient id="bcg0".*?<\/linearGradient><linearGradient id="bcg1".*?<\/linearGradient>/s)[0];
const mark = reSvg.match(/<g class="bc-m">.*?<\/g><\/g>/s)[0];

// ---- wordmark ----
const font = opentype.parse(fs.readFileSync(require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff")).buffer);
const WORD = "Automobile CRM";
let x = 0, i = 0, glyphs = [];
for (const ch of WORD) {
  const g = font.charToGlyph(ch);
  const d = g.getPath(x, 0, 100).toPathData(1);
  if (d) glyphs.push(`<path class="p w" pathLength="1" style="--d:${(0.9 + 0.045 * i).toFixed(2)}s" d="${d}"/>`);
  x += (g.advanceWidth / font.unitsPerEm) * 100 + 1.5; // a touch of tracking
  i++;
}
const word = `<g class="bc-w"><g class="bc-word">${glyphs.join("")}</g></g>`;

// ---- car scene (ground y=215, car faces right) ----
const p = (cls, d, delay) => `<path class="p ${cls}" pathLength="1" style="--d:${delay}s" d="${d}"/>`;
const wn = (d, delay) => `<path class="wn" style="--d:${delay}s" d="${d}"/>`;
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
// The same long-hood GT coupé as the login page (pages/login.js), no badge.
const wheel = (cx, delay) =>
  p("tr", circle(cx, 187, 28), delay) +
  `<g class="rim" style="--d:${delay + 0.95}s">` +
  `<path d="${circle(cx, 187, 19)}"/>` +
  [0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((a) => `<path class="sk" transform="rotate(${a} ${cx} 187)" d="M${cx} 182V170"/>`).join("") +
  `<path class="hub" d="${circle(cx, 187, 4.5)}"/>` +
  `</g>`;

const scene = [
  `<g class="bc-s">`,
  p("g", "M80 215H640", 0),
  `<g transform="translate(-25 0)">`,
  // speed streaks behind the car
  p("bk", "M104 140H146Q149 143 146 146H104Q101 143 104 140Z", 0.32),
  p("bk", "M84 162H144Q147 165 144 168H84Q81 165 84 162Z", 0.26),
  p("bk", "M100 184H146Q149 187 146 190H100Q97 187 100 184Z", 0.36),
  // headlight beam (fades in once the car is filled)
  `<path class="bm" style="--d:1.75s" d="M606 166L700 140V200Z"/>`,
  // body
  p("fr", "M168 196C162 196 157 191 157 184V170C157 161 162 155 171 152L198 146C244 134 270 112 318 104C352 98 392 97 422 103C446 108 466 124 488 135C522 140 566 146 592 156C606 161 613 170 613 180V190C613 194 610 196 606 196H554A34 34 0 0 0 486 196H279A34 34 0 0 0 211 196Z", 0.08),
  // shoulder sheen, glass, lights (fade in over the paint)
  `<path class="wn sh" style="--d:1.15s" d="M178 150C250 138 300 112 330 108C370 102 410 103 430 108C452 114 470 128 492 138C530 144 570 150 596 160L594 164C566 154 528 148 488 143C462 131 446 118 426 113C404 108 368 107 334 112C302 117 256 142 180 156Z"/>`,
  `<path class="wn gl" style="--d:1.2s" d="M258 141C282 124 304 113 332 110C362 107 394 107 414 111C432 115 448 126 462 139Q462 142 458 142H262Q256 142 258 141Z"/>`,
  `<path class="wn hl" style="--d:1.45s" d="M574 157C588 159 600 164 609 170L606 173C596 168 584 163 572 160Z"/>`,
  `<path class="wn tl" style="--d:1.4s" d="M158 160L184 154L186 158L158 165Z"/>`,
  // pillar, character line, door, handle: drawn over the fill
  p("ln pl", "M376 109C378 120 377 131 374 142", 1.3),
  p("ln", "M190 160C280 150 420 150 488 152C540 154 576 160 600 168", 1.05),
  p("ln", "M374 144C378 160 380 176 378 194", 1.15),
  p("ln", "M398 152H418", 1.25),
  wheel(245, 0.28),
  wheel(520, 0.34),
  `</g>`,
  `</g>`,
].join("");

let SVG =
  `<svg viewBox="0 0 720 360" xmlns="http://www.w3.org/2000/svg"><defs>${defsMark}` +
  `<linearGradient id="bcgf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fa4ff"/><stop offset=".28" stop-color="#4562f2"/><stop offset=".62" stop-color="#2238c4"/><stop offset="1" stop-color="#0c1a6e"/></linearGradient>` +
  `<linearGradient id="bcgs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="bcgg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4a80"/><stop offset="1" stop-color="#0a0f22"/></linearGradient>` +
  `<radialGradient id="bcgr" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#eef2ff"/><stop offset=".6" stop-color="#9aa6c6"/><stop offset="1" stop-color="#4a5574"/></radialGradient>` +
  `<linearGradient id="bcgb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9DB0EE" stop-opacity=".75"/><stop offset="1" stop-color="#D6DEF8" stop-opacity="0"/></linearGradient>` +
  `</defs>${scene}${mark}${word}</svg>`;

SVG = bake(SVG);

function bake(svg) {
  const { execFileSync } = require("child_process");
  const m = path.join(os.tmpdir(), "brand-loader-measure.html");
  fs.writeFileSync(m, `<!doctype html><body>${svg}<script>
    const q = (s) => document.querySelector(s), r = (b) => [b.x, b.y, b.width, b.height];
    document.body.insertAdjacentHTML("beforeend", "<pre id=out>" + JSON.stringify({ mb: r(q(".bc-mark").getBBox()), wb: r(q(".bc-word").getBBox()), cb: r(q(".m1").getBBox()), sb: r(q(".bc-s").getBBox()) }) + "</pre>");
  </script>`);
  const EDGE = process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const dom = execFileSync(EDGE, ["--headless=new", "--disable-gpu", "--dump-dom", "file:///" + m.split(path.sep).join("/")], { encoding: "utf8" });
  const { mb, wb, cb, sb } = JSON.parse(dom.match(/<pre id="out">(.*?)<\/pre>/)[1].replace(/&quot;/g, '"'));
  const MS = 0.62, TS = 0.5, GAP = 22, CY = 296;
  const bowlMid = (cb[1] + mb[1] + mb[3]) / 2;
  const MW = mb[2] * MS, total = MW + GAP + wb[2] * TS, X0 = 360 - total / 2;
  const mt = `translate(${(X0 - mb[0] * MS).toFixed(2)},${(CY - bowlMid * MS).toFixed(2)}) scale(${MS})`;
  const wt = `translate(${(X0 + MW + GAP - wb[0] * TS).toFixed(2)},${(CY - (wb[1] + wb[3] / 2) * TS).toFixed(2)}) scale(${TS})`;
  // vertical extent: top of the car scene to the bottom of the mark, padded evenly
  const top = sb[1], bottom = Math.max(CY - bowlMid * MS + (mb[1] + mb[3]) * MS, CY + (wb[3] / 2) * TS);
  const pad = 24, vb = `0 ${(top - pad).toFixed(1)} 720 ${(bottom - top + 2 * pad).toFixed(1)}`;
  console.log("lockup", { mt, wt, vb });
  return svg
    .replace('viewBox="0 0 720 360"', `viewBox="${vb}"`)
    .replace('<g class="bc-mark">', `<g class="bc-mark" transform="${mt}">`)
    .replace('<g class="bc-word">', `<g class="bc-word" transform="${wt}">`);
}

const CSS = [
  "#bc-loader{--k:1;position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#fff;transition:opacity .35s ease}",
  "#bc-loader.bc-fast{--k:.5}",
  "#bc-loader svg{width:min(86vw,560px);height:auto;display:block;overflow:visible}",
  "#bc-loader .p{stroke:#2646C6;stroke-width:1.6;stroke-linejoin:round;vector-effect:non-scaling-stroke;stroke-dasharray:1 1;stroke-dashoffset:1;fill-opacity:0;animation:bcDraw calc(1s*var(--k)) cubic-bezier(.6,0,.3,1) calc(var(--d)*var(--k)) forwards,bcFill calc(.45s*var(--k)) ease calc((var(--d) + .75s)*var(--k)) forwards}",
  "#bc-loader .g{fill:none;stroke-width:2}",
  "#bc-loader .bk{fill:#D6DEF8;stroke:#9DB0EE}",
  "#bc-loader .fr{fill:url(#bcgf)}",
  "#bc-loader .tr{fill:#07090f}",
  "#bc-loader .ln{fill:none;stroke:#fff;stroke-opacity:.45;stroke-width:1.4;stroke-linecap:round}",
  "#bc-loader .g.p,#bc-loader .ln.p{animation:bcDraw calc(1s*var(--k)) cubic-bezier(.6,0,.3,1) calc(var(--d)*var(--k)) forwards}",
  "#bc-loader .wn{fill:#fff;opacity:0;animation:bcWin calc(.3s*var(--k)) ease calc(var(--d)*var(--k)) forwards}",
  "#bc-loader .rim{fill:#D6DEF8;stroke:#2646C6;stroke-width:1.6;opacity:0;transform-box:fill-box;transform-origin:center;animation:bcWin calc(.3s*var(--k)) ease calc(var(--d)*var(--k)) forwards}",
  "#bc-loader .rim{fill:url(#bcgr);stroke:#4a5574;stroke-width:1.2}",
  "#bc-loader .rim .sk{fill:none;stroke:#3a4466;stroke-width:1.6;stroke-linecap:round}#bc-loader .rim .hub{fill:#2a3350;stroke:#c9d2ea}",
  "#bc-loader .sh{fill:url(#bcgs)}#bc-loader .gl{fill:url(#bcgg)}#bc-loader .hl{fill:#eef4ff}#bc-loader .tl{fill:#ff3d5e}",
  "#bc-loader .ln.pl,#bc-loader.bc-done .ln.pl{stroke:#2238c4;stroke-opacity:1;stroke-width:4}",
  // Midnight theme (lib/theme.js sets <html data-crm-theme>): dark backdrop, light mark and wordmark
  "html[data-crm-theme=midnight] #bc-loader{background:#0b0e1a}html[data-crm-theme=midnight] #bc-loader .m0,html[data-crm-theme=midnight] #bc-loader .m1,html[data-crm-theme=midnight] #bc-loader .w{fill:#c7d2ff}html[data-crm-theme=midnight] #bc-loader .p{stroke:#8ea2ff}html[data-crm-theme=midnight] #bc-loader .bk{fill:#232c52;stroke:#3a4680}",
  "#bc-loader .bm{fill:url(#bcgb);opacity:0;animation:bcWin calc(.5s*var(--k)) ease calc(var(--d)*var(--k)) forwards}",
  "@keyframes bcWin{to{opacity:.92}}",
  "#bc-loader .m0{fill:url(#bcg0)} #bc-loader .m1{fill:url(#bcg1)} #bc-loader .w{fill:#2646C6}",
  "@keyframes bcDraw{to{stroke-dashoffset:0}}@keyframes bcFill{to{fill-opacity:1;stroke-opacity:0}}@keyframes bcBlink{0%,100%{opacity:1}50%{opacity:.2}}@keyframes bcFlash{0%,40%,100%{opacity:.95}50%,90%{opacity:.1}}@keyframes bcSpin{to{transform:rotate(360deg)}}",
  // logo already filled (refresh, or still waiting for the page)
  "#bc-loader.bc-done .p{animation:none;stroke-dashoffset:0;fill-opacity:1;stroke-opacity:0}",
  "#bc-loader.bc-done .wn,#bc-loader.bc-done .rim,#bc-loader.bc-done .bm{animation:none;opacity:.92}",
  "#bc-loader.bc-done .g,#bc-loader.bc-done .ln{stroke-opacity:1}#bc-loader.bc-done .ln{stroke-opacity:.45}",
  // waiting: wheels turn, beam and logo breathe
  "#bc-loader.bc-wait .rim{animation:bcSpin .9s linear infinite}",
  "#bc-loader.bc-wait .bc-m,#bc-loader.bc-wait .bc-w{animation:bcBlink .9s ease-in-out infinite}",
  "#bc-loader.bc-wait .bm,#bc-loader.bc-wait .hl{animation:bcFlash .9s linear infinite}",
  // drawing starts only once the loader is on screen (the runtime adds .bc-go)
  "#bc-loader:not(.bc-go):not(.bc-done) .p,#bc-loader:not(.bc-go):not(.bc-done) .wn,#bc-loader:not(.bc-go):not(.bc-done) .rim,#bc-loader:not(.bc-go):not(.bc-done) .bm{animation-play-state:paused}",
  "@media (prefers-reduced-motion:reduce){#bc-loader .p{animation:none;stroke-dashoffset:0;fill-opacity:1;stroke-opacity:0}#bc-loader .g,#bc-loader .ln{stroke-opacity:1}#bc-loader .ln{stroke-opacity:.45}#bc-loader .wn,#bc-loader .rim,#bc-loader .bm{animation:none;opacity:.92}#bc-loader.bc-wait .rim,#bc-loader.bc-wait .bm,#bc-loader.bc-wait .hl,#bc-loader.bc-wait .bc-m,#bc-loader.bc-wait .bc-w{animation:none}#bc-loader{transition:none}}",
].join("");

// Runtime: same behaviour as the real-estate loader, with the skip list for this app.
let runtime = re.slice(re.indexOf("  // Customer-facing and public pages"));
// Positions are baked in above, so nothing is measured in the page (Next.js keeps <body> hidden until its CSS loads).
runtime = runtime.replace(/  function lockup\(\) \{[\s\S]*?\n  \}\n\n/, "").replace("    lockup();\n", "");
const blinkOld = `    // Still loading once the logo has filled: pulse gently until the page is ready.
    later(function () { if (!done && el === mine) mine.className = 'bc-done bc-wait'; }, minMs);`;
if (!runtime.includes(blinkOld)) throw new Error("blink hook not found");
runtime = runtime.replace(blinkOld, `    // Once the logo has filled it blinks, and keeps blinking until the page is ready.
    later(function () { if (!done && el === mine) mine.className = 'bc-done bc-wait'; }, Math.max(0, minMs - BLINK_MS));`);
const navOld = "el.className = mode === 'again' ? 'bc-done bc-wait' : mode === 'nav' ? 'bc-fast' : '';";
if (!runtime.includes(navOld)) throw new Error("nav className not found");
runtime = runtime.replace(navOld, "el.className = mode === 'again' || mode === 'nav' ? 'bc-done bc-wait' : '';");
if (/lockup/.test(runtime)) throw new Error("lockup not removed");
const head = `/* BroaddCast page loader: a car, the bc mark and "Automobile CRM" draw their outline, then fill.
   Plays on every full page load (first open, refresh, after sign-in) and, faster, on every move to another
   screen (pages/_app.js calls window.bcLoaderShow / window.bcLoaderDone on router events).
   Generated by scripts/brand-loader/build.js (npm run build:loader); edit the timings there, not here. */
(function () {
  if (window.bcLoaderShow) return;
  var FIRST_MS = 3600;  // first open in a tab: the whole draw-and-fill, then one blink
  var AGAIN_MS = 900;   // refresh in the same tab: logo already filled, one blink
  var NAV_MS = 600;     // moving to a screen that's slow to load (pages/_app.js waits 400ms first): the filled logo, blinking
  var BLINK_MS = 900;   // one blink (matches bcBlink in the CSS); it keeps blinking while the page is still loading
  var MAX_MS = 8000;    // never block the CRM longer than this
  var CSS = ${JSON.stringify(CSS)};
  var SVG = ${JSON.stringify(SVG)};
`;
const out = head + runtime
  .replace(/\/\/ Customer-facing and public pages keep their own look\.\n.*\n/, "  // The public privacy page keeps its own look.\n  var skip = function (path) { return /^\\/privacy(\\/|$)/.test(path); };\n");
if (!out.includes("/^\\/privacy")) throw new Error("skip list not replaced");
fs.writeFileSync(path.join(APP_ROOT, "public/brand-loader.js"), out);
const preview = path.join(os.tmpdir(), "brand-loader-preview.html");
fs.writeFileSync(preview, `<!doctype html><meta charset=utf-8><title>loader</title><body><script>${out}</script>`);
console.log("preview:", preview);
console.log("ok", out.length, "bytes;", glyphs.length, "glyphs");
