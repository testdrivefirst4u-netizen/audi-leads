import Skeleton from "react-loading-skeleton";

const count = (pipeline, label) => pipeline?.find((p) => p.label === label)?.count ?? 0;
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// Worked out from where each lead stands now: a lead at Booking has also
// been contacted and test-driven; Lost leads count only as contacted.
export function conversionFigures(pipeline) {
  const total = (pipeline || []).reduce((sum, s) => sum + (s.count || 0), 0);
  const contacted = total - count(pipeline, "New");
  const booked = count(pipeline, "Booking") + count(pipeline, "Retail (Converted)");
  const testDrives = count(pipeline, "Test Drive") + booked;
  return { total, contacted, testDrives, booked };
}

/** Contacted → test drive → booked, as shares of the leads in view, plus test drive → booking. */
export function Conversion({ pipeline, loading }) {
  if (loading) return <Skeleton height={130} />;
  const { total, contacted, testDrives, booked } = conversionFigures(pipeline);
  const steps = [
    { label: "Contacted", value: contacted, hint: "moved past New" },
    { label: "Test drive", value: testDrives, hint: "reached a test drive" },
    { label: "Booked", value: booked, hint: "booking or sold" },
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {steps.map((s) => (
          <div key={s.label} className="rounded-xl bg-bg px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{s.label}</div>
            <div className="mt-1 text-[24px] font-bold text-ink leading-none">{pct(s.value, total)}%</div>
            <div className="mt-1.5 text-[11.5px] text-muted">
              {s.value} of {total} {s.hint}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct(s.value, total)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="m-0 mt-3 text-[12.5px] text-muted">
        Test drive → booking: <strong className="text-ink">{pct(booked, testDrives)}%</strong> ({booked} of {testDrives} test drives booked)
      </p>
    </>
  );
}

/** Per agent: leads held, % contacted, test drives, bookings — ranked by bookings (/api/stats agentBoard). */
export function AgentLeaderboard({ agents, loading }) {
  if (loading) return <Skeleton count={4} height={28} className="mb-1" />;
  if (!agents?.length) return <p className="m-0 text-[13px] text-muted">No leads are assigned to agents yet.</p>;
  const cell = "!px-2 !py-2";
  return (
    <div className="overflow-x-auto -mx-1 px-1">
    <table className="!text-[12.5px] min-w-[420px]">
      <thead>
        <tr>
          <th className={`${cell} !static`}>Agent</th>
          <th className={`${cell} !static text-right`}>Leads</th>
          <th className={`${cell} !static text-right`}>Contacted</th>
          <th className={`${cell} !static text-right`}>Test drives</th>
          <th className={`${cell} !static text-right`}>Booked</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((a, i) => (
          <tr key={a.name + i}>
            <td className={`${cell} font-semibold`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 mr-2 rounded-full text-[10.5px] font-bold ${i === 0 ? "bg-accent text-white" : "bg-accent/10 text-accent"}`}>{i + 1}</span>
              {a.name}
            </td>
            <td className={`${cell} text-right`}>{a.leads}</td>
            <td className={`${cell} text-right`}>{pct(a.contacted, a.leads)}%</td>
            <td className={`${cell} text-right`}>{a.testDrives}</td>
            <td className={`${cell} text-right font-bold`}>{a.bookings}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
