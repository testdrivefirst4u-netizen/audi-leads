import Skeleton from "react-loading-skeleton";

const count = (pipeline, label) => pipeline?.find((p) => p.label === label)?.count ?? 0;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * How leads convert, for managers: of the leads in view, how many got past
 * "New" (contacted), reached a test drive, and booked — plus test drive →
 * booking. Worked out from where each lead stands now (a lead at Booking has
 * also been contacted and test-driven); Lost leads count only as contacted.
 * Next to it, the agent leaderboard (admins only — /api/stats agentBoard).
 */
export default function DashboardInsights({ stats, loading, showAgents }) {
  const p = stats?.pipeline;
  const total = (p || []).reduce((sum, s) => sum + (s.count || 0), 0);
  const contacted = total - count(p, "New");
  const booked = count(p, "Booking") + count(p, "Retail (Converted)");
  const testDrives = count(p, "Test Drive") + booked;

  const steps = [
    { label: "Contacted", value: contacted, rate: pct(contacted, total), hint: "moved past New" },
    { label: "Test drive", value: testDrives, rate: pct(testDrives, total), hint: "reached a test drive" },
    { label: "Booked", value: booked, rate: pct(booked, total), hint: "booking or sold" },
  ];
  const agents = stats?.agentBoard || [];

  return (
    <div className={`grid gap-4 mb-6 ${showAgents ? "lg:grid-cols-[1.2fr_1fr]" : ""}`}>
      <div className="dash-panel mb-0">
        <h3>Conversion</h3>
        {loading ? (
          <Skeleton height={120} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {steps.map((s) => (
                <div key={s.label} className="rounded-xl bg-bg px-3.5 py-3">
                  <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{s.label}</div>
                  <div className="mt-1 text-[24px] font-bold text-ink leading-none">{s.rate}%</div>
                  <div className="mt-1.5 text-[11.5px] text-muted">
                    {s.value} of {total} {s.hint}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${s.rate}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="m-0 mt-3 text-[12.5px] text-muted">
              Test drive → booking: <strong className="text-ink">{pct(booked, testDrives)}%</strong> ({booked} of {testDrives} test drives booked)
            </p>
          </>
        )}
      </div>

      {showAgents && (
        <div className="dash-panel mb-0">
          <h3>Agent leaderboard</h3>
          {loading ? (
            <Skeleton count={4} height={28} className="mb-1" />
          ) : agents.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">No leads are assigned to agents yet.</p>
          ) : (
            <table className="!text-[12.5px]">
              <thead>
                <tr>
                  <th className="!px-2 !py-2 !static">Agent</th>
                  <th className="!px-2 !py-2 !static text-right">Leads</th>
                  <th className="!px-2 !py-2 !static text-right">Contacted</th>
                  <th className="!px-2 !py-2 !static text-right">Test drives</th>
                  <th className="!px-2 !py-2 !static text-right">Booked</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.name + i}>
                    <td className="!px-2 !py-2 font-semibold">
                      <span className="inline-flex items-center justify-center w-5 h-5 mr-2 rounded-full bg-accent/10 text-accent text-[10.5px] font-bold">{i + 1}</span>
                      {a.name}
                    </td>
                    <td className="!px-2 !py-2 text-right">{a.leads}</td>
                    <td className="!px-2 !py-2 text-right">{pct(a.contacted, a.leads)}%</td>
                    <td className="!px-2 !py-2 text-right">{a.testDrives}</td>
                    <td className="!px-2 !py-2 text-right font-bold">{a.bookings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
