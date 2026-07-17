// Rasterizes one of our SVG chart components (VerticalBarChart,
// CategoryPieChart, etc.) to a PNG/JPG, for the "Download chart as image"
// buttons and for embedding chart images into the Excel/PDF report exports.
//
// The charts use Tailwind classes (e.g. "fill-accent", themed per-company via
// a CSS custom property) for some colors, which only resolve through the
// page's stylesheet — a bare clone-and-serialize would lose them. So each
// element's *computed* fill/stroke is copied into an inline style before
// serializing, which bakes in whatever color is actually on screen right now.
function inlineComputedStyle(sourceEl, cloneEl) {
  const computed = window.getComputedStyle(sourceEl);
  ["fill", "stroke", "stroke-width", "opacity", "font-family", "font-size", "font-weight", "text-anchor"].forEach(
    (prop) => {
      const value = computed.getPropertyValue(prop);
      if (value) cloneEl.style.setProperty(prop, value);
    }
  );
  for (let i = 0; i < sourceEl.children.length; i++) {
    inlineComputedStyle(sourceEl.children[i], cloneEl.children[i]);
  }
}

async function svgToCanvas(svgEl, { background = "#ffffff", scale = 2 } = {}) {
  const clone = svgEl.cloneNode(true);
  inlineComputedStyle(svgEl, clone);

  const viewBox = svgEl.getAttribute("viewBox");
  const [, , vbWidth, vbHeight] = viewBox.split(" ").map(Number);
  clone.setAttribute("width", vbWidth);
  clone.setAttribute("height", vbHeight);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const svgString = new XMLSerializer().serializeToString(clone);
  const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = svgDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = vbWidth * scale;
  canvas.height = vbHeight * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// format: "png" | "jpg" — returns a data URL.
export async function svgToImageDataUrl(svgEl, { format = "png", scale = 2 } = {}) {
  const canvas = await svgToCanvas(svgEl, { scale });
  const mime = format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/png";
  return canvas.toDataURL(mime, 0.92);
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
