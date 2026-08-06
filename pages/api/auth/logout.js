const { serializeClearCookie } = require("../../../lib/auth");
const { withTiming } = require("../../../lib/perfMonitor");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Set-Cookie", serializeClearCookie());
  res.status(200).json({ ok: true });
}

export default withTiming("/api/auth/logout", handler);
