// services/notifyService.js — Inbound activity → toast notifications.
// Subscribes to the partner-facing sub-collections under
// bonds/{coupleId} and fires a toast for each NEW item the user did
// not author themselves. Respects the master notification switch
// + per-event prefs in users/{uid}.notifPrefs.{key}.
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState, getState } from "../state/appState.js";
import { toast, toastSuccess } from "../utils/toast.js";
import { isNotifPrefOn, getNotifyEnabled } from "../modules/settings.js";
import { coupleMetaPath } from "./coupleService.js";
import { chatIdFor } from "./chatService.js";

let _myUid       = null;
let _coupleId    = null;
let _partnerId   = null;
let _partnerName = "your partner";
let _offState    = null;
let _unsubs      = [];      // current Firestore listeners
let _firstSnap   = new Set();
let _lastMoodAt  = new Map(); // uid -> timestamp ms last seen

/**
 * Start the listener service. Idempotent — calling twice is fine.
 */
export function startNotifyService() {
  if (_offState) return;
  _offState = onAppState((s) => {
    if (!s.ready) return;
    _myUid = s.user?.uid || null;
    _partnerId = s.partnerId || null;
    _partnerName = s.partner?.displayName?.split(" ")[0] || s.partner?.username || "your partner";

    if (s.coupleId && s.coupleId !== _coupleId) {
      _coupleId = s.coupleId;
      reattachAll();
    } else if (!s.coupleId && _coupleId) {
      _coupleId = null;
      teardownAll();
    }
    detectPresenceTransition(s);
    celebratePairing(s);
  });
}

export function stopNotifyService() {
  try { _offState?.(); } catch {}
  _offState = null;
  teardownAll();
  _myUid = _coupleId = null;
  _firstSnap.clear();
  _lastPartnerPresence = null;
  resetTabTitle();
}

// =====================================================================
// Per-source listeners
// =====================================================================
function reattachAll() {
  teardownAll();
  if (!_coupleId) return;

  _unsubs.push(
    listenSubcol("kindness", "at", "kindness", (data) => {
      if (data.by === _myUid) return null;
      const note = (data.note || "kind act").slice(0, 80);
      return { type: "success", text: `💛 ${_partnerName}: ${note}` };
    }),
    listenSubcol("dates", "completedAt", "dates", (data) => {
      // Only a transition into "completedAt" by the partner counts as inbound.
      if (!data.completedAt) return null;
      // No author field on date toggles — we infer "partner did it" from doc
      // type. Both partners share the same /dates collection but only the
      // *new* completedAt during the listener's lifetime fires this branch
      // (firstSnap suppresses initial backlog).
      return { type: "info", text: `🌹 A date was checked off — go celebrate!` };
    }),
    listenSubcol("timecapsule", "createdAt", "letters", (data) => {
      if (data.from === _myUid) return null;
      const title = data.title ? `: ${String(data.title).slice(0, 60)}` : "";
      return { type: "info", text: `📜 ${_partnerName} sealed a letter${title}` };
    }),
    listenSubcol("qotw", "updatedAt", "messages", (data) => {
      // Notify when the partner answers (their uid appears in answers map).
      const answers = data.answers || {};
      const partnerHasAnswered = Object.keys(answers).some((k) => k !== _myUid);
      if (!partnerHasAnswered) return null;
      return { type: "info", text: `💞 ${_partnerName} answered this week's question` };
    }),
    listenMetaMoods(),
    listenChatMessages(),
    listenKisses(),
  );
}

function teardownAll() {
  for (const off of _unsubs) { try { off(); } catch {} }
  _unsubs = [];
  _firstSnap.clear();
  _lastMoodAt.clear();
}

/**
 * Watches a sub-collection and calls makeToast(data) for each *new*
 * doc added after the initial snapshot. makeToast returns
 * { type, text } or null to skip.
 */
function listenSubcol(subPath, timeField, prefKey, makeToast) {
  const key = `${_coupleId}|${subPath}`;
  _firstSnap.add(key);
  const q = query(
    collection(db, "bonds", _coupleId, subPath),
    orderBy(timeField, "desc"),
    limit(20)
  );
  return onSnapshot(q, (snap) => {
    if (_firstSnap.has(key)) {
      _firstSnap.delete(key);
      return;   // skip backlog
    }
    if (!getNotifyEnabled()) return;
    snap.docChanges().forEach((change) => {
      if (change.type !== "added" && change.type !== "modified") return;
      // Master + per-event gate
      if (!isNotifPrefOn(getCurrentPrefs(), prefKey)) return;
      const data = change.doc.data() || {};
      const t = makeToast(data);
      if (!t) return;
      playChime();
      pingTabTitle();
      fireNative(`Nuvvu Nenu`, t.text);
      if (t.type === "success") toastSuccess(t.text);
      else                       toast(t.text);
    });
  });
}

// Helper — re-read prefs from getState() each fire so toggles apply live
function getCurrentPrefs() {
  try { return getState()?.user?.notifPrefs || null; }
  catch { return null; }
}



// =====================================================================
// Mood listener — couple meta is a single doc with a moods.{uid} map.
// We track each side's last-seen at-timestamp and toast on a fresh
// share by the partner.
// =====================================================================
function listenMetaMoods() {
  if (!_coupleId) return () => {};
  let firstSnap = true;
  return onSnapshot(coupleMetaPath(_coupleId), (snap) => {
    const data = snap.data() || {};
    const moods = data.moods || {};
    if (firstSnap) {
      // Seed last-seen so we don't toast the existing snapshot.
      for (const uid of Object.keys(moods)) {
        const at = moods[uid]?.at?.toMillis?.() || 0;
        _lastMoodAt.set(uid, at);
      }
      firstSnap = false;
      return;
    }
    if (!getNotifyEnabled()) return;
    if (!isNotifPrefOn(getCurrentPrefs(), "moods")) return;

    for (const uid of Object.keys(moods)) {
      if (uid === _myUid) continue;     // ignore my own update
      const m = moods[uid] || {};
      const at = m.at?.toMillis?.() || 0;
      const last = _lastMoodAt.get(uid) || 0;
      if (at > last) {
        _lastMoodAt.set(uid, at);
        const emoji = m.emoji || "🌙";
        const txt = `${emoji} ${_partnerName} shared a mood`;
        playChime();
        pingTabTitle();
        fireNative("Nuvvu Nenu", txt);
        toast(txt);
        spawnFloatingHeart(emoji);
      }
    }
  });
}



// =====================================================================
// Soft 2-tone chime for inbound notifications.
// Lazy-creates a single shared AudioContext, played gently so it never
// startles. Respects { sound: false } in user prefs.
// =====================================================================
let _ac = null;
function getAC() {
  if (_ac) return _ac;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    _ac = new C();
  } catch { _ac = null; }
  return _ac;
}

export function playChime() {
  if (!getNotifyEnabled()) return;
  const prefs = getCurrentPrefs();
  // 'sound' defaults true if undefined — opt-out only.
  if (prefs && prefs.sound === false) return;

  const ac = getAC();
  if (!ac) return;
  // Resume on user-driven contexts (browsers may suspend until interaction)
  if (ac.state === "suspended") { try { ac.resume(); } catch {} }

  const now = ac.currentTime;
  // Two warm tones (E5 + A5), very soft envelope, short tail.
  for (const [freq, delay] of [[659.25, 0], [880, 0.18]]) {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ac.destination);
    const start = now + delay;
    const peak  = 0.045;       // cap volume — soft on purpose
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak,  start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
    osc.start(start);
    osc.stop(start + 0.5);
  }
}


// =====================================================================
// Browser tab title ping — when the tab is hidden and a notification
// fires, prefix the document title with "(N) " and a soft flash. Reset
// the moment the user comes back to the tab.
// =====================================================================
let _origTitle = null;
let _unreadCount = 0;
let _flashTimer = null;
let _visListenerAttached = false;

function ensureVisListener() {
  if (_visListenerAttached) return;
  _visListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resetTabTitle();
  });
  // Also reset on window focus for desktop edge cases
  window.addEventListener("focus", resetTabTitle);
}

export function pingTabTitle() {
  ensureVisListener();
  // Only ping when the tab is hidden — the user can't see the title
  // inside the tab, but they can in the OS task switcher / tab strip.
  if (!document.hidden) return;
  if (_origTitle === null) _origTitle = document.title;
  _unreadCount += 1;
  // Two-state flash: "(N) New activity • Nuvvu Nenu" alternates with the
  // original title every 1s while hidden.
  clearInterval(_flashTimer);
  let flip = false;
  const apply = () => {
    document.title = flip
      ? _origTitle
      : `(${_unreadCount}) New activity • ${_origTitle}`;
    flip = !flip;
  };
  apply();
  _flashTimer = setInterval(apply, 1100);
}

function resetTabTitle() {
  clearInterval(_flashTimer); _flashTimer = null;
  _unreadCount = 0;
  if (_origTitle !== null) {
    document.title = _origTitle;
    _origTitle = null;
  }
}


// =====================================================================
// Browser-native Notification API — only fires when:
//   • permission has been granted (request via askNativeNotifPermission)
//   • the tab is hidden (otherwise the in-app toast is enough)
//   • settings prefs allow notifications + this specific event
// =====================================================================
const NATIVE_ICON = "/nvvunenu.github.io/assets/icon-192.png"; // best-effort

export async function askNativeNotifPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied")  return "denied";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch { return "denied"; }
}

export function nativeNotifSupported() {
  return typeof Notification !== "undefined";
}

export function nativeNotifPermission() {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function fireNative(title, body) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return;            // toast already covers visible tab
  try {
    const n = new Notification(title, {
      body: body || "",
      tag:  "nuvvunenu",                   // collapse rapid-fire into one
      renotify: false,
      silent: true,                        // we play our own chime
      icon:  NATIVE_ICON,
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      try { n.close(); } catch {}
    };
    setTimeout(() => { try { n.close(); } catch {} }, 7000);
  } catch { /* non-fatal */ }
}


// =====================================================================
// Chat message listener — toast on inbound messages but skip when the
// user is already on /chat (they'll see the bubble appear).
// =====================================================================
function listenChatMessages() {
  if (!_myUid || !_partnerId) return () => {};
  const chatId = chatIdFor(_myUid, _partnerId);
  let firstSnap = true;
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("time", "desc"),
    limit(8)
  );
  return onSnapshot(q, (snap) => {
    if (firstSnap) { firstSnap = false; return; }
    if (!getNotifyEnabled()) return;
    if (!isNotifPrefOn(getCurrentPrefs(), "messages")) return;
    if (chatMutedNow()) return;

    // Don't toast when the user is already looking at /chat.
    const onChatPage = location.hash === "#chat" || /\/chat$/.test(location.hash);
    if (!document.hidden && onChatPage) return;

    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const m = change.doc.data() || {};
      if (!m.sender || m.sender === _myUid) return;
      let preview;
      if (m.kind === "poll")        preview = `📊 ${m.question || "Poll"}`;
      else if (m.kind === "memory") preview = `📷 ${m.memory?.title || "Memory"}`;
      else if (m.audio)             preview = "🎙 Voice note";
      else if (m.image)             preview = "📷 Photo";
      else                          preview = String(m.text || "").slice(0, 80);
      const txt = `💬 ${_partnerName}: ${preview}`;
      playChime();
      pingTabTitle();
      fireNative("Nuvvu Nenu", txt);
      toast(txt);
    });
  });
}


// =====================================================================
// Presence transition — fires a toast the moment the partner ENTERS a
// Together sub-view (watching, listening, screen-sharing, sleeping,
// gaming). Detected from appState rather than a Firestore listener
// because appState already subscribes to the partner doc.
// =====================================================================
const PRESENCE_LABELS = {
  watching:        { label: "Watch Together", icon: "📺" },
  listening:       { label: "Music Room",     icon: "🎵" },
  "screen-sharing":{ label: "Screen share",   icon: "🖥" },
  sleeping:        { label: "Sleep Together", icon: "🌙" },
  gaming:          { label: "Play Together",  icon: "🎮" },
};
let _lastPartnerPresence = null;

function detectPresenceTransition(s) {
  const t = s?.partner?.activity?.type || null;
  const prev = _lastPartnerPresence;
  _lastPartnerPresence = t;
  if (!prev && t === null) return;     // skip first-load and resting state
  if (prev === t) return;              // no change
  if (!t || !PRESENCE_LABELS[t]) return; // either no new state, or not a sub-view
  // Only celebrate the *enter* transition, not exit.
  if (!getNotifyEnabled()) return;
  if (!isNotifPrefOn(getCurrentPrefs(), "presence")) return;
  // Don't double-notify if user is already on /together.
  const onTogether = location.hash === "#together" || /\/together$/.test(location.hash);
  if (!document.hidden && onTogether) return;

  const meta = PRESENCE_LABELS[t];
  const txt = `${meta.icon} ${_partnerName} is in ${meta.label}`;
  playChime();
  pingTabTitle();
  fireNative("Nuvvu Nenu", txt);
  toast(txt);
}


// =====================================================================
// Floating-heart effect — spawns 1 small drifting glyph at the bottom-
// right when partner shares a fresh mood. Pure DOM, auto-cleans up.
// =====================================================================
function spawnFloatingHeart(emoji = "💜") {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.className = "nv-float-heart";
  el.textContent = emoji;
  // Random horizontal offset so multiple in a row don't stack
  el.style.right = `${24 + Math.random() * 60}px`;
  el.style.bottom = `${72 + Math.random() * 30}px`;
  el.style.fontSize = `${28 + Math.random() * 14}px`;
  document.body.appendChild(el);

  // Inject keyframe + class once
  if (!document.getElementById("nv-float-heart-style")) {
    const s = document.createElement("style");
    s.id = "nv-float-heart-style";
    s.textContent = `
      .nv-float-heart {
        position: fixed; z-index: 9999;
        pointer-events: none;
        line-height: 1;
        text-shadow: 0 4px 14px rgba(255,126,182,.55);
        animation: nv-float-up 3s cubic-bezier(.22,1,.36,1) forwards;
      }
      @keyframes nv-float-up {
        0%   { transform: translateY(0)     scale(.6); opacity: 0; }
        15%  { transform: translateY(-20px) scale(1.05); opacity: 1; }
        100% { transform: translateY(-260px) scale(.85); opacity: 0; }
      }
    `;
    document.head.appendChild(s);
  }
  setTimeout(() => { try { el.remove(); } catch {} }, 3100);
}


// =====================================================================
// Pairing celebration — fires once per device when a coupleId first
// shows up in appState. Spawns a small heart-burst overlay + toast.
// =====================================================================
const PAIRING_KEY = "nvvunenu.pairingCelebrated";
let _celebrating = false;

function celebratePairing(s) {
  if (!s?.coupleId || _celebrating) return;
  let already = false;
  try { already = localStorage.getItem(PAIRING_KEY) === s.coupleId; } catch {}
  if (already) return;
  _celebrating = true;
  try { localStorage.setItem(PAIRING_KEY, s.coupleId); } catch {}

  const partnerName = s?.partner?.displayName?.split(" ")[0] || s?.partner?.username || "your person";
  setTimeout(() => {
    spawnHeartBurst();
    toastSuccess(`You're paired with ${partnerName} 💜`);
    playChime();
  }, 600);
}

export function spawnHeartBurst() {
  if (typeof document === "undefined") return;
  const layer = document.createElement("div");
  layer.className = "nv-heart-burst";
  for (let i = 0; i < 14; i++) {
    const span = document.createElement("span");
    span.textContent = ["💜","💖","🥰","✨","💕"][i % 5];
    span.style.setProperty("--dx", `${Math.round((Math.random() - .5) * 360)}px`);
    span.style.setProperty("--dy", `${-180 - Math.random() * 220}px`);
    span.style.setProperty("--rot", `${Math.round((Math.random() - .5) * 360)}deg`);
    span.style.setProperty("--delay", `${(Math.random() * 0.25).toFixed(2)}s`);
    span.style.setProperty("--scale", (.7 + Math.random() * .9).toFixed(2));
    layer.appendChild(span);
  }
  document.body.appendChild(layer);

  if (!document.getElementById("nv-heart-burst-style")) {
    const s = document.createElement("style");
    s.id = "nv-heart-burst-style";
    s.textContent = `
      .nv-heart-burst {
        position: fixed; left: 50%; top: 60%;
        transform: translate(-50%, -50%);
        pointer-events: none; z-index: 9999;
      }
      .nv-heart-burst span {
        position: absolute; top: 0; left: 0;
        font-size: 28px; line-height: 1;
        opacity: 0;
        animation: nv-heart-fly 1.6s cubic-bezier(.22,1,.36,1) var(--delay,0s) forwards;
        transform: scale(var(--scale,1));
        text-shadow: 0 4px 14px rgba(255,126,182,.5);
      }
      @keyframes nv-heart-fly {
        0%   { opacity: 0; transform: translate(0, 0) scale(.4) rotate(0); }
        20%  { opacity: 1; transform: translate(0, -10px) scale(1) rotate(0); }
        100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(var(--scale,1)) rotate(var(--rot)); }
      }
    `;
    document.head.appendChild(s);
  }
  setTimeout(() => { try { layer.remove(); } catch {} }, 2000);
}


// Local mirror of chat-mute (avoids importing chat.js into a service).
function chatMutedNow() {
  try {
    const v = Number(localStorage.getItem("nvvunenu.chatMutedUntil") || 0);
    return v > Date.now();
  } catch { return false; }
}


// =====================================================================
// Inbound kisses — burst hearts on partner's screen when one arrives.
// =====================================================================
function listenKisses() {
  if (!_coupleId) return () => {};
  let firstSnap = true;
  const q = query(
    collection(db, "couples", _coupleId, "kisses"),
    orderBy("at", "desc"),
    limit(3)
  );
  return onSnapshot(q, (snap) => {
    if (firstSnap) { firstSnap = false; return; }
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const m = change.doc.data() || {};
      if (m.from === _myUid) return;     // skip my own send (already burst locally)
      // No pref-gate — kisses are intentional gestures the partner just sent
      try { spawnHeartBurst(); } catch {}
      toast(`💋 ${_partnerName} sent a kiss`);
    });
  });
}
