const LoginEvent = require("../models/LoginEvent");
const Admin = require("../models/Admin");
const Agent = require("../models/Agent");

// Login audit + "last seen" tracking. The login route records every
// attempt; requireAuth() (lib/auth.js) touches lastSeenAt on the user's
// record at most once per LAST_SEEN_THROTTLE_MS per process, so "online
// now" on the Login Activity page costs one tiny write every few minutes
// per active user instead of one per request.

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

// Tiny user-agent classifier — enough to show "Chrome · Android · Mobile"
// without pulling in a UA-parsing dependency.
function parseUserAgent(ua = "") {
  const s = String(ua);
  let browser = "";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser/.test(s)) browser = "Samsung Internet";
  else if (/Chrome\//.test(s) && !/Chromium/.test(s)) browser = "Chrome";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  else if (/MSIE|Trident/.test(s)) browser = "Internet Explorer";

  let os = "";
  if (/Windows NT 10|Windows NT 11/.test(s)) os = "Windows";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Android/.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Mac OS X/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";

  let deviceType = "desktop";
  if (/bot|crawler|spider|curl|wget|python-requests|node-fetch|undici/i.test(s)) deviceType = "bot";
  else if (/iPad|Tablet|Android(?!.*Mobile)/.test(s)) deviceType = "tablet";
  else if (/Mobi|iPhone|Android.*Mobile/.test(s)) deviceType = "mobile";
  if (!s) deviceType = "unknown";
  return { browser, os, deviceType };
}

// Vercel adds these on every request; other hosts leave them empty.
function geoFromHeaders(req) {
  const h = req.headers;
  const dec = (v) => (v ? decodeURIComponent(String(v)) : "");
  return { city: dec(h["x-vercel-ip-city"]), region: dec(h["x-vercel-ip-country-region"]), country: dec(h["x-vercel-ip-country"]) };
}

async function recordLogin(req, { success, reason = "", role = "unknown", userId, username = "", name = "", companyId }) {
  try {
    const ua = String(req.headers["user-agent"] || "");
    await LoginEvent.create({
      success,
      reason,
      role,
      userId: userId || undefined,
      username: String(username || "").slice(0, 120),
      name,
      companyId: companyId || undefined,
      ip: clientIp(req),
      userAgent: ua.slice(0, 500),
      ...parseUserAgent(ua),
      ...geoFromHeaders(req),
    });
  } catch (err) {
    // Auditing must never break logging in.
    console.error("[login-activity] failed to record:", err.message);
  }
}

const LAST_SEEN_THROTTLE_MS = 3 * 60 * 1000;
const lastSeenTouched = new Map(); // "role:id" -> timestamp

async function touchLastSeen(session) {
  if (!session?.sub) return;
  const key = `${session.role}:${session.sub}`;
  const now = Date.now();
  if (now - (lastSeenTouched.get(key) || 0) < LAST_SEEN_THROTTLE_MS) return;
  lastSeenTouched.set(key, now);
  try {
    const Model = session.role === "agent" ? Agent : Admin;
    await Model.updateOne({ _id: session.sub }, { $set: { lastSeenAt: new Date() } });
  } catch (err) {
    console.error("[login-activity] lastSeen update failed:", err.message);
  }
}

module.exports = { recordLogin, touchLastSeen, parseUserAgent, clientIp };
