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

// seedAdmin/seedSuperAdmin each do a bcrypt hash (deliberately CPU-expensive
// — same cost as the real password check) plus a DB write, unconditionally,
// every time they're called. They're called from the login handler on every
// single login attempt, which meant every login paid for 2 extra bcrypt
// hashes + 2 extra writes on top of the real credential check. Since the
// only thing these actually need to do is keep the seeded account in sync
// with .env, and that can only change on a fresh deploy/restart (not
// mid-instance), running them once per warm serverless instance — not once
// per request — keeps the exact same "env change + restart rotates the
// password" behavior while skipping the repeat cost entirely.
let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  await seedAdmin();
  await seedSuperAdmin();
  seeded = true;
}

module.exports = { seedAdmin, seedSuperAdmin, ensureSeeded };
