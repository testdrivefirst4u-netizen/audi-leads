require("dotenv").config();

const { createServer } = require("http");
const next = require("next");

const connectDB = require("./lib/db");
const { startScheduler } = require("./lib/cron");
const { seedAdmin } = require("./lib/seedAdmin");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// This custom server is for local development only. It runs node-cron
// in-process and seeds the admin account on boot. It is NOT used in
// production on Vercel — Vercel deploys pages/api/* as serverless functions
// and ignores this file entirely, so Vercel Cron (vercel.json) drives the
// sync there instead, and the login route lazy-seeds the admin account.
app.prepare().then(async () => {
  await connectDB();
  await seedAdmin();

  const httpServer = createServer((req, res) => handle(req, res));

  await startScheduler();

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
