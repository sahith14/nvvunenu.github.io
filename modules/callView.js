// =====================================================================
// modules/callView.js — Full-screen video/audio call UI with
// Firestore-backed WebRTC signaling.
//
// Signaling data model (matches firestore.rules):
//   calls/{coupleId}                       (doc)
//     callerId, calleeId, status, callType, startedAt, endedAt
//   calls/{coupleId}/signaling/{sigId}     (subcol)
//     from   : uid  (sender)
//     payload: { type:'sdp', sdp } | { type:'ice', candidate }
//     createdAt
//
// Public:
//   openCallUI({ partnerId, mode:'caller'|'callee', callType:'video'|'audio' })
//   closeCallUI()    — ends + tears down
// =====================================================================
import { db, auth } from '../firebase.js';
import {
  collection, doc, setDoc, getDoc, addDoc, updateDoc, onSnapshot,
  query, orderBy, serverTimestamp, getDocs, writeBatch, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { createCall } from '../services/callService.js';
import { makeCoupleId } from '../utils/coupleId.js';

let currentCall    = null;
let unsubSignaling = null;
let unsubCallDoc   = null;
let coupleId       = null;
let myUid          = null;
let partnerId      = null;
let callType       = 'video';
let mode           = 'caller';
let dialTone       = null;
let elapsedTimer   = null;
let startMs        = 0;

// =========================================================================
// FIRESTORE SIGNALING
// =========================================================================
async function writeSignal(payload) {
  if (!coupleId || !myUid) return;
  try {
    await addDoc(collection(db, 'calls', coupleId, 'signaling'), {
      from: myUid,
      payload,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn('[call] writeSignal failed', e);
  }
}

function subscribeSignaling() {
  if (!coupleId) return;
  // Pull all signaling and filter client-side (avoids composite index requirement).
  const q = query(
    collection(db, 'calls', coupleId, 'signaling'),
    orderBy('createdAt', 'asc')
  );
  unsubSignaling = onSnapshot(q, async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue;
      const data = change.doc.data();
      if (!data?.payload) continue;
      if (data.from === myUid) continue;       // ignore my own signals
      try { await currentCall?.onSignalReceived(data.payload); } catch (e) { console.warn(e); }
    }
  }, (err) => console.warn('[call] signaling sub err', err));
}

async function clearSignaling() {
  if (!coupleId) return;
  try {
    const snap = await getDocs(collection(db, 'calls', coupleId, 'signaling'));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch {}
}

// =========================================================================
// CALL DOC (for ringing / accept / decline / end status)
// =========================================================================
async function ensureCallDoc(initialStatus = 'ringing') {
  await setDoc(doc(db, 'calls', coupleId), {
    callerId : mode === 'caller' ? myUid : partnerId,
    calleeId : mode === 'caller' ? partnerId : myUid,
    callType,
    status   : initialStatus,
    startedAt: serverTimestamp()
  }, { merge: true });
}

function subscribeCallDoc() {
  unsubCallDoc = onSnapshot(doc(db, 'calls', coupleId), (s) => {
    const d = s.data(); if (!d) return;
    if (d.status === 'ended' || d.status === 'declined' || d.status === 'missed') {
      teardown(d.status === 'declined' ? 'Partner declined' : 'Call ended');
    }
    if (d.status === 'active' && mode === 'caller') stopRingbackTone();
  });
}

async function setCallStatus(status) {
  if (!coupleId) return;
  try {
    await updateDoc(doc(db, 'calls', coupleId), {
      status,
      ...(status === 'ended' ? { endedAt: serverTimestamp() } : {})
    });
  } catch {}
}

// =========================================================================
// AUDIO CUES
// =========================================================================
function startRingbackTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.0;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    let on = false;
    const id = setInterval(() => {
      on = !on;
      gain.gain.setTargetAtTime(on ? 0.05 : 0.0, ctx.currentTime, 0.01);
    }, 1000);
    dialTone = { ctx, osc, id };
  } catch {}
}

function stopRingbackTone() {
  if (!dialTone) return;
  try { clearInterval(dialTone.id); dialTone.osc.stop(); dialTone.ctx.close(); } catch {}
  dialTone = null;
}

// =========================================================================
// UI
// =========================================================================
function injectShellIfNeeded() {
  let host = document.getElementById('callOverlay');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'callOverlay';
  host.className = 'call-overlay hidden';
  host.innerHTML = `
    <div class="call-stage">
      <video id="remoteVideo" class="call-remote" autoplay playsinline></video>
      <video id="localVideo"  class="call-local"  autoplay playsinline muted></video>

      <div class="call-topbar">
        <div class="call-peer">
          <div class="call-peer-name" id="callPeerName">Partner 💜</div>
          <div class="call-peer-status" id="callStatus">Connecting…</div>
          <div class="call-timer" id="callTimer"></div>
        </div>
      </div>

      <div class="call-poster" id="callPoster">
        <div class="call-orb"></div>
        <div class="call-poster-name" id="callPosterName">Calling partner…</div>
        <div class="call-poster-sub"  id="callPosterSub">Ringing</div>
      </div>

      <div class="call-controls">
        <button class="call-btn call-mute"   id="btnMute"   title="Mute">🎙️</button>
        <button class="call-btn call-cam"    id="btnCam"    title="Camera">🎥</button>
        <button class="call-btn call-screen" id="btnScreen" title="Share screen">🖥️</button>
        <button class="call-btn call-flip"   id="btnFlip"   title="Flip camera">🔄</button>
        <button class="call-btn call-end"    id="btnEnd"    title="End call">✖</button>
      </div>

      <div class="call-incoming hidden" id="callIncoming">
        <div class="call-orb pulse"></div>
        <div class="call-incoming-name" id="callIncomingName">Partner is calling 💜</div>
        <div class="call-incoming-sub">Incoming ${callType} call</div>
        <div class="call-incoming-actions">
          <button class="call-btn call-decline" id="btnDecline">Decline</button>
          <button class="call-btn call-accept"  id="btnAccept">Accept</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  wireControls(host);
  return host;
}

function wireControls(host) {
  host.querySelector('#btnMute').onclick = () => {
    const muted = currentCall?.toggleMute(); host.querySelector('#btnMute').classList.toggle('on', muted);
    host.querySelector('#btnMute').textContent = muted ? '🔇' : '🎙️';
  };
  host.querySelector('#btnCam').onclick = () => {
    const off = currentCall?.toggleCamera(); host.querySelector('#btnCam').classList.toggle('on', off);
    host.querySelector('#btnCam').textContent = off ? '📷' : '🎥';
  };
  host.querySelector('#btnScreen').onclick = async () => {
    const btn = host.querySelector('#btnScreen');
    if (btn.classList.contains('on')) {
      await currentCall?.stopScreenShare();
      btn.classList.remove('on');
    } else {
      try { await currentCall?.startScreenShare(); btn.classList.add('on'); }
      catch (e) { console.warn(e); }
    }
  };
  host.querySelector('#btnFlip').onclick = async () => {
    try { await currentCall?.flipCamera?.(); } catch {}
  };
  host.querySelector('#btnEnd').onclick = () => closeCallUI();
  host.querySelector('#btnAccept').onclick  = () => acceptIncoming();
  host.querySelector('#btnDecline').onclick = () => declineIncoming();
}

function showOverlay(initial = {}) {
  const host = injectShellIfNeeded();
  host.classList.remove('hidden');
  document.documentElement.classList.add('call-active');

  const status = host.querySelector('#callStatus');
  const peer   = host.querySelector('#callPeerName');
  const poster = host.querySelector('#callPoster');
  const incoming = host.querySelector('#callIncoming');

  if (initial.status) status.textContent = initial.status;
  if (initial.name)   peer.textContent   = initial.name;
  poster.classList.remove('hidden');
  incoming.classList.toggle('hidden', mode !== 'callee' || !initial.showIncoming);
}

function hideOverlay() {
  const host = document.getElementById('callOverlay');
  if (host) host.classList.add('hidden');
  document.documentElement.classList.remove('call-active');
}

function setStatus(text) {
  const el = document.getElementById('callStatus'); if (el) el.textContent = text;
}

function startElapsedClock() {
  startMs = Date.now();
  const el = document.getElementById('callTimer');
  elapsedTimer = setInterval(() => {
    if (!el) return;
    const s = Math.floor((Date.now() - startMs) / 1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    el.textContent = `${mm}:${ss}`;
  }, 1000);
}

function stopElapsedClock() { clearInterval(elapsedTimer); elapsedTimer = null; }

// =========================================================================
// FACTORY
// =========================================================================
function makeCall() {
  return createCall({
    sendSignal: writeSignal,
    onStream: ({ kind, stream }) => {
      const id = kind === 'local' ? 'localVideo' : 'remoteVideo';
      const v  = document.getElementById(id);
      if (v && v.srcObject !== stream) v.srcObject = stream;
    },
    onStateChange: (s) => {
      if (s === 'connecting') setStatus('Connecting…');
      else if (s === 'connected') {
        setStatus('Connected');
        document.getElementById('callPoster')?.classList.add('hidden');
        startElapsedClock();
        if (mode === 'caller') setCallStatus('active');
      }
      else if (s === 'disconnected') setStatus('Reconnecting…');
      else if (s === 'failed') closeCallUI();
    }
  });
}

// =========================================================================
// PUBLIC API
// =========================================================================
export async function openCallUI(opts = {}) {
  myUid     = auth.currentUser?.uid;
  partnerId = opts.partnerId;
  callType  = opts.callType || 'video';
  mode      = opts.mode     || 'caller';
  if (!myUid || !partnerId) return;

  coupleId = makeCoupleId(myUid, partnerId);
  showOverlay({
    name:   opts.name || 'Partner 💜',
    status: mode === 'caller' ? 'Calling…' : 'Incoming call…',
    showIncoming: mode === 'callee'
  });

  currentCall = makeCall();
  subscribeCallDoc();

  if (mode === 'caller') {
    // Clean any stale signaling from a previous (possibly interrupted) call,
    // then write our own ringing doc and start.
    await clearSignaling().catch(() => {});
    await ensureCallDoc('ringing');
    subscribeSignaling();
    await currentCall.startCall({ video: callType === 'video', audio: true });
    startRingbackTone();
  } else {
    // wait for user to accept
    subscribeSignaling();
  }
}

async function acceptIncoming() {
  document.getElementById('callIncoming')?.classList.add('hidden');
  await setCallStatus('active');
  await currentCall.acceptCall({ video: callType === 'video', audio: true });
}

async function declineIncoming() {
  await setCallStatus('declined');
  closeCallUI();
}

export function closeCallUI(reason) {
  if (currentCall) {
    try { currentCall.endCall(); } catch {}
  }
  if (mode && coupleId && myUid) {
    setCallStatus('ended').then(clearSignaling).catch(()=>{});
  }
  teardown(reason);
}

function teardown(reason) {
  stopRingbackTone();
  stopElapsedClock();
  unsubSignaling?.();   unsubSignaling = null;
  unsubCallDoc?.();     unsubCallDoc   = null;
  // Release local media if still held (e.g. partner ended the call remotely).
  if (currentCall) {
    try { currentCall.endCall(); } catch {}
  }
  hideOverlay();
  currentCall = null;
  coupleId = null; partnerId = null;
  if (reason && window.showToast) window.showToast(reason);
}

// =========================================================================
// CONVENIENCE
// =========================================================================
export function startVideoCall(partnerUid, name) {
  return openCallUI({ partnerId: partnerUid, name, mode: 'caller', callType: 'video' });
}
export function startAudioCall(partnerUid, name) {
  return openCallUI({ partnerId: partnerUid, name, mode: 'caller', callType: 'audio' });
}
export function answerIncoming(partnerUid, name, type = 'video') {
  return openCallUI({ partnerId: partnerUid, name, mode: 'callee', callType: type });
}

window.startVideoCall = startVideoCall;
window.startAudioCall = startAudioCall;
window.answerIncoming = answerIncoming;
window.closeCallUI    = closeCallUI;
