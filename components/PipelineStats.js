import { statusColor } from "../lib/leadFields";

export default function PipelineStats({ pipeline }) {
  if (!pipeline) return null;

  return (
    <div className="status-grid">
      {pipeline.map(({ label, count }) => {
        const { text } = statusColor(label);
        return (
          <div className="card" key={label}>
            <div className="label">{label}</div>
            <div className="value" style={{ color: text }}>
              {count}
            </div>
          </div>
        );
      })}
    </div>
  );
}
