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

// Same idea, but for the platform-level super admin (manages Companies, has
// no companyId) — a completely separate account from any company's admin,
// so seeding/rotating it never touches Audi's (or any other company's) login.
async function seedSuperAdmin() {
  await connectDB();

  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!username || !password) return;

  const passwordHash = await hashPassword(password);
  await Admin.findOneAndUpdate(
    { username },
    { username, passwordHash },
    { upsert: true, new: true }
  );
  console.log(`[auth] Super admin account ready: ${username}`);
}

module.exports = { seedAdmin, seedSuperAdmin };
