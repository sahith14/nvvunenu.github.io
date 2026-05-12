/**
 * BondSync Couple Service
 * Bond score, mood sharing, thinking-of-you poke, days together.
 */
import { db } from "../firebase.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function coupleDocPath(coupleId) {
  return doc(db, "couples", coupleId);
}

export function coupleMetaPath(coupleId) {
  return doc(db, "couples", coupleId, "meta", "stats");
}

export async function getCoupleMeta(coupleId) {
  if (!coupleId) return null;
  const snap = await getDoc(coupleMetaPath(coupleId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function initCoupleMeta(coupleId, u1, u2, startedAt) {
  const ref = coupleMetaPath(coupleId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      startedAt: startedAt || serverTimestamp(),
      bondScore: 50,
      moods: {},
      lastPokeAt: {},
      updatedAt: serverTimestamp()
    });
  }
}

export async function updateMood(coupleId, uid, moodEmoji) {
  const ref = coupleMetaPath(coupleId);
  await updateDoc(ref, {
    [`moods.${uid}`]: { emoji: moodEmoji, at: serverTimestamp() },
    updatedAt: serverTimestamp()
  });
}

export async function sendThinkingOfYou(coupleId, fromUid, toUid) {
  const ref = coupleMetaPath(coupleId);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const lastPoke = data.lastPokeAt?.[fromUid] ? data.lastPokeAt[fromUid].toMillis?.() : 0;
  const now = Date.now();
  if (now - lastPoke < 3 * 60 * 1000) {
    // rate limit 3 minutes
    return { ok: false, nextAt: lastPoke + 3 * 60 * 1000 };
  }

  await updateDoc(ref, {
    [`lastPokeAt.${fromUid}`]: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Record a poke doc in couple subcollection for feed.
  await addDoc(collection(db, "couples", coupleId, "pokes"), {
    from: fromUid,
    to: toUid,
    type: "thinking_of_you",
    createdAt: serverTimestamp()
  });

  return { ok: true };
}

export function daysTogether(startedAt) {
  const start = startedAt?.toMillis?.() || new Date(startedAt || 0).getTime() || Date.now();
  return Math.max(1, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24)));
}

export async function recalcBondScore(coupleId) {
  const meta = await getCoupleMeta(coupleId);
  if (!meta) return 50;

  const coupleRef = doc(db, "couples", coupleId);
  const coupleSnap = await getDoc(coupleRef);
  const coupleData = coupleSnap.data() || {};
  const u1 = coupleData.uid1;
  const u2 = coupleData.uid2;

  // Count shared memories, messages, and pokes.
  let score = 50;

  const messagesQ = query(
    collection(db, "chats", coupleData.chatId || coupleId, "messages"),
    orderBy("timestamp", "desc"), limit(100)
  );
  try {
    const msgSnap = await getDocs(messagesQ);
    score += msgSnap.size * 1;
  } catch {}

  const pokesQ = query(
    collection(db, "couples", coupleId, "pokes"),
    orderBy("createdAt", "desc"), limit(30)
  );
  try {
    const pokesSnap = await getDocs(pokesQ);
    score += pokesSnap.size * 5;
  } catch {}

  const memoriesQ = query(
    collection(db, "couples", coupleId, "memories"),
    orderBy("createdAt", "desc"), limit(50)
  );
  try {
    const memSnap = await getDocs(memoriesQ);
    score += memSnap.size * 3;
  } catch {}

  score = Math.min(100, Math.max(0, score));

  await updateDoc(coupleMetaPath(coupleId), {
    bondScore: score,
    updatedAt: serverTimestamp()
  });

  return score;
}

export function subscribeCoupleMeta(coupleId, callback) {
  if (!coupleId) return () => {};
  const ref = coupleMetaPath(coupleId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) callback(null);
    else callback({ id: snap.id, ...snap.data() });
  });
}
