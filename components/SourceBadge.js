// Lead-source badge with a recognisable icon per source — Meta/Facebook,
// Instagram, Website (globe), Google Ads, LinkedIn, WhatsApp, Phone,
// Walk-in, Referral, Google Sheets, and a generic tag for anything else
// (CarDekho, CarWale, custom names…). Used by the Leads table, the lead
// detail and the import page. Match is on the lead's `platform` first
// (set by the Meta webhook), then on the source name.

const ICON_PROPS = { width: 13, height: 13, viewBox: "0 0 24 24", "aria-hidden": "true" };

const icons = {
  facebook: (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8h3.3z" />
    </svg>
  ),
  instagram: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  meta: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M3 15c0-4 2-9 5-9s4 4 5 6c1-2 2-6 5-6s4 5 4 9c0 2-1 3-2 3s-2-1-3-3l-2-4-2 4c-1 2-2 3-3 3s-2-1-2-3" />
    </svg>
  ),
  website: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </svg>
  ),
  google: (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" />
      <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z" />
    </svg>
  ),
  linkedin: (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M6.5 8.5H3V21h3.5V8.5zM4.8 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 13.4c0-3.4-1.8-5.1-4.4-5.1-2 0-2.9 1.1-3.4 1.9V8.5H9.7V21h3.5v-6.6c0-1.7.6-2.9 2.2-2.9 1.5 0 2.1 1.1 2.1 2.9V21H21v-7.6z" />
    </svg>
  ),
  whatsapp: (
    <svg {...ICON_PROPS} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3 1.8.8 2.5.8 3.4.7.6-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2 0-.2-.2-.3-.5-.4z" />
    </svg>
  ),
  phone: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  ),
  walkin: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21V9l9-6 9 6v12M9 21v-6h6v6" />
    </svg>
  ),
  referral: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" />
    </svg>
  ),
  sheets: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16M4 15h16M10 9v12" />
    </svg>
  ),
  car: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v5h-2a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H3v-5z" />
      <path d="M5 13h14" />
    </svg>
  ),
  tag: (
    <svg {...ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12V4h8l10 10-8 8L3 12z" />
      <circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
};

// Brand-ish colours, kept pastel so the table stays calm.
const STYLES = {
  facebook: { icon: "facebook", bg: "#eef3ff", text: "#1d4ed8" },
  instagram: { icon: "instagram", bg: "#fdf2f8", text: "#be185d" },
  meta: { icon: "meta", bg: "#eef3ff", text: "#1e40af" },
  website: { icon: "website", bg: "#ecfeff", text: "#0e7490" },
  google: { icon: "google", bg: "#fff7ed", text: "#c2410c" },
  linkedin: { icon: "linkedin", bg: "#eff6ff", text: "#0369a1" },
  whatsapp: { icon: "whatsapp", bg: "#ecfdf5", text: "#047857" },
  phone: { icon: "phone", bg: "#f5f3ff", text: "#6d28d9" },
  walkin: { icon: "walkin", bg: "#fefce8", text: "#a16207" },
  referral: { icon: "referral", bg: "#fdf4ff", text: "#a21caf" },
  sheets: { icon: "sheets", bg: "#ecfdf5", text: "#15803d" },
  car: { icon: "car", bg: "#f1f5f9", text: "#334155" },
  tag: { icon: "tag", bg: "#f1f5f9", text: "#475569" },
};

export function sourceKind(source, platform) {
  if (platform === "facebook") return "facebook";
  if (platform === "instagram") return "instagram";
  const s = String(source || "").toLowerCase();
  if (!s) return "meta";
  if (/instagram/.test(s)) return "instagram";
  if (/facebook/.test(s)) return "facebook";
  if (/meta|fb ads|lead ads/.test(s)) return "meta";
  if (/website|web|landing|form|organic|direct/.test(s)) return "website";
  if (/google ads|adwords|google search|youtube/.test(s)) return "google";
  if (/linkedin/.test(s)) return "linkedin";
  if (/whatsapp/.test(s)) return "whatsapp";
  if (/phone|call|ivr|missed/.test(s)) return "phone";
  if (/walk/.test(s)) return "walkin";
  if (/referral|refer/.test(s)) return "referral";
  if (/sheet/.test(s)) return "sheets";
  if (/cardekho|carwale|cartrade|zigwheels|autoportal|car/.test(s)) return "car";
  return "tag";
}

export default function SourceBadge({ source, platform, label, compact = false, title }) {
  const kind = sourceKind(source, platform);
  const style = STYLES[kind];
  const text = label || (platform === "facebook" ? "Facebook" : platform === "instagram" ? "Instagram" : source || "Meta Ads");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${compact ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[12px]"}`}
      style={{ background: style.bg, color: style.text }}
      title={title || text}
    >
      {icons[style.icon]}
      {text}
    </span>
  );
}
