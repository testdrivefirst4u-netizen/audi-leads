import { WhatsAppIcon } from "./icons";

// Small shared bits for the Campaigns list and report pages.
export const STATUS_META = {
  draft: { label: "Draft", cls: "bg-bg text-muted" },
  scheduled: { label: "Scheduled", cls: "bg-[#eef3ff] text-[#1d4ed8]" },
  sending: { label: "Sending", cls: "bg-[#fff7ed] text-[#c2410c]" },
  paused: { label: "Paused", cls: "bg-[#fef9c3] text-[#854d0e]" },
  done: { label: "Done", cls: "bg-[#ecfdf5] text-[#047857]" },
  failed: { label: "Failed", cls: "bg-[#fef2f2] text-[#b91c1c]" },
};

export function ChannelBadge({ channel }) {
  return channel === "whatsapp" ? (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#128c7e]">
      <WhatsAppIcon width={14} height={14} /> WhatsApp
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1d4ed8]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
      Email
    </span>
  );
}

