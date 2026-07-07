const connectDB = require("../../../lib/db");
const Admin = require("../../../models/Admin");
const { verifyPassword, signSessionToken, serializeSessionCookie } = require("../../../lib/auth");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  await connectDB();
  const admin = await Admin.findOne({ username });
  if (!admin) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = signSessionToken({ sub: String(admin._id), username: admin.username });
  res.setHeader("Set-Cookie", serializeSessionCookie(token));
  res.status(200).json({ username: admin.username });
}
