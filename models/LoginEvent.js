const mongoose = require("mongoose");

// One row per login attempt — successful or not — for the super admin's
// Login Activity page: who signed in (super admin / company admin / agent),
// from which company, IP, browser / OS / device, and where (when the host
// provides geo headers, as Vercel does). Failed attempts are kept too, with
// the username that was tried, so a brute-force pattern is visible.
//
// Written by pages/api/auth/login.js via lib/loginActivity.js. Never
// stores passwords or session tokens.
const LoginEventSchema = new mongoose.Schema(
  {
    success: { type: Boolean, required: true, index: true },
    reason: { type: String, default: "" }, // why it failed: "Invalid password", "Unknown username", "Locked out"…
    role: { type: String, enum: ["super_admin", "admin", "agent", "unknown"], default: "unknown", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    username: { type: String, default: "", index: true },
    name: { type: String, default: "" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    browser: { type: String, default: "" },
    os: { type: String, default: "" },
    deviceType: { type: String, enum: ["desktop", "mobile", "tablet", "bot", "unknown"], default: "unknown" },
    city: { type: String, default: "" },
    region: { type: String, default: "" },
    country: { type: String, default: "" },
  },
  { timestamps: true }
);

LoginEventSchema.index({ createdAt: -1 });
LoginEventSchema.index({ companyId: 1, createdAt: -1 });
// Keep a year of history; older rows expire on their own.
LoginEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.models.LoginEvent || mongoose.model("LoginEvent", LoginEventSchema);
