// ---------------------------------------------------------------
// BondSync chat client (thin SDK for web + RN).
// Handles: socket lifecycle, optimistic send, retries, ordering,
// offline queue, decryption via e2ee helpers.
// ---------------------------------------------------------------
import { io } from "socket.io-client";
import {
  encryptMessage, decryptMessage, unwrapConvKey, importPrivateKey
} from "./e2ee.js";

const uuid = () =>
  (crypto.randomUUID?.() ??
   ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
     (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16)));

export function createChatClient({ url, token, storage }) {
  const socket = io(url, { auth: { token }, transports: ["websocket"], reconnection: true });

  const state = {
    convKey: null,                      // imported AES CryptoKey (current)
    privateKey: null,                   // imported RSA private CryptoKey
    conversationId: null,
    lastSeq: 0,
    pending: new Map(),                 // clientMsgId -> {resolve, reject, timer}
    listeners: { message: [], typing: [], read: [], reaction: [], presence: [], delivered: [] }
  };

  const on = (ev, fn) => { state.listeners[ev]?.push(fn); return () => {
    const arr = state.listeners[ev]; if (!arr) return;
    const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
  }; };
  const emit = (ev, data) => state.listeners[ev]?.forEach(fn => { try { fn(data); } catch {} });

  async function decryptInbound(msg) {
    if (!state.convKey) return { ...msg, plaintext: null };
    try {
      const plaintext = await decryptMessage(state.convKey, msg.ciphertext, msg.iv);
      return { ...msg, plaintext };
    } catch {
      return { ...msg, plaintext: null, decryptError: true };
    }
  }

  // ---- Socket events ----
  socket.on("chat:message", async (msg) => {
    if (msg.seq > state.lastSeq) state.lastSeq = msg.seq;
    emit("message", await decryptInbound(msg));
    socket.emit("chat:delivered", { messageId: msg.id });
  });
  socket.on("chat:typing",   (d) => emit("typing", d));
  socket.on("chat:read",     (d) => emit("read", d));
  socket.on("chat:reaction", (d) => emit("reaction", d));
  socket.on("chat:presence", (d) => emit("presence", d));
  socket.on("chat:delivered",(d) => emit("delivered", d));

  socket.on("connect_error", (err) => console.warn("[chat] connect_error", err.message));

  // ---- API ----
  async function setup({ conversationId, wrappedKeyB64, privateKeyB64 }) {
    state.conversationId = conversationId;
    state.privateKey     = await importPrivateKey(privateKeyB64);
    state.convKey        = await unwrapConvKey(state.privateKey, wrappedKeyB64);
    state.lastSeq        = Number(await storage?.get?.(`seq:${conversationId}`) || 0);
  }

  function join() {
    return new Promise((resolve, reject) => {
      socket.emit("chat:join",
        { conversationId: state.conversationId, lastSeq: state.lastSeq },
        async (res) => {
          if (!res?.ok) return reject(new Error(res?.error || "JOIN_FAILED"));
          const backlog = await Promise.all(res.backlog.map(decryptInbound));
          backlog.forEach(m => {
            if (m.seq > state.lastSeq) state.lastSeq = m.seq;
            emit("message", m);
          });
          // Drain outbox events
          for (const ev of res.outbox || []) {
            const name = ev.event_type.split(":")[1];
            emit(name, ev.payload);
          }
          await storage?.set?.(`seq:${state.conversationId}`, state.lastSeq);
          resolve({ backlogCount: backlog.length, partnerOnline: res.partnerOnline });
        });
    });
  }

  async function send(plaintext, { replyTo, expiresAt } = {}) {
    if (!state.convKey) throw new Error("E2EE not initialized");
    const { ciphertext, iv } = await encryptMessage(state.convKey, plaintext);
    const clientMsgId = uuid();

    // Optimistic local echo
    const optimistic = {
      id: null, clientMsgId, conversation_id: state.conversationId,
      sender_id: "me", type: "text", plaintext,
      created_at: new Date().toISOString(), pending: true
    };
    emit("message", optimistic);

    return new Promise((resolve, reject) => {
      const retry = (attempt = 0) => {
        socket.emit("chat:send", {
          conversationId: state.conversationId,
          clientMsgId, type: "text",
          ciphertext, iv, keyVersion: 1,
          replyTo, expiresAt
        }, (ack) => {
          if (ack?.ok) {
            if (ack.seq > state.lastSeq) state.lastSeq = ack.seq;
            storage?.set?.(`seq:${state.conversationId}`, state.lastSeq);
            resolve({ clientMsgId, ...ack });
          } else if (attempt < 3 && ack?.error !== "FORBIDDEN" && ack?.error !== "PRO_REQUIRED") {
            setTimeout(() => retry(attempt + 1), 500 * (attempt + 1));
          } else {
            reject(new Error(ack?.error || "SEND_FAILED"));
          }
        });
      };
      retry();
    });
  }

  const typing = (isTyping) =>
    socket.emit("chat:typing", { conversationId: state.conversationId, isTyping });

  const markRead = (upToSeq) =>
    new Promise(r => socket.emit("chat:read",
      { conversationId: state.conversationId, upToSeq }, r));

  const react = (messageId, emoji) =>
    new Promise(r => socket.emit("chat:react",
      { conversationId: state.conversationId, messageId, emoji }, r));

  return { socket, setup, join, send, typing, markRead, react, on,
           get lastSeq() { return state.lastSeq; } };
}
