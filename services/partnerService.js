// =====================================================================
// Partner service — invite-code (UID) based pairing only.
// Couple apps don't expose discovery/search. Pairing happens by
// sharing your invite code (UID) with your partner.
// =====================================================================
import {
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../firebase.js";
import { getUserCached, reportFirestoreError } from "../utils/firestoreSafe.js";

// Cached, deduped, quota-aware user fetch.
export async function getUser(uid) {
  if (!uid) return null;
  return getUserCached(uid);
}

/**
 * Look up a user by invite code (their UID).
 * Used to validate the code before creating a partner request.
 */
export async function lookupByInviteCode(code) {
  const cleaned = (code || "").trim();
  if (!cleaned) return null;
  return getUser(cleaned);
}

export async function sendRequest(fromUid, toUid) {
  if (!fromUid || !toUid || fromUid === toUid) throw new Error("BAD_PAIR");
  await updateDoc(doc(db, "users", toUid),   {
    partnerRequestFrom: fromUid,
    partnerRequestAt:   serverTimestamp()
  });
  await updateDoc(doc(db, "users", fromUid), {
    partnerRequestTo:   toUid,
    partnerRequestAt:   serverTimestamp()
  });
}

export async function acceptRequest(meUid, otherUid) {
  const ts = serverTimestamp();
  await Promise.all([
    updateDoc(doc(db, "users", meUid), {
      partnerID:           otherUid,
      partnerRequestFrom:  null,
      partnerRequestTo:    null,
      relationshipStatus:  "matched",
      matchedAt:           ts
    }),
    updateDoc(doc(db, "users", otherUid), {
      partnerID:           meUid,
      partnerRequestFrom:  null,
      partnerRequestTo:    null,
      relationshipStatus:  "matched",
      matchedAt:           ts
    })
  ]);
}

export async function rejectRequest(meUid) {
  const me = await getUser(meUid);
  const fromUid = me?.partnerRequestFrom;
  await updateDoc(doc(db, "users", meUid), {
    partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "single"
  });
  if (fromUid) {
    await updateDoc(doc(db, "users", fromUid), {
      partnerRequestTo: null, relationshipStatus: "single"
    });
  }
}

/**
 * Direct invite-code pairing: caller passes the partner's UID and we
 * write both sides atomically (no request flow needed for couple apps).
 */
export async function pairWithInviteCode(meUid, code) {
  const cleaned = (code || "").trim();
  if (!meUid || !cleaned) throw new Error("BAD_PAIR");
  if (cleaned === meUid) throw new Error("SELF_PAIR");

  const partner = await getUser(cleaned);
  if (!partner) throw new Error("CODE_NOT_FOUND");

  return acceptRequest(meUid, cleaned);
}

/**
 * Disconnect from current partner. Wipes partnerID on both sides.
 */
export async function unpair(meUid) {
  const me = await getUser(meUid);
  const partnerId = me?.partnerID || me?.partnerId;
  await updateDoc(doc(db, "users", meUid), {
    partnerID: null, relationshipStatus: "single"
  }).catch((e) => reportFirestoreError(e, "unpair.me"));
  if (partnerId) {
    await updateDoc(doc(db, "users", partnerId), {
      partnerID: null, relationshipStatus: "single"
    }).catch((e) => reportFirestoreError(e, "unpair.partner"));
  }
}
