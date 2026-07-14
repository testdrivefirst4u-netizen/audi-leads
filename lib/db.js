const dns = require("dns");
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/audi-dashboard";

// mongodb+srv:// requires a DNS SRV lookup. Some local/OS resolvers (seen here
// defaulting to 127.0.0.1) refuse SRV queries even though A-record lookups
// work fine, so prefer public DNS for SRV connection strings, falling back to
// the OS-configured servers if those are unreachable.
if (MONGODB_URI.startsWith("mongodb+srv://")) {
  dns.setServers([...new Set(["8.8.8.8", "1.1.1.1", ...dns.getServers()])]);
}

let cached = global._mongoose;
if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The SRV lookup (`_mongodb._tcp....`) that mongodb+srv:// needs occasionally
// fails with querySrv ECONNREFUSED on this machine even though the OS
// resolver (nslookup) resolves the exact same record fine at the same
// moment — a known flaky-c-ares-on-Windows pattern, not a wrong-DNS-server
// problem (dns.setServers below already matches the OS's configured
// servers). It reliably succeeds a moment later, so retry a few times with
// a short backoff instead of surfacing a 500 on the very first hiccup.
async function connectWithRetry(attempts = 4, delayMs = 800) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await mongoose.connect(MONGODB_URI);
    } catch (err) {
      const isDnsHiccup = err.code === "ECONNREFUSED" && /querySrv/i.test(err.syscall || "");
      if (!isDnsHiccup || i === attempts) throw err;
      await sleep(delayMs * i);
    }
  }
}

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = connectWithRetry().catch((err) => {
      // Clear the cached promise on failure so the next call retries with a
      // fresh connection attempt instead of replaying this same rejection
      // forever (a transient DNS/network hiccup on one attempt would
      // otherwise poison every request for the rest of the process's life).
      cached.promise = null;
      throw err;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
