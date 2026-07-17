import { useEffect, useMemo, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";
import Layout from "../components/Layout";
import CompanySwitcher from "../components/CompanySwitcher";
import VerticalBarChart from "../components/VerticalBarChart";
import CategoryPieChart from "../components/CategoryPieChart";
import SummaryTable from "../components/SummaryTable";
import { getSessionFromCookieHeader } from "../lib/auth";
import { getCompanyBranding } from "../lib/companyBranding";
import { apiFetch } from "../lib/apiFetch";
import { categoricalColor, consolidateTopN } from "../lib/chartPalette";
import { statusChartColor } from "../lib/leadFields";
import { svgToImageDataUrl, downloadDataUrl } from "../lib/chartToImage";

export async function getServerSideProps(context) {
  const session = getSessionFromCookieHeader(context.req.headers.cookie);
  if (!session) return { redirect: { destination: "/login", permanent: false } };
  // Super admin isn't redirected away anymore — they get a read-only,
  // company-picker-driven view of this same reports page.
  if (session.role === "super_admin") {
    return { props: { username: session.username, role: "super_admin" } };
  }
  const branding = await getCompanyBranding(session.companyId);
  return { props: { username: session.username, role: session.role || "admin", ...branding } };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const REPORT_TYPES = [
  { key: "model", title: "Model-wise Lead Report", dataKey: "byModel" },
  { key: "showroom", title: "Showroom-wise Lead Report", dataKey: "byShowroom" },
  { key: "source", title: "Lead Source Report", dataKey: "bySource" },
  { key: "status", title: "Lead Status Report", dataKey: "byStatus" },
];

export default function ReportsPage({ username, role, companyName, companyLogoUrl, companyBrandColor }) {
  const isSuperAdminView = role === "super_admin";
  const [viewCompanyId, setViewCompanyId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [reportType, setReportType] = useState("model");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportingRaw, setExportingRaw] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [imageBusy, setImageBusy] = useState(null); // "png" | "jpg" | null

  const barRef = useRef(null);
  const pieRef = useRef(null);

  // One hidden bar+pie pair per report type, always mounted (regardless of
  // which tab is active) so "Download All Reports" can rasterize every
  // type's charts without visibly switching tabs first. Off-screen, not
  // display:none — rasterization serializes the SVG's own XML (viewBox +
  // inline styles), so visibility doesn't affect the output, only whether
  // the element is laid out/mounted at all.
  const hiddenBarRefs = useRef({});
  const hiddenPieRefs = useRef({});

  async function fetchReport(m) {
    if (isSuperAdminView && !viewCompanyId) return;
    const params = new URLSearchParams({ month: m });
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    const res = await apiFetch(`/api/reports?${params.toString()}`);
    setReport(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    fetchReport(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, viewCompanyId]);

  const activeType = REPORT_TYPES.find((t) => t.key === reportType);

  function rowsForType(type) {
    if (!report) return [];
    const raw = report[type.dataKey] || [];
    return consolidateTopN(raw, 7);
  }

  function colorForType(type) {
    return type.key === "status" ? (label) => statusChartColor(label) : (label, i) => categoricalColor(i, label);
  }

  const rows = useMemo(() => rowsForType(activeType), [report, activeType]);
  const colorFor = colorForType(activeType);

  const total = rows.reduce((sum, r) => sum + r.count, 0);

  function companyParam(params) {
    if (isSuperAdminView) params.set("companyId", viewCompanyId);
    return params;
  }

  async function handleExportRaw() {
    setExportingRaw(true);
    try {
      const start = `${month}-01`;
      const endDate = new Date(`${month}-01T00:00:00Z`);
      endDate.setUTCMonth(endDate.getUTCMonth() + 1);
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      const end = endDate.toISOString().slice(0, 10);

      const params = companyParam(new URLSearchParams({ from: start, to: end }));
      const res = await apiFetch(`/api/leads/export?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, `leads-report-${month}.xlsx`);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || "Export failed");
    } finally {
      setExportingRaw(false);
    }
  }

  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      const [barImage, pieImage] = await Promise.all([
        svgToImageDataUrl(barRef.current, { format: "png" }),
        svgToImageDataUrl(pieRef.current, { format: "png" }),
      ]);
      const params = companyParam(new URLSearchParams());
      const res = await apiFetch(`/api/reports/export?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportTitle: activeType.title,
          dateRange: report.dateRange,
          filtersApplied: report.filtersApplied,
          rows,
          valueLabel: "Leads",
          barImage,
          pieImage,
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, `${reportType}-report-${month}.xlsx`);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || "Export failed");
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const [barImage, pieImage] = await Promise.all([
        svgToImageDataUrl(barRef.current, { format: "png" }),
        svgToImageDataUrl(pieRef.current, { format: "png" }),
      ]);

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.setFontSize(16);
      doc.text(activeType.title, 40, 40);
      doc.setFontSize(10);
      doc.text(`Date Range: ${report.dateRange.from} to ${report.dateRange.to}`, 40, 60);
      const filtersText =
        Object.entries(report.filtersApplied || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "None";
      doc.text(`Filters Applied: ${filtersText}`, 40, 75);
      doc.text(`Generated At: ${new Date().toLocaleString()}`, 40, 90);

      autoTable(doc, {
        startY: 105,
        head: [["Category", "Leads", "Percentage"]],
        body: [...rows.map((r) => [r.label, r.count, `${r.percentage}%`]), ["Total", total, "100%"]],
      });

      const afterTableY = doc.lastAutoTable.finalY + 24;
      doc.setFontSize(12);
      doc.text("Bar Chart", 40, afterTableY);
      doc.addImage(barImage, "PNG", 40, afterTableY + 10, 260, 130);
      doc.text("Pie Chart", 330, afterTableY);
      doc.addImage(pieImage, "PNG", 330, afterTableY + 10, 200, 200);

      doc.save(`${reportType}-report-${month}.pdf`);
    } catch (err) {
      alert(err.message || "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleDownloadImage(ref, format, chartName) {
    setImageBusy(format);
    try {
      const dataUrl = await svgToImageDataUrl(ref.current, { format });
      downloadDataUrl(dataUrl, `${reportType}-${chartName}-${month}.${format}`);
    } catch (err) {
      alert(err.message || "Image download failed");
    } finally {
      setImageBusy(null);
    }
  }

  // Rasterizes all 4 report types' charts (via the always-mounted hidden
  // pairs below, not the visible tab) and sends them together so the export
  // endpoint can build one workbook with a sheet per report type — no tab
  // switching, no flicker.
  async function handleExportAll() {
    setExportingAll(true);
    try {
      const reportsPayload = await Promise.all(
        REPORT_TYPES.map(async (t) => {
          const barEl = hiddenBarRefs.current[t.key];
          const pieEl = hiddenPieRefs.current[t.key];
          const [barImage, pieImage] = await Promise.all([
            svgToImageDataUrl(barEl, { format: "png" }),
            svgToImageDataUrl(pieEl, { format: "png" }),
          ]);
          return {
            reportTitle: t.title,
            rows: rowsForType(t),
            valueLabel: "Leads",
            barImage,
            pieImage,
          };
        })
      );

      const params = companyParam(new URLSearchParams());
      const res = await apiFetch(`/api/reports/export?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRange: report.dateRange,
          filtersApplied: report.filtersApplied,
          reports: reportsPayload,
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, `all-reports-${month}.xlsx`);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || "Export failed");
    } finally {
      setExportingAll(false);
    }
  }

  return (
    <Layout username={username} role={role} companyName={companyName} companyLogoUrl={companyLogoUrl} companyBrandColor={companyBrandColor}>
      <h1 className="page-title">Reports</h1>

      {isSuperAdminView && <CompanySwitcher companyId={viewCompanyId} onChange={setViewCompanyId} />}

      <div className="report-type-tabs">
        {REPORT_TYPES.map((t) => (
          <button
            key={t.key}
            className={`report-type-tab${reportType === t.key ? " active" : ""}`}
            onClick={() => setReportType(t.key)}
          >
            {t.title}
          </button>
        ))}
      </div>

      <div className="table-toolbar rounded-xl border border-border mb-5">
        <div className="toolbar-group">
          <label className="toolbar-label">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={currentMonth()} />
        </div>
        <button className="btn-sm btn-export" onClick={handleExportExcel} disabled={exportingExcel || loading}>
          {exportingExcel ? "Exporting..." : "Export Excel (.xlsx)"}
        </button>
        <button className="btn-sm btn-export" onClick={handleExportPdf} disabled={exportingPdf || loading}>
          {exportingPdf ? "Exporting..." : "Export PDF"}
        </button>
        <button className="btn-sm" onClick={handleExportRaw} disabled={exportingRaw}>
          {exportingRaw ? "Exporting..." : "Download Raw Leads (.xlsx)"}
        </button>
        <button className="btn-sm btn-export" onClick={handleExportAll} disabled={exportingAll || loading}>
          {exportingAll ? "Exporting..." : "Download All Reports (.xlsx)"}
        </button>
      </div>

      {report && (
        <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1, overflow: "hidden" }}>
          {REPORT_TYPES.map((t) => (
            <div key={t.key}>
              <VerticalBarChart
                ref={(el) => {
                  hiddenBarRefs.current[t.key] = el;
                }}
                data={rowsForType(t)}
                colorFor={colorForType(t)}
              />
              <CategoryPieChart
                ref={(el) => {
                  hiddenPieRefs.current[t.key] = el;
                }}
                data={rowsForType(t)}
                colorFor={colorForType(t)}
              />
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <>
          <Skeleton height={28} width={220} className="mb-3" />
          <div className="chart-row">
            <div className="chart-section">
              <Skeleton height={260} />
            </div>
            <div className="chart-section">
              <Skeleton height={260} />
            </div>
          </div>
          <Skeleton height={200} />
        </>
      ) : report && (
        <>
          <h2 className="section-title">
            {activeType.title} — {monthLabel(month)}
          </h2>

          <div className="chart-row">
            <div className="chart-section">
              <div className="chart-section-header">
                <h3>Vertical Bar Chart</h3>
                <div className="chart-image-actions">
                  <button className="btn-sm" disabled={!!imageBusy} onClick={() => handleDownloadImage(barRef, "png", "bar")}>
                    {imageBusy === "png" ? "..." : "PNG"}
                  </button>
                  <button className="btn-sm" disabled={!!imageBusy} onClick={() => handleDownloadImage(barRef, "jpg", "bar")}>
                    {imageBusy === "jpg" ? "..." : "JPG"}
                  </button>
                </div>
              </div>
              <VerticalBarChart ref={barRef} data={rows} colorFor={colorFor} />
            </div>
            <div className="chart-section">
              <div className="chart-section-header">
                <h3>Pie Chart</h3>
                <div className="chart-image-actions">
                  <button className="btn-sm" disabled={!!imageBusy} onClick={() => handleDownloadImage(pieRef, "png", "pie")}>
                    {imageBusy === "png" ? "..." : "PNG"}
                  </button>
                  <button className="btn-sm" disabled={!!imageBusy} onClick={() => handleDownloadImage(pieRef, "jpg", "pie")}>
                    {imageBusy === "jpg" ? "..." : "JPG"}
                  </button>
                </div>
              </div>
              <CategoryPieChart ref={pieRef} data={rows} colorFor={colorFor} />
            </div>
          </div>

          <div className="chart-section">
            <h3>Summary Table</h3>
            <SummaryTable rows={rows} />
          </div>
        </>
      )}
    </Layout>
  );
}
