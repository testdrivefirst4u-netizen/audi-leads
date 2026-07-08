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
};
