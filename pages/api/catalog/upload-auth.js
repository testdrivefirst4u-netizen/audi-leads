const { requireCompanyMember } = require("../../../lib/auth");
const { getImageKit } = require("../../../lib/imagekit");
const { canEditCatalog, companyFolder } = require("../../../lib/catalogInput");

// Brochures are often bigger than a serverless request body allows (Vercel
// caps at ~4.5 MB), so the browser uploads straight to ImageKit. This hands
// out a short-lived upload signature plus the company's own folder; the
// catalog API then only accepts URLs inside that folder.
async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!canEditCatalog(req.session)) return res.status(403).json({ error: "Only the company admin can upload catalog files" });
  if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_URL_ENDPOINT) {
    return res.status(503).json({ error: "File storage isn't configured on this server" });
  }
  const auth = getImageKit().getAuthenticationParameters();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ...auth, publicKey: process.env.IMAGEKIT_PUBLIC_KEY, folder: companyFolder(req.session.companyId) });
}

export default requireCompanyMember(handler);
