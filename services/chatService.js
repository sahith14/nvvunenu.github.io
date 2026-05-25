// =====================================================================
// Chat Service — real-time, scalable, Firestore-optimized.
//
// Data model (unchanged, but now written atomically):
//   chats/{chatId}                               doc
//     members:    [uid1, uid2]                   array
//     coupleId:   "uid1_uid2"                    string (canonical)
//     lastMessage, lastMessageTime, lastMessageSender
//     unread:     { [uid]: number }              map
//     typing:     { [uid]: boolean }             map
//   chats/{chatId}/messages/{msgId}              subcol
//     text, sender, time(serverTs),
//     status: "sent" | "delivered" | "seen",      <- simple scalar
//     deliveredAt, seenAt,
//     reactions: { [uid]: "❤️" }                  map
//
// Optimizations:
// - One batched write per message (insert + chat meta) via `writeBatch`.
// - Delivery/Seen updates ONLY on new messages in the active chat, NOT per render.
// - DM list uses onSnapshot (live unread/typing/lastMessage).
// - Message history paginates with limit() + startAfter() for scroll-back.
// =====================================================================
import {
  collection, doc, query, where, orderBy, limit, startAfter,
  onSnapshot, getDocs, getDoc, addDoc, updateDoc, writeBatch,
  setDoc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";
import { makeCoupleId } from "../utils/coupleId.js";

const PAGE = 20;

// ---- IDs ----
export function chatIdFor(uid, partnerId) { return makeCoupleId(uid, partnerId); }

// Ensure the chat doc exists (first message / first open).
export async function ensureChat(uid, partnerId) {
  const chatId = chatIdFor(uid, partnerId);
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      members:  [uid, partnerId],
      coupleId: chatId,
      createdAt: serverTimestamp(),
      unread:   { [uid]: 0, [partnerId]: 0 },
      typing:   { [uid]: false, [partnerId]: false },
      lastMessage: "", lastMessageTime: null, lastMessageSender: null
    });
  }
  return chatId;
}

// ---- DM LIST (live) ----
// Subscribes to all my chats ordered by recency. Emits [{chatId, ...}].
export function subscribeDMList(uid, cb) {
  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", uid),
    orderBy("lastMessageTime", "desc"),
    limit(15)
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => ({ chatId: d.id, ...d.data() }));
    cb(rows);
  });
}

// ---- MESSAGES (live, paginated) ----
// Subscribes to the most recent page. For scroll-back, call fetchOlder().
export function subscribeMessages(chatId, cb, pageSize = PAGE) {
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("time", "desc"),
    limit(pageSize)
  );
  return onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    cb(msgs, snap.docs[snap.docs.length - 1]); // last cursor = oldest loaded
  });
}

export async function fetchOlder(chatId, beforeDoc, pageSize = PAGE) {
  if (!beforeDoc) return { msgs: [], cursor: null };
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("time", "desc"),
    startAfter(beforeDoc),
    limit(pageSize)
  );
  const snap = await getDocs(q);
  return {
    msgs:   snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse(),
    cursor: snap.docs[snap.docs.length - 1] || null
  };
}

// ---- SEND ----
export async function sendText(chatId, partnerId, text) {
export async function sendText(chatId, partnerId, text, replyTo = null) {
  const uid = auth.currentUser?.uid;
  const trimmed = (text || "").trim();
  if (!uid || !trimmed) return null;

  const batch = writeBatch(db);
  const msgRef  = doc(collection(db, "chats", chatId, "messages"));
  const chatRef = doc(db, "chats", chatId);

  const payload = {
    text: trimmed,
    sender: uid,
    time: serverTimestamp(),
    status: "sent",
    deliveredAt: null, seenAt: null,
    reactions: {}
  };
  if (replyTo && replyTo.id) {
    payload.replyTo = {
      id:     String(replyTo.id),
      text:   String(replyTo.text || "").slice(0, 240),
      sender: String(replyTo.sender || ""),
      kind:   String(replyTo.kind || "text"),
    };
  }
  batch.set(msgRef, payload);
  batch.update(chatRef, {
    lastMessage:        trimmed.slice(0, 200),
    lastMessageTime:    serverTimestamp(),
    lastMessageSender:  uid,
    [`unread.${partnerId}`]: increment(1),
    [`unread.${uid}`]:       0,
    [`typing.${uid}`]:       false
  });
  await batch.commit();
  return msgRef.id;
}

// ---- DELIVERY / SEEN ----
// Call after messages stream loads. Marks every inbound message not yet delivered/seen.
// Uses a single batched write; skips writes when nothing to update.
export async function markDeliveredAndSeen(chatId, messages, { mySeen = true } = {}) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const batch = writeBatch(db);
  const now   = serverTimestamp();
  let writes = 0;

  for (const m of messages) {
    if (m.sender === uid) continue;
    const ref = doc(db, "chats", chatId, "messages", m.id);
    if (!m.deliveredAt) { batch.update(ref, { deliveredAt: now, status: "delivered" }); writes++; }
    if (mySeen && !m.seenAt) { batch.update(ref, { seenAt: now, status: "seen" }); writes++; }
  }
  // reset my unread counter once per call
  batch.update(doc(db, "chats", chatId), { [`unread.${uid}`]: 0 });
  writes++;
  if (writes) await batch.commit();
}

// ---- TYPING ----
let typingDebounce = null;
export function setTyping(chatId, isTyping) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const ref = doc(db, "chats", chatId);
  updateDoc(ref, { [`typing.${uid}`]: isTyping }).catch(() => {});
  if (isTyping) {
    clearTimeout(typingDebounce);
    typingDebounce = setTimeout(() => {
      updateDoc(ref, { [`typing.${uid}`]: false }).catch(() => {});
    }, 2000);
  }
}

export function subscribeChatMeta(chatId, cb) {
  return onSnapshot(doc(db, "chats", chatId), (s) => {
    if (s.exists()) cb({ chatId, ...s.data() });
  });
}

// ---- REACTIONS ----
export async function toggleReaction(chatId, msgId, emoji) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const ref = doc(db, "chats", chatId, "messages", msgId);
  const snap = await getDoc(ref);
  const reactions = snap.data()?.reactions || {};
  if (reactions[uid] === emoji) delete reactions[uid];
  else reactions[uid] = emoji;
  await updateDoc(ref, { reactions });
}

// ---- TICK RENDER HELPER ----
// status derives from the message doc itself (no extra lookups).
export function renderTicks(msg, myUid) {
  if (msg.sender !== myUid) return "";
  if (msg.seenAt)      return `<span class="tick seen">✔✔</span>`;
  if (msg.deliveredAt) return `<span class="tick delivered">✔✔</span>`;
  return `<span class="tick sent">✔</span>`;
}


// =====================================================================
// Polls — special message kind rendered as a poll bubble in chat.
// Storage: messages doc with shape:
//   { kind: "poll", sender, time, question, choices: [string],
//     votes: { uid: choiceIndex }, reactions: {} }
// =====================================================================
export async function sendPoll(chatId, partnerId, question, choices) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId || !partnerId) return null;
  const q = (question || "").trim();
  const ch = (choices || []).map(s => String(s || "").trim()).filter(Boolean).slice(0, 4);
  if (!q || ch.length < 2) return null;

  const batch = writeBatch(db);
  const msgRef  = doc(collection(db, "chats", chatId, "messages"));
  const chatRef = doc(db, "chats", chatId);

  batch.set(msgRef, {
    kind: "poll",
    sender: uid,
    time: serverTimestamp(),
    status: "sent",
    deliveredAt: null, seenAt: null,
    question: q,
    choices: ch,
    votes: {},
    reactions: {}
  });
  batch.update(chatRef, {
    lastMessage:        `📊 ${q.slice(0, 180)}`,
    lastMessageTime:    serverTimestamp(),
    lastMessageSender:  uid,
    [`unread.${partnerId}`]: increment(1),
    [`unread.${uid}`]:       0,
    [`typing.${uid}`]:       false
  });
  await batch.commit();
  return msgRef.id;
}

export async function votePoll(chatId, msgId, choiceIndex) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId || !msgId) return;
  const ref = doc(db, "chats", chatId, "messages", msgId);
  await updateDoc(ref, {
    [`votes.${uid}`]: Number(choiceIndex)
  });
}
