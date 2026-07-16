// Derives the accent/hover/soft trio Tailwind expects (see tailwind.config.js)
// from a single brand hex color, so a company only ever picks one color and
// the rest of the palette stays visually consistent with the platform
// default's relationships (hover = darker, soft = a light tint).

const DEFAULT_HEX = "#3d5afe";

function hexToRgb(hex) {
  const clean = (hex || "").replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mix(rgb, target, weight) {
  return {
    r: Math.round(rgb.r + (target.r - rgb.r) * weight),
    g: Math.round(rgb.g + (target.g - rgb.g) * weight),
    b: Math.round(rgb.b + (target.b - rgb.b) * weight),
  };
}

function triplet({ r, g, b }) {
  return `${r} ${g} ${b}`;
}

// Returns the three "R G B" triplets (for CSS custom properties consumed via
// Tailwind's rgb(var(--x) / <alpha-value>) pattern) for a given brand hex, or
// null if the hex is blank/invalid — callers should fall back to the
// platform default in that case.
export function brandColorTriplets(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return {
    accent: triplet(rgb),
    hover: triplet(mix(rgb, black, 0.18)), // ~18% darker
    soft: triplet(mix(rgb, white, 0.92)), // ~92% toward white — a light tint
  };
}

export const DEFAULT_BRAND_COLOR = DEFAULT_HEX;
