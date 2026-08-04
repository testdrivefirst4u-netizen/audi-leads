const connectDB = require("./db");
const Company = require("../models/Company");
const { withCache } = require("./serverCache");

// Company name/logo/brand color change rarely (only when a super admin
// edits Settings) but this runs in EVERY company-scoped page's
// getServerSideProps — i.e. on every single navigation, for every logged-in
// user. A short cache trades a few minutes of staleness on a branding edit
// (which nobody expects to propagate instantly to other sessions anyway)
// for cutting out a DB round trip on most page loads.
const BRANDING_CACHE_MS = 5 * 60 * 1000;

// Used by every company-scoped page's getServerSideProps to thread the
// logged-in user's company name/logo down through Layout -> Sidebar. Returns
// nulls for a super admin (no companyId) or if somehow the company lookup
// fails — Sidebar falls back to sensible defaults either way.
async function getCompanyBranding(companyId) {
  if (!companyId) return { companyName: null, companyLogoUrl: null, companyBrandColor: null };
  return withCache(`branding:${companyId}`, BRANDING_CACHE_MS, async () => {
    await connectDB();
    const company = await Company.findById(companyId).select("name logoUrl brandColor").lean();
    if (!company) return { companyName: null, companyLogoUrl: null, companyBrandColor: null };
    return {
      companyName: company.name,
      companyLogoUrl: company.logoUrl || null,
      companyBrandColor: company.brandColor || null,
    };
  });
}

module.exports = { getCompanyBranding };
