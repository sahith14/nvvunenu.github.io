// =====================================================================
// window.appState — single source of truth.
// Loaded ONCE after login; every module reads from here instead of
// re-querying Firestore for user/partner/coupleId.
// =====================================================================
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../firebase.js";
import { makeCoupleId } from "../utils/coupleId.js";

const initial = {
  ready:     false,
  user:      null,     // { uid, username, photoURL, email, ...userDoc }
  partner:   null,     // partner userDoc or null
  coupleId:  null,     // canonical id or null
  partnerId: null,     // convenience
  _unsubUser:    null,
  _unsubPartner: null,
  _listeners:    new Set()
};

window.appState = window.appState || initial;

export function onAppState(fn) {
  window.appState._listeners.add(fn);
  // fire immediately with current
  try { fn(window.appState); } catch {}
  return () => window.appState._listeners.delete(fn);
}

function notify() {
  for (const fn of window.appState._listeners) { try { fn(window.appState); } catch {} }
}

// Call on login (pass firebase user object)
export function initAppState(firebaseUser) {
  teardownAppState(); // idempotent
  if (!firebaseUser) return;

  const s = window.appState;
  s.user = { uid: firebaseUser.uid, email: firebaseUser.email, photoURL: firebaseUser.photoURL };

  s._unsubUser = onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
    const data = snap.data() || {};
    s.user = { uid: firebaseUser.uid, ...data };

    const newPartnerId = data.partnerID || null;
    if (newPartnerId !== s.partnerId) {
      s._unsubPartner?.(); s._unsubPartner = null;
      s.partnerId = newPartnerId;
      s.partner   = null;
      s.coupleId  = newPartnerId ? makeCoupleId(firebaseUser.uid, newPartnerId) : null;
      if (newPartnerId) {
        s._unsubPartner = onSnapshot(doc(db, "users", newPartnerId), (ps) => {
          s.partner = ps.exists() ? { uid: newPartnerId, ...ps.data() } : null;
          s.ready = true; notify();
        });
      }
    }
    s.ready = true;
    notify();
  });
}

export function teardownAppState() {
  const s = window.appState;
  s._unsubUser?.();    s._unsubUser = null;
  s._unsubPartner?.(); s._unsubPartner = null;
  s.user = null; s.partner = null; s.coupleId = null; s.partnerId = null; s.ready = false;
  notify();
}

export function getState() { return window.appState; }
export function requireCouple() {
  const { coupleId, partnerId } = window.appState;
  if (!coupleId || !partnerId) throw new Error("NO_PARTNER");
  return { coupleId, partnerId };
}
