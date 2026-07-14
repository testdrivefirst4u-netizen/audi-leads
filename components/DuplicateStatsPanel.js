export default function DuplicateStatsPanel({ stats }) {
  const d = stats?.duplicateDetection;
  if (!d) return null;

  return (
    <>
      <h2 className="section-title">Duplicate Detection</h2>
      <div className="status-grid">
        <div className="card">
          <div className="label">Total Enquiries</div>
          <div className="value">{d.totalEnquiries}</div>
        </div>
        <div className="card">
          <div className="label">Unique Leads</div>
          <div className="value">{d.uniqueLeads}</div>
        </div>
        <div className="card">
          <div className="label">Duplicate Enquiries</div>
          <div className="value">{d.duplicateEnquiries}</div>
        </div>
        <div className="card">
          <div className="label">Repeat Enquiry Leads</div>
          <div className="value">{d.repeatEnquiryLeads}</div>
        </div>
        <div className="card">
          <div className="label">Customers Across Models</div>
          <div className="value">{d.customersAcrossModels}</div>
        </div>
      </div>
    </>
  );
}
