// =====================================================================
// modules/incomingCall.js — Listens to calls/{coupleId}.
// When a new ringing call to ME arrives, opens the call UI in 'callee' mode.
// Reactive: re-binds the listener whenever appState's coupleId changes.
// =====================================================================
import { db } from '../firebase.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAppState } from '../state/appState.js';
import { getUser } from '../services/partnerService.js';
import { answerIncoming } from './callView.js';

let _offState   = null;
let _unsubCall  = null;
let _activeCallKey = null;
let _lastCoupleId  = null;
let _myUid         = null;

export function startIncomingCallListener() {
  // Re-attach listener whenever appState is ready / coupleId changes.
  _offState?.();
  _offState = onAppState((s) => {
    if (!s.ready) return;
    const newCouple = s.coupleId || null;
    const newUid    = s.user?.uid || null;
    if (newCouple === _lastCoupleId && newUid === _myUid) return;

    _lastCoupleId = newCouple;
    _myUid        = newUid;

    // Detach prior call listener
    try { _unsubCall?.(); } catch {}
    _unsubCall = null;
    _activeCallKey = null;

    if (!newCouple || !newUid) return;

    _unsubCall = onSnapshot(doc(db, 'calls', newCouple), async (snap) => {
      const d = snap.data();
      if (!d) return;

      // Reset dedupe gate when a call is no longer ringing
      if (d.status !== 'ringing') {
        if (_activeCallKey?.startsWith(newCouple + ':')) _activeCallKey = null;
        return;
      }
      // Only react if this ring is addressed to me
      if (d.calleeId !== newUid) return;

      const callKey = `${newCouple}:${d.callerId}`;
      if (callKey === _activeCallKey) return;
      _activeCallKey = callKey;

      // Caller name (cached via partnerService.getUser)
      let name = "Partner";
      try {
        const caller = await getUser(d.callerId);
        name = caller?.displayName?.split(' ')[0] || caller?.username || "Partner";
      } catch { /* keep default */ }

      if (navigator.vibrate) {
        try { navigator.vibrate([400, 200, 400, 200, 400]); } catch {}
      }
      answerIncoming(d.callerId, name, d.callType || 'video');
    }, (err) => console.warn('[incomingCall] listen error', err));
  });
}

export function stopIncomingCallListener() {
  try { _offState?.(); } catch {}
  try { _unsubCall?.(); } catch {}
  _offState = null; _unsubCall = null;
  _activeCallKey = null; _lastCoupleId = null; _myUid = null;
}
