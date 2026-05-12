// =====================================================================
// Presence — writes { status: { online, lastSeen } } to users/{uid}.
// Start once on login, stop on logout. Idempotent.
// =====================================================================
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";
import { isQuotaExhausted, reportFirestoreError } from "../utils/firestoreSafe.js";

let started = false;
let hbTimer  = null;
const HEARTBEAT_MS = 5 * 60_000; // 5 minutes

async function writeStatus(online) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  if (isQuotaExhausted()) return;   // stop burning writes once quota is hit
  try {
    await updateDoc(doc(db, "users", uid), {
      "status.online":   online,
      "status.lastSeen": serverTimestamp()
    });
  } catch (e) { reportFirestoreError(e, "presence.writeStatus"); }
}

function onVisibilityChange() { writeStatus(document.visibilityState === "visible"); }
function onBeforeUnload()     { writeStatus(false); }

export function startPresence() {
  if (started) return;
  started = true;
  writeStatus(true);
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
  writeStatus(false);
}
