const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const COOKIE_NAME = "audi_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Add it to .env (local) or your host's environment variables (e.g. Vercel project settings).");
  }
  return secret;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signSessionToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: SESSION_MAX_AGE });
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

function serializeSessionCookie(token) {
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

function serializeClearCookie() {
  return cookie.serialize(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

// Reads and verifies the session token from a raw `Cookie` header string
// (works for both Next.js API req.headers.cookie and Socket.IO handshake headers).
function getSessionFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const parsed = cookie.parse(cookieHeader);
  const token = parsed[COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

// Wraps a Next.js API route handler so it 401s unless a valid session cookie
// is present, and turns any uncaught error (bad MONGODB_URI, missing env
// vars, etc.) into a readable JSON message instead of a bare 500.
function requireAuth(handler) {
  return async function wrapped(req, res) {
    const session = getSessionFromCookieHeader(req.headers.cookie);
    if (!session) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    req.session = session;
    try {
      return await handler(req, res);
    } catch (err) {
      console.error(`[api] ${req.url} failed:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: `Server error: ${err.message}` });
      }
    }
  };
}

// Same as requireAuth, but 403s unless the session belongs to the admin
// account — for sheet/agent configuration and sync internals that agents
// shouldn't be able to see or change. Sessions issued before agent accounts
// existed have no `role` claim at all — treated as admin (that's what every
// session was, implicitly, back when there was only ever one login).
function requireAdmin(handler) {
  return requireAuth(async function wrapped(req, res) {
    if (req.session.role && req.session.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    return handler(req, res);
  });
}

// For platform-level endpoints (managing Companies) — only the super admin
// (the Admin account with no companyId) may call these, not company admins
// or agents.
function requireSuperAdmin(handler) {
  return requireAuth(async function wrapped(req, res) {
    if (req.session.role !== "super_admin") {
      return res.status(403).json({ error: "Super admin access required" });
    }
    return handler(req, res);
  });
}

// Every lead/agent/settings/sync endpoint filters its queries by
// req.session.companyId — but the super admin's session has no companyId at
// all (they don't belong to any company). Relying on "undefined happens to
// match nothing" in every one of those queries is fragile and easy to get
// wrong in a new query later, so this rejects super-admin sessions up front,
// explicitly, before any handler that assumes a companyId runs.
function requireCompanyMember(handler) {
  return requireAuth(async function wrapped(req, res) {
    if (!req.session.companyId) {
      return res.status(403).json({ error: "This account is not a member of a company" });
    }
    return handler(req, res);
  });
}

// For GET-only, read-side endpoints (Leads/Dashboard/Reports) that the super
// admin should be able to monitor across every company without being able to
// change anything. A super-admin session has no companyId of its own, so it
// must pass ?companyId=<id> explicitly, naming which company to look at;
// this wrapper validates that id and scopes the request to it exactly like
// requireCompanyMember does for a real company member. Mutation endpoints
// (assign/status/remarks/calls/followups, agent management, etc.) must keep
// using requireCompanyMember — a super-admin session is rejected there,
// which is what actually makes this a *view*, not edit, capability.
function requireCompanyMemberOrSuperAdminView(handler) {
  return requireAuth(async function wrapped(req, res) {
    if (req.session.role === "super_admin") {
      const viewCompanyId = req.query.companyId;
      if (!viewCompanyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      // Lazy require to avoid a require-cycle at module load time (models
      // pull in mongoose/db, which some callers of lib/auth.js don't need).
      const Company = require("../models/Company");
      const company = await Company.findById(viewCompanyId).select("_id").lean();
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }
      req.session.companyId = viewCompanyId;
      return handler(req, res);
    }
    if (!req.session.companyId) {
      return res.status(403).json({ error: "This account is not a member of a company" });
    }
    return handler(req, res);
  });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  serializeSessionCookie,
  serializeClearCookie,
  getSessionFromCookieHeader,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireCompanyMember,
  requireCompanyMemberOrSuperAdminView,
};
