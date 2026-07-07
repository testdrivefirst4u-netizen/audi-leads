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

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
