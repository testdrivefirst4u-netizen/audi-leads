const { getReport, reset } = require("../../../lib/perfMonitor");
const { requireSuperAdmin } = require("../../../lib/auth");

// Diagnostic-only endpoint exposing the in-memory API/Mongo timing samples
// collected by lib/perfMonitor.js — super-admin gated since it's an
// operational tool, not part of the product. GET to read, DELETE to clear
// the buffers before a fresh measurement pass.
async function handler(req, res) {
  if (req.method === "DELETE") {
    reset();
    return res.status(200).json({ cleared: true });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.status(200).json(getReport());
}

export default requireSuperAdmin(handler);
