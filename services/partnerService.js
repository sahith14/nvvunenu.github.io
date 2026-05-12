// =====================================================================
// Partner service — thin wrapper. Most reads go through appState now.
// =====================================================================
import {
  doc, getDoc, updateDoc, serverTimestamp, collection, query,
  orderBy, startAt, endAt, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../firebase.js";
import { getUserCached, safeGetDocs } from "../utils/firestoreSafe.js";

// Cached, deduped, quota-aware user fetch.
export async function getUser(uid) {
  if (!uid) return null;
  return getUserCached(uid);
}

export async function searchUsersByUsername(text, opts = { limit: 10 }) {
  if (!text) return [];
  const q = query(
    collection(db, "users"),
    orderBy("username"),
    startAt(text),
    endAt(text + "\uf8ff"),
    limit(opts.limit)
  );
  const snap = await safeGetDocs(q, { ctx: "searchUsersByUsername" });
  if (!snap) return [];
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.uid);
}

export async function sendRequest(fromUid, toUid) {
  if (!fromUid || !toUid || fromUid === toUid) throw new Error("BAD_PAIR");
  await updateDoc(doc(db, "users", toUid),   { partnerRequestFrom: fromUid, partnerRequestAt: serverTimestamp() });
  await updateDoc(doc(db, "users", fromUid), { partnerRequestTo: toUid,     partnerRequestAt: serverTimestamp() });
}

export async function acceptRequest(meUid, otherUid) {
  const ts = serverTimestamp();
  await Promise.all([
    updateDoc(doc(db, "users", meUid),    { partnerID: otherUid, partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "matched", matchedAt: ts }),
    updateDoc(doc(db, "users", otherUid), { partnerID: meUid,    partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "matched", matchedAt: ts })
  ]);
}

export async function rejectRequest(meUid) {
  const me = await getUser(meUid);
  const fromUid = me?.partnerRequestFrom;
  await updateDoc(doc(db, "users", meUid), { partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "single" });
  if (fromUid) await updateDoc(doc(db, "users", fromUid), { partnerRequestTo: null, relationshipStatus: "single" });
}
