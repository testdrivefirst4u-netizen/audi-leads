const connectDB = require("../../lib/db");
const Admin = require("../../models/Admin");
const {
  requireSuperAdmin,
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
  MIN_PASSWORD_LENGTH,
  signSessionToken,
  serializeSessionCookie,
} = require("../../lib/auth");

// Self-service account editing — scoped to the super admin only for now
// (req.session.sub identifies exactly one Admin document: their own).
async function handler(req, res) {
  await connectDB();

  if (req.method === "GET") {
    const admin = await Admin.findById(req.session.sub).select("username avatarUrl").lean();
    if (!admin) return res.status(404).json({ error: "Account not found" });
    return res.status(200).json({ username: admin.username, avatarUrl: admin.avatarUrl || "" });
  }

  if (req.method === "PATCH") {
    const { username, password, currentPassword, avatarUrl } = req.body || {};

    const update = {};
    if (username !== undefined) {
      const trimmed = String(username).trim();
      if (!trimmed) return res.status(400).json({ error: "Username can't be empty" });
      const taken = await Admin.findOne({ username: trimmed, _id: { $ne: req.session.sub } }).select("_id").lean();
      if (taken) return res.status(409).json({ error: "That username is already taken" });
      update.username = trimmed;
    }
    if (password !== undefined && password !== "") {
      if (!isPasswordStrongEnough(password)) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      }
      // Changing your OWN password (unlike a super-admin-issued reset on
      // someone else's account) requires proving you already know the
      // current one — otherwise anyone who got hold of an already-logged-in
      // session/browser could lock the real owner out.
      if (!currentPassword) {
        return res.status(400).json({ error: "Current password is required to set a new password" });
      }
      const admin = await Admin.findById(req.session.sub).select("passwordHash").lean();
      if (!admin) return res.status(404).json({ error: "Account not found" });
      const valid = await verifyPassword(currentPassword, admin.passwordHash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
      update.passwordHash = await hashPassword(password);
    }
    if (avatarUrl !== undefined) {
      update.avatarUrl = String(avatarUrl).trim();
    }

    const admin = await Admin.findByIdAndUpdate(req.session.sub, update, { new: true }).select("username avatarUrl").lean();
    if (!admin) return res.status(404).json({ error: "Account not found" });

    // The session cookie carries `username` for display everywhere — reissue
    // it so a rename takes effect immediately instead of showing stale until
    // the next login.
    const token = signSessionToken({ sub: String(admin._id), username: admin.username, role: "super_admin" });
    res.setHeader("Set-Cookie", serializeSessionCookie(token));

    return res.status(200).json({ username: admin.username, avatarUrl: admin.avatarUrl || "" });
  }

  res.status(405).json({ error: "Method not allowed" });
}

export default requireSuperAdmin(handler);
