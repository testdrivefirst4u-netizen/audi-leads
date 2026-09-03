const connectDB = require("../../../lib/db");
const Admin = require("../../../models/Admin");
const Agent = require("../../../models/Agent");
const { verifyPassword, signSessionToken, serializeSessionCookie } = require("../../../lib/auth");
const { ensureSeeded } = require("../../../lib/seedAdmin");
const { withTiming } = require("../../../lib/perfMonitor");
const { isLocked, recordFailure, resetLimit } = require("../../../lib/rateLimit");

// Locks a username out after this many failed attempts, for 15 minutes (see
// models/RateLimitHit.js's TTL) — keyed by the submitted username itself
// (not IP), so it protects every account type (super admin/admin/agent)
// uniformly regardless of which table it turns out to belong to.
const MAX_FAILED_ATTEMPTS = 5;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const rateLimitKey = `login:${String(username).toLowerCase().trim()}`;

  try {
    await connectDB();
    // On Vercel, server.js (which seeds the admin on boot) never runs, so
    // seed it here instead — but only once per warm instance (see
    // ensureSeeded), not on every login request.
    await ensureSeeded();

    if (await isLocked(rateLimitKey, MAX_FAILED_ATTEMPTS)) {
      return res.status(429).json({ error: "Too many failed login attempts. Try again in a few minutes." });
    }

    const admin = await Admin.findOne({ username });
    if (admin) {
      const valid = await verifyPassword(password, admin.passwordHash);
      if (!valid) {
        await recordFailure(rateLimitKey);
        return res.status(401).json({ error: "Invalid username or password" });
      }
      await resetLimit(rateLimitKey);

      // No companyId = the platform-level super admin; otherwise a company admin.
      if (!admin.companyId) {
        const token = signSessionToken({ sub: String(admin._id), username: admin.username, role: "super_admin" });
        res.setHeader("Set-Cookie", serializeSessionCookie(token));
        return res.status(200).json({ username: admin.username, role: "super_admin" });
      }

      const token = signSessionToken({
        sub: String(admin._id),
        username: admin.username,
        role: "admin",
        companyId: String(admin.companyId),
      });
      res.setHeader("Set-Cookie", serializeSessionCookie(token));
      return res.status(200).json({ username: admin.username, role: "admin" });
    }

    const agent = await Agent.findOne({ username, active: true });
    if (!agent) {
      await recordFailure(rateLimitKey);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const valid = await verifyPassword(password, agent.passwordHash);
    if (!valid) {
      await recordFailure(rateLimitKey);
      return res.status(401).json({ error: "Invalid username or password" });
    }
    await resetLimit(rateLimitKey);

    const token = signSessionToken({
      sub: String(agent._id),
      username: agent.username,
      name: agent.name,
      role: "agent",
      agentId: String(agent._id),
      companyId: String(agent.companyId),
    });
    res.setHeader("Set-Cookie", serializeSessionCookie(token));
    res.status(200).json({ username: agent.username, name: agent.name, role: "agent" });
  } catch (err) {
    // Full detail goes to the server log only — config problems (missing
    // AUTH_SECRET/MONGODB_URI, a bad Atlas connection string) are almost
    // always the cause of login failing right after a deploy, and whoever's
    // debugging that has log access; an anonymous caller hitting this
    // endpoint should never see internal error detail.
    console.error("[auth] login failed:", err);
    res.status(500).json({ error: "Server error. Please try again shortly." });
  }
}

export default withTiming("/api/auth/login", handler);
