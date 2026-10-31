import { useState } from "react";
import { PhoneIcon } from "./icons";

export const CALL_OUTCOMES = ["Connected", "No answer", "Busy", "Call back later", "Wrong number"];

// Tomorrow, as the <input type="date"> value — the usual "call back" default.
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Shown in a lead's window right after "Call" is tapped: one tap for how the
 * call went, an optional note, and when to follow up — instead of the agent
 * remembering to fill in "Log a call" afterwards. onSave(outcome, note,
 * followDate) does the saving; onSkip dismisses it.
 */
export default function CallOutcome({ leadName, saving, onSave, onSkip }) {
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState("");
  const [followDate, setFollowDate] = useState("");

  function pick(o) {
    setOutcome(o);
    // a call back needs a date; offer tomorrow so it's one tap
    if ((o === "Call back later" || o === "No answer" || o === "Busy") && !followDate) setFollowDate(tomorrow());
    if (o === "Wrong number") setFollowDate("");
  }

  return (
    <div className="call-outcome" role="region" aria-label="Log how the call went">
      <div className="flex items-center gap-2 text-[13px] font-bold text-ink">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent">
          <PhoneIcon />
        </span>
        How did the call with {leadName || "this lead"} go?
        <button type="button" className="ml-auto border-none bg-transparent text-[12px] font-semibold text-muted cursor-pointer hover:text-ink" onClick={onSkip}>
          Skip
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Call outcome">
        {CALL_OUTCOMES.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={outcome === o}
            onClick={() => pick(o)}
            className={`h-8 px-3 rounded-full border text-[12.5px] font-semibold cursor-pointer transition-colors ${
              outcome === o ? "bg-accent text-white border-accent" : "bg-card text-ink border-border hover:border-accent/50"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      {outcome && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_170px_auto] items-end">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did they say?"
              className="h-9 rounded-lg border border-border bg-card px-3 text-[13px] text-ink focus:outline-none focus:border-accent"
            />
          </label>
          {outcome !== "Wrong number" && (
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted">
              Follow up on
              <input
                type="date"
                value={followDate}
                onChange={(e) => setFollowDate(e.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2 text-[13px] text-ink focus:outline-none focus:border-accent"
              />
            </label>
          )}
          <button type="button" className="btn h-9 !py-0" disabled={saving} onClick={() => onSave(outcome, note.trim(), followDate)}>
            {saving ? "Saving…" : "Save call"}
          </button>
        </div>
      )}
    </div>
  );
}
