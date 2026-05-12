import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server as IOServer } from "socket.io";

import { socketAuth } from "./middleware/auth.js";
import { registerChatHandlers } from "./sockets/chat.js";
import conversationsRoutes from "./routes/conversations.js";
import messagesRoutes from "./routes/messages.js";
import keysRoutes from "./routes/keys.js";

const PORT   = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || "*";

// ---- Express ----
const app = express();
app.use(helmet());
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/conversations", conversationsRoutes);
app.use("/messages", messagesRoutes);
app.use("/keys", keysRoutes);

// ---- HTTP + Socket.IO ----
const server = http.createServer(app);
const io = new IOServer(server, {
  cors:              { origin: ORIGIN, credentials: true },
  pingInterval:      20_000,
  pingTimeout:       25_000,
  maxHttpBufferSize: 1e6
});

io.use(socketAuth);
io.on("connection", (socket) => {
  registerChatHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log(`[bondsync] listening on :${PORT}`);
});
