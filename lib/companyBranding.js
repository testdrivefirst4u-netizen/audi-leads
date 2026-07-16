const connectDB = require("./db");
const Company = require("../models/Company");

// Used by every company-scoped page's getServerSideProps to thread the
// logged-in user's company name/logo down through Layout -> Sidebar. Returns
// nulls for a super admin (no companyId) or if somehow the company lookup
// fails — Sidebar falls back to sensible defaults either way.
async function getCompanyBranding(companyId) {
  if (!companyId) return { companyName: null, companyLogoUrl: null, companyBrandColor: null };
  await connectDB();
  const company = await Company.findById(companyId).select("name logoUrl brandColor").lean();
  if (!company) return { companyName: null, companyLogoUrl: null, companyBrandColor: null };
  return {
    companyName: company.name,
    companyLogoUrl: company.logoUrl || null,
    companyBrandColor: company.brandColor || null,
  };
}

module.exports = { getCompanyBranding };
