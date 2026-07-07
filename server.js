require("dotenv").config();

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");

const connectDB = require("./lib/db");
const { startScheduler } = require("./lib/cron");
const { seedAdmin } = require("./lib/seedAdmin");
const { getSessionFromCookieHeader } = require("./lib/auth");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  await connectDB();
  await seedAdmin();

  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    path: "/api/socket",
  });

  io.use((socket, next) => {
    const session = getSessionFromCookieHeader(socket.handshake.headers.cookie);
    if (!session) return next(new Error("unauthorized"));
    socket.session = session;
    next();
  });

  io.on("connection", (socket) => {
    console.log("[socket] client connected:", socket.id, `(${socket.session.username})`);
  });

  // Exposed so API routes (e.g. Settings save) can push an immediate update.
  global._io = io;

  await startScheduler(io);

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
