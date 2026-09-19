const mongoose = require("mongoose");

const AgentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    active: { type: Boolean, default: true, index: true },
    // Which showroom locations this agent covers — empty means "any"
    // (general pool) for auto-assignment. Values come from the company's own
    // location options (Settings.locationOptions / discovered lead locations)
    // or leadFields.js's SHOWROOM_LOCATIONS; kept as free strings since those
    // lists can grow. `location` is the pre-multi-select single value, still
    // written (as locations[0]) so anything reading it keeps working.
    locations: { type: [String], default: [], index: true },
    location: { type: String, default: "", index: true },
    lastSeenAt: { type: Date },
    // Shown to customers as {{agent_phone}} in campaign messages (optional).
    phone: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Agent || mongoose.model("Agent", AgentSchema);
