const mongoose = require("mongoose");

const AgentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    active: { type: Boolean, default: true, index: true },
    // Which showroom this agent covers ("" = any/unassigned — falls back to
    // the general pool for auto-assignment). One of leadFields.js's
    // SHOWROOM_LOCATIONS, kept as a free string here since that list can grow.
    location: { type: String, default: "", index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Agent || mongoose.model("Agent", AgentSchema);
