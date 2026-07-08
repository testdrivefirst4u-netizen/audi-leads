const connectDB = require("../../../lib/db");
const Admin = require("../../../models/Admin");
const { verifyPassword, signSessionToken, serializeSessionCookie } = require("../../../lib/auth");
const { seedAdmin } = require("../../../lib/seedAdmin");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    await connectDB();
    // On Vercel, server.js (which seeds the admin on boot) never runs, so seed
    // it here instead. Idempotent and cheap — safe to run on every login.
    await seedAdmin();

    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = signSessionToken({ sub: String(admin._id), username: admin.username });
    res.setHeader("Set-Cookie", serializeSessionCookie(token));
    res.status(200).json({ username: admin.username });
  } catch (err) {
    // Surface config problems (missing AUTH_SECRET/MONGODB_URI, bad Atlas
    // connection string, etc.) as a clear message instead of a bare 500 —
    // these are almost always the cause of login failing right after deploy.
    console.error("[auth] login failed:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
