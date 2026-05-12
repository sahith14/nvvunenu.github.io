import { z } from "zod";
import {
  assertMember, insertMessage, backlogSince,
  markDelivered, markReadUpTo, toggleReaction,
  enqueueOutbox, drainOutbox
} from "../services/chat.js";
import { addSocket, removeSocket, isOnline, socketIdsFor } from "../services/presence.js";
import { allow } from "../services/rateLimit.js";

// ---- Payload schemas (zod) ----
const SendSchema = z.object({
  conversationId: z.string().uuid(),
  clientMsgId:    z.string().min(1).max(64),
  type:           z.enum(["text","voice","image"]).default("text"),
  ciphertext:     z.string().min(1).max(200_000),
  iv:             z.string().min(1).max(64),
  keyVersion:     z.number().int().positive().default(1),
  replyTo:        z.string().uuid().optional(),
  expiresAt:      z.string().datetime().optional(),
  scheduledAt:    z.string().datetime().optional()
});

const JoinSchema = z.object({
  conversationId: z.string().uuid(),
  lastSeq:        z.number().int().nonnegative().default(0)
});

const TypingSchema = z.object({
  conversationId: z.string().uuid(),
  isTyping:       z.boolean()
});

const ReadSchema = z.object({
  conversationId: z.string().uuid(),
  upToSeq:        z.number().int().positive()
});

const ReactSchema = z.object({
  conversationId: z.string().uuid(),
  messageId:      z.string().uuid(),
  emoji:          z.string().min(1).max(16)
});

// ---- Room helpers ----
const roomOf = (conversationId) => `conv:${conversationId}`;

// ---- Handler registration ----
export function registerChatHandlers(io, socket) {
  const userId = socket.data.userId;

  // Presence: notify partner(s) once we know which convs this socket joins.
  // (Partner-level presence is broadcast per-room on join; global presence
  //  could be added via a dedicated 'presence:*' room keyed by partnerId.)

  socket.on("chat:join", async (raw, ack) => {
    try {
      const { conversationId, lastSeq } = JoinSchema.parse(raw);
      const m = await assertMember(userId, conversationId);
      if (!m) return ack?.({ ok: false, error: "FORBIDDEN" });

      socket.join(roomOf(conversationId));

      // Stream backlog
      const backlog = await backlogSince({ conversationId, lastSeq });

      // Flush outbox (read receipts, reactions queued while offline)
      const outbox = await drainOutbox(userId);

      ack?.({ ok: true, backlog, outbox, partnerOnline: isOnline(m.partnerId) });

      // Notify partner we came online in this room
      socket.to(roomOf(conversationId)).emit("chat:presence", { userId, online: true });
    } catch (e) {
      ack?.({ ok: false, error: "BAD_PAYLOAD", detail: e.message });
    }
  });

  socket.on("chat:leave", ({ conversationId } = {}) => {
    if (!conversationId) return;
    socket.leave(roomOf(conversationId));
    socket.to(roomOf(conversationId)).emit("chat:presence", { userId, online: false });
  });

  socket.on("chat:send", async (raw, ack) => {
    try {
      if (!allow(userId, "chat",
                 Number(process.env.CHAT_RATE_MAX) || 30,
                 Number(process.env.CHAT_RATE_WINDOW_MS) || 10_000)) {
        return ack?.({ ok: false, error: "RATE_LIMIT" });
      }
      const p = SendSchema.parse(raw);
      const m = await assertMember(userId, p.conversationId);
      if (!m) return ack?.({ ok: false, error: "FORBIDDEN" });

      // PRO-only fields guard
      if ((p.expiresAt || p.scheduledAt) && socket.data.tier !== "pro") {
        return ack?.({ ok: false, error: "PRO_REQUIRED" });
      }

      const { message, duplicate } = await insertMessage({ ...p, senderId: userId });

      // Ack sender with server id + seq (client uses this to reconcile optimistic msg)
      ack?.({
        ok: true, duplicate,
        messageId: message.id, seq: message.seq, createdAt: message.created_at
      });

      // Don't broadcast scheduled (future) messages yet — a worker will on flush.
      if (message.scheduled_at && new Date(message.scheduled_at) > new Date()) return;

      // Broadcast to room (partner receives)
      socket.to(roomOf(p.conversationId)).emit("chat:message", message);

      // If partner offline / not in room, queue a light "new message" hint for push.
      if (!isOnline(m.partnerId)) {
        await enqueueOutbox(m.partnerId, "chat:message_hint", {
          conversationId: p.conversationId, seq: message.seq
        });
      }
    } catch (e) {
      ack?.({ ok: false, error: "SEND_FAILED", detail: e.message });
    }
  });

  socket.on("chat:typing", (raw) => {
    try {
      const { conversationId, isTyping } = TypingSchema.parse(raw);
      socket.to(roomOf(conversationId)).emit("chat:typing", { userId, isTyping });
    } catch { /* ignore */ }
  });

  socket.on("chat:delivered", async ({ messageId } = {}, ack) => {
    try {
      const row = await markDelivered(messageId);
      if (!row) return ack?.({ ok: true, noop: true });
      const payload = { messageId: row.id, userId, ts: row.delivered_at };
      // Notify sender if online
      const senderSockets = socketIdsFor(row.sender_id);
      if (senderSockets.length) {
        io.to(senderSockets).emit("chat:delivered", payload);
      } else {
        await enqueueOutbox(row.sender_id, "chat:delivered", payload);
      }
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on("chat:read", async (raw, ack) => {
    try {
      const { conversationId, upToSeq } = ReadSchema.parse(raw);
      const m = await assertMember(userId, conversationId);
      if (!m) return ack?.({ ok: false, error: "FORBIDDEN" });
      const res = await markReadUpTo({ conversationId, readerId: userId, upToSeq });
      const payload = { conversationId, readerId: userId, upToSeq, readAt: res.readAt, count: res.count };

      // Broadcast to room (sender sees receipts)
      socket.to(roomOf(conversationId)).emit("chat:read", payload);

      // Queue for partner if offline (in case they're offline without room join)
      if (!isOnline(m.partnerId)) await enqueueOutbox(m.partnerId, "chat:read", payload);

      ack?.({ ok: true, ...res });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on("chat:react", async (raw, ack) => {
    try {
      const { conversationId, messageId, emoji } = ReactSchema.parse(raw);
      const m = await assertMember(userId, conversationId);
      if (!m) return ack?.({ ok: false, error: "FORBIDDEN" });
      const updated = await toggleReaction({ messageId, userId, emoji });
      const payload = { messageId, userId, emoji, reactions: updated.reactions };
      io.to(roomOf(conversationId)).emit("chat:reaction", payload);
      if (!isOnline(m.partnerId)) await enqueueOutbox(m.partnerId, "chat:reaction", payload);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on("disconnect", () => {
    const { userId: uid, wentOffline } = removeSocket(socket.id);
    if (wentOffline && uid) {
      // Notify all rooms this socket was in (Socket.IO already left them)
      socket.broadcast.emit("chat:presence", { userId: uid, online: false });
    }
  });

  // Register presence on connect
  addSocket(userId, socket.id);
}
