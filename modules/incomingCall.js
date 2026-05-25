// =====================================================================
// modules/incomingCall.js — Listens to calls/{coupleId} doc.
// When a new ringing call arrives addressed to me, opens the call UI
// in 'callee' mode so I can accept/decline.
// =====================================================================
import { db, auth } from '../firebase.js';
import { doc, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { makeCoupleId } from '../utils/coupleId.js';
import { answerIncoming } from './callView.js';

let unsub = null;
// Tracks calls we've already opened UI for so we don't re-open on
// follow-up snapshot fires (e.g. when serverTimestamp resolves).
let activeCallKey = null;

export function startIncomingCallListener() {
  const me = auth.currentUser;
  if (!me) return;

  // get partner id
  getDoc(doc(db, 'users', me.uid)).then((s) => {
    const partnerId = s.data()?.partnerID || s.data()?.partnerId;
    if (!partnerId) return;
    const coupleId = makeCoupleId(me.uid, partnerId);

    unsub?.();
    unsub = onSnapshot(doc(db, 'calls', coupleId), async (snap) => {
      const d = snap.data();
      if (!d) return;

      // when call no longer ringing, clear our dedupe gate
      if (d.status !== 'ringing') {
        if (activeCallKey && activeCallKey.startsWith(coupleId + ':')) activeCallKey = null;
        return;
      }

      // only react if it's an incoming call to me
      if (d.calleeId !== me.uid) return;

      // dedupe: same caller + ringing window → ignore until status flips
      const callKey = `${coupleId}:${d.callerId}`;
      if (callKey === activeCallKey) return;
      activeCallKey = callKey;

      // get caller name
      const callerSnap = await getDoc(doc(db, 'users', d.callerId)).catch(() => null);
      const name = callerSnap?.data()?.displayName?.split(' ')[0] || 'Partner';

      // optional: vibrate to alert
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);

      answerIncoming(d.callerId, name, d.callType || 'video');
    });
  }).catch(() => {});
}

export function stopIncomingCallListener() {
  unsub?.(); unsub = null;
  activeCallKey = null;
}
