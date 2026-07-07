const { serializeClearCookie } = require("../../../lib/auth");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Set-Cookie", serializeClearCookie());
  res.status(200).json({ ok: true });
}
