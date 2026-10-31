import { useState } from "react";
import { WhatsAppIcon } from "./icons";
import { waHref } from "../lib/phone";

// Everyday messages a salesperson sends a lead, filled in with the lead's
// first name, model and the agent's name. Each opens WhatsApp (app or web)
// with the text ready, so it can still be tweaked before sending. These go
// from the agent's own WhatsApp — the approved Business templates for bulk
// campaigns live under Campaigns.
const MESSAGES = [
  {
    label: "Introduce",
    text: ({ first, model, agent }) =>
      `Hi ${first}, ${agent ? `this is ${agent} ` : ""}here — thank you for your interest in the ${model}! When would be a good time for a quick call?`,
  },
  {
    label: "Offer test drive",
    text: ({ first, model }) =>
      `Hi ${first}, would you like to experience the ${model} with a test drive? We can arrange it at the showroom or at your home — just share a day and time that suits you.`,
  },
  {
    label: "Confirm test drive",
    text: ({ first, model, agent }) => `Hi ${first}, your ${model} test drive is confirmed. Looking forward to seeing you!${agent ? ` — ${agent}` : ""}`,
  },
  {
    label: "Check in",
    text: ({ first, model }) => `Hi ${first}, just checking in about the ${model}. Any questions I can help with — price, finance or exchange?`,
  },
  {
    label: "Thank for visiting",
    text: ({ first, model }) => `Thank you for visiting us today, ${first}! Happy to share the on-road price or finance options for the ${model} whenever you're ready.`,
  },
];

export default function LeadQuickMessages({ lead }) {
  const [open, setOpen] = useState(false);
  const vars = {
    first: String(lead.name || "").trim().split(/\s+/)[0] || "there",
    model: lead.canonicalModel || lead.model || "car",
    agent: lead.assignedTo?.name || "",
  };

  return (
    <div className="lead-quick-messages">
      <button type="button" className="flex items-center gap-2 border-none bg-transparent p-0 text-[12.5px] font-semibold text-[#128c7e] cursor-pointer" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <WhatsAppIcon /> Quick WhatsApp messages {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {MESSAGES.map((m) => {
            const text = m.text(vars);
            return (
              <a key={m.label} href={waHref(lead.phone, text)} target="_blank" rel="noopener noreferrer" title={text} className="lead-action !h-7 !text-[12px]">
                {m.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
