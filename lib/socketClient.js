import { io } from "socket.io-client";

let socket;

// Single shared client-side Socket.IO connection used across the dashboard.
export function getSocket() {
  if (typeof window === "undefined") return null;
  if (!socket) {
    socket = io({ path: "/api/socket" });
  }
  return socket;
}
