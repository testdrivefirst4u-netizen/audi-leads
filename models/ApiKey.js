const mongoose = require("mongoose");

// Every source names its fields differently (CarDekho's payload won't use the
// same keys as a website contact form) — this lets each key say "for MY
// source, the customer's name comes in the field called X" so the public
// ingestion endpoint (pages/api/public/leads.js) reads the right value
// regardless of what that integration happens to call it. Any entry left
// blank falls back to the endpoint's built-in alias guesser.
const FieldMappingSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    model: { type: String, default: "" },
    message: { type: String, default: "" },
    location: { type: String, default: "" },
  },
  { _id: false }
);

// One key per external lead source (CarDekho, CarWale, a website form...) per
// company — issued only by the super admin (see pages/api/companies/[id]/api-keys).
// The raw key is shown once at creation time and never stored in plaintext;
// only its SHA-256 hash is kept, so incoming requests are authenticated by
// hashing the presented key and looking up an exact match.
const ApiKeySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    sourceName: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    keyPrefix: { type: String, required: true }, // first chars of the raw key, for display only
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
    fieldMapping: { type: FieldMappingSchema, default: () => ({}) },
    // Basic abuse protection for the public ingestion endpoint. Empty
    // allowedIps means "no restriction" — most sources (CarDekho/CarWale)
    // push from a range of server IPs the dealer doesn't control, so this is
    // opt-in per key, not a default requirement.
    rateLimitPerMinute: { type: Number, default: 60 },
    allowedIps: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.models.ApiKey || mongoose.model("ApiKey", ApiKeySchema);
