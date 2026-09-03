const { requireSuperAdmin } = require("../../../lib/auth");
const { getImageKit } = require("../../../lib/imagekit");

const MAX_BYTES = 3 * 1024 * 1024; // 3MB — a logo, not a photo library
const ALLOWED_MIME_RE = /^image\/(png|jpe?g|webp|svg\+xml)$/i;
// Allowlisted, not passed straight through from the client — this is the one
// piece of the request that flows into a filesystem-shaped ImageKit path.
const ALLOWED_FOLDERS = { "company-logos": "/company-logos", "admin-avatars": "/admin-avatars" };

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fileBase64, filename = "", mimeType = "", folder = "" } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: "No file provided" });
  if (mimeType && !ALLOWED_MIME_RE.test(mimeType)) {
    return res.status(400).json({ error: "Only PNG, JPG, WEBP, or SVG images are allowed" });
  }

  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: "Logo must be under 3MB" });
  }

  try {
    const imagekit = getImageKit();
    const result = await imagekit.upload({
      file: buffer,
      fileName: filename || `logo-${Date.now()}`,
      folder: ALLOWED_FOLDERS[folder] || "/company-logos",
      useUniqueFileName: true,
    });
    return res.status(200).json({ url: result.url });
  } catch (err) {
    console.error("ImageKit logo upload failed:", err);
    return res.status(500).json({ error: "Upload failed. Please try again." });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: "5mb" },
  },
};

export default requireSuperAdmin(handler);
