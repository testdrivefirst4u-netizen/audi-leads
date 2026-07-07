const connectDB = require("./db");
const Admin = require("../models/Admin");
const { hashPassword } = require("./auth");

// Keeps the single admin account in sync with ADMIN_USERNAME/ADMIN_PASSWORD in
// .env. Re-running on every boot means rotating the password is just an env
// change + restart, no separate admin-management UI needed.
async function seedAdmin() {
  await connectDB();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn("[auth] ADMIN_USERNAME/ADMIN_PASSWORD not set — no admin account seeded.");
    return;
  }

  const passwordHash = await hashPassword(password);
  await Admin.findOneAndUpdate(
    { username },
    { username, passwordHash },
    { upsert: true, new: true }
  );
  console.log(`[auth] Admin account ready: ${username}`);
}

module.exports = { seedAdmin };
