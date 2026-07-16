import { statusColor } from "../lib/leadFields";

// New -> Contacted -> Qualified -> Won reads as a real funnel (each stage a
// subset of the one before); Lost is an exit branch, not a sequential stage,
// so it's shown separately below rather than narrowing the funnel further.
const FUNNEL_ORDER = ["New", "Contacted", "Qualified", "Won"];

export default function PipelineStats({ pipeline }) {
  if (!pipeline) return null;

  const byLabel = Object.fromEntries(pipeline.map((p) => [p.label, p.count]));
  const lost = byLabel.Lost || 0;
  const funnelStages = FUNNEL_ORDER.map((label) => ({ label, count: byLabel[label] || 0 }));
  const maxCount = Math.max(...funnelStages.map((s) => s.count), 1);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2">
        {funnelStages.map((stage) => {
          const { text } = statusColor(stage.label);
          const widthPct = Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 10 : 5);
          return (
            <div key={stage.label} className="flex items-center gap-3">
              <div className="w-[88px] shrink-0 text-xs font-semibold text-muted text-right">{stage.label}</div>
              <div className="flex-1 flex justify-center">
                <div
                  className="h-9 rounded-md flex items-center justify-center text-sm font-bold text-white transition-[width] duration-300"
                  style={{ width: `${widthPct}%`, minWidth: 44, background: text }}
                >
                  {stage.count}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {lost > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
          <span className="text-muted">Lost (dropped out of pipeline)</span>
          <span className="font-bold" style={{ color: statusColor("Lost").text }}>
            {lost}
          </span>
        </div>
      )}
    </div>
  );
}
