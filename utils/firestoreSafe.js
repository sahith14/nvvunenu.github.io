// =====================================================================
// utils/firestoreSafe.js — defensive helpers around Firestore.
// - reportFirestoreError(): logs + flips a quota flag on quota errors.
// - isQuotaExhausted(): consumers can short-circuit further writes.
// - safeGetDocs(): wraps getDocs; returns null on error.
// - getUserCached(): caches users/{uid} reads in-memory.
// =====================================================================
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../firebase.js";

let quotaExhausted = false;
const userCache = new Map();          // uid -> { data, at }
const USER_CACHE_TTL = 60_000;        // 1 minute

export function isQuotaExhausted() { return quotaExhausted; }

export function reportFirestoreError(err, ctx = "") {
  if (!err) return;
  const code = err?.code || "";
  if (code === "resource-exhausted" || /quota/i.test(err?.message || "")) {
    quotaExhausted = true;
    console.warn(`[firestoreSafe] quota exhausted (${ctx})`);
    return;
  }
  console.warn(`[firestoreSafe] ${ctx}:`, err?.message || err);
}

export async function safeGetDocs(q, { ctx = "safeGetDocs" } = {}) {
  if (quotaExhausted) return null;
  try { return await getDocs(q); }
  catch (e) { reportFirestoreError(e, ctx); return null; }
}

export async function getUserCached(uid) {
  if (!uid) return null;
  const hit = userCache.get(uid);
  if (hit && Date.now() - hit.at < USER_CACHE_TTL) return hit.data;
  if (quotaExhausted) return hit?.data || null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const data = { uid, ...snap.data() };
    userCache.set(uid, { data, at: Date.now() });
    return data;
  } catch (e) {
    reportFirestoreError(e, "getUserCached");
    return hit?.data || null;
  }
}

export function clearUserCache(uid) {
  if (uid) userCache.delete(uid);
  else userCache.clear();
}
