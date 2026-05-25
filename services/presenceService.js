// =====================================================================
// services/presenceService.js — writes live presence to users/{uid}.
//   { status: { online, lastSeen },
//     activity: { type, detail, since } }
//
// Activity types (Discord-style):
//   idle | online | typing | listening | watching | gaming
//   sleeping | screen-sharing | in-call | editing-memories | custom
//
// Modules call setActivity('listening', 'Spotify — Sunflower') etc.
// Clear with setActivity(null) when the activity ends.
// =====================================================================
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";
import { isQuotaExhausted, reportFirestoreError } from "../utils/firestoreSafe.js";

let started = false;
let hbTimer  = null;
let _currentActivity = null;        // { type, detail, since } or null
let _activityWriteTimer = null;
const HEARTBEAT_MS = 5 * 60_000;
const ACTIVITY_DEBOUNCE_MS = 800;

// ---------- Online status ----------
async function writeStatus(online) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  if (isQuotaExhausted()) return;
  try {
    await updateDoc(doc(db, "users", uid), {
      "status.online":   online,
      "status.lastSeen": serverTimestamp()
    });
  } catch (e) { reportFirestoreError(e, "presence.writeStatus"); }
}

// Persist the user's IANA timezone once per session so the partner
// can render local times. Falls back silently if Intl is unavailable.
async function writeTimezone() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  if (isQuotaExhausted()) return;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    await updateDoc(doc(db, "users", uid), { timezone: tz });
  } catch { /* non-fatal */ }
}

function onVisibilityChange() {
  const visible = document.visibilityState === "visible";
  writeStatus(visible);
  if (!visible) writeActivity(null);   // clear activity when tab is hidden
}
function onBeforeUnload() {
  writeStatus(false);
  writeActivity(null);
}

export function startPresence() {
  if (started) return;
  started = true;
  writeStatus(true);
  writeTimezone();
  hbTimer = setInterval(() => writeStatus(document.visibilityState === "visible"), HEARTBEAT_MS);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide",     onBeforeUnload);
}

export function stopPresence() {
  if (!started) return;
  started = false;
  clearInterval(hbTimer); hbTimer = null;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("pagehide",     onBeforeUnload);
  writeActivity(null);
  writeStatus(false);
}

// ---------- Activity ----------
const VALID_TYPES = new Set([
  "idle","online","typing","listening","watching","gaming",
  "sleeping","screen-sharing","in-call","editing-memories","custom"
]);

/**
 * Set the user's current activity. Writes are debounced to avoid Firestore spam.
 * @param {string|null} type  null clears the activity
 * @param {string} [detail]   short label shown to partner (e.g. "Sunflower — Post Malone")
 */
export function setActivity(type, detail = "") {
  if (type !== null && !VALID_TYPES.has(type)) {
    console.warn("[presence] invalid activity type:", type);
    return;
  }
  if (type === null) {
    _currentActivity = null;
  } else {
    _currentActivity = { type, detail: String(detail).slice(0, 120), since: Date.now() };
  }
  scheduleActivityWrite();
}

function scheduleActivityWrite() {
  clearTimeout(_activityWriteTimer);
  _activityWriteTimer = setTimeout(writeActivity, ACTIVITY_DEBOUNCE_MS);
}

async function writeActivity(activity = _currentActivity) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  if (isQuotaExhausted()) return;
  try {
    if (!activity) {
      await updateDoc(doc(db, "users", uid), { activity: null });
    } else {
      await updateDoc(doc(db, "users", uid), {
        activity: {
          type:   activity.type,
          detail: activity.detail || "",
          since:  serverTimestamp()
        }
      });
    }
  } catch (e) { reportFirestoreError(e, "presence.writeActivity"); }
}

/** Pretty-print an activity object for UI. */
export function formatActivity(activity) {
  if (!activity) return null;
  const map = {
    typing:           ["💬", "Typing…"],
    listening:        ["🎵", "Listening to"],
    watching:         ["🎬", "Watching"],
    gaming:           ["🎮", "Playing"],
    sleeping:         ["🌙", "Sleeping"],
    "screen-sharing": ["🖥", "Sharing screen"],
    "in-call":        ["📞", "In a call"],
    "editing-memories":["📸", "Adding memories"],
    idle:             ["💤", "Idle"],
    online:           ["💚", "Online"],
    custom:           ["✨", ""],
  };
  const [icon, prefix] = map[activity.type] || ["•", activity.type];
  const detail = activity.detail || "";
  const text = detail ? (prefix ? `${prefix} ${detail}` : detail) : prefix;
  return { icon, text };
}
