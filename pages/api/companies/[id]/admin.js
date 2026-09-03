const connectDB = require("../../../../lib/db");
const Admin = require("../../../../models/Admin");
const Company = require("../../../../models/Company");
const { requireSuperAdmin, hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } = require("../../../../lib/auth");

// Manages a company's own admin account — separate from Company itself
// (branding/sheets/etc., in companies/[id].js) since this touches Admin,
// a different collection with its own uniqueness/password rules.
async function handler(req, res) {
  await connectDB();
  const { id } = req.query;

  const company = await Company.findById(id).select("_id").lean();
  if (!company) return res.status(404).json({ error: "Company not found" });

  if (req.method === "GET") {
    const admin = await Admin.findOne({ companyId: id }).select("username").lean();
    if (!admin) return res.status(404).json({ error: "This company has no admin account" });
    return res.status(200).json({ username: admin.username });
  }

  if (req.method === "PATCH") {
    // Passwords are bcrypt hashes — there's no way to "view" one, only reset
    // it to something new. The form this feeds only ever collects a fresh
    // password, never displays the existing one.
    const { username, password } = req.body || {};

    const update = {};
    if (username !== undefined) {
      const trimmed = String(username).trim();
      if (!trimmed) return res.status(400).json({ error: "Username can't be empty" });
      const admin = await Admin.findOne({ companyId: id }).select("_id").lean();
      if (!admin) return res.status(404).json({ error: "This company has no admin account" });
      const taken = await Admin.findOne({ username: trimmed, _id: { $ne: admin._id } }).select("_id").lean();
      if (taken) return res.status(409).json({ error: "That username is already taken" });
      update.username = trimmed;
    }
    if (password !== undefined && password !== "") {
      if (!isPasswordStrongEnough(password)) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }
      update.passwordHash = await hashPassword(password);
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const admin = await Admin.findOneAndUpdate({ companyId: id }, update, { new: true }).select("username").lean();
    if (!admin) return res.status(404).json({ error: "This company has no admin account" });

    return res.status(200).json({ username: admin.username });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdmin(handler);
