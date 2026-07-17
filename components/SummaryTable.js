export default function SummaryTable({ rows, valueLabel = "Leads" }) {
  if (!rows || rows.length === 0) {
    return <div className="empty-state">No data yet</div>;
  }
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>{valueLabel}</th>
            <th>Percentage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}</td>
              <td>{row.percentage}%</td>
            </tr>
          ))}
          <tr>
            <td className="font-bold">Total</td>
            <td className="font-bold">{total}</td>
            <td className="font-bold">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
