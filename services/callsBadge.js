// services/callsBadge.js — Missed-call badge on Profile nav.
// Side-effect module. Watches couples/{cid}/callHistory and surfaces a
// small red dot on every button[data-page="profile"] when the latest
// MISSED incoming call is newer than the last time the user opened
// /profile.
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";

const SEEN_KEY = "nvvunenu.callsLastSeenAt";

let _unsub = null;
let _coupleId = null;
let _myUid = null;
let _latestMissed = 0;

onAppState((s) => {
  if (!s.ready) return;
  _myUid = s.user?.uid;
  if (!_myUid || !s.coupleId) { teardown(); return; }
  if (s.coupleId === _coupleId) return;
  teardown();
  _coupleId = s.coupleId;
  const q = query(
    collection(db, "couples", s.coupleId, "callHistory"),
    orderBy("at", "desc"),
    limit(5)
  );
  _unsub = onSnapshot(q, (snap) => {
    let latestMissed = 0;
    snap.forEach((d) => {
      const m = d.data() || {};
      // Only my-side missed-incoming counts (sender stores per-side rows;
      // pick the row I authored where I was the callee and never picked up).
      if (m.sender !== _myUid) return;
      if (m.direction !== "incoming") return;
      if ((m.durationSec || 0) > 0) return;
      const t = m.at?.toMillis?.() || m.at?.seconds * 1000 || 0;
      if (t > latestMissed) latestMissed = t;
    });
    _latestMissed = latestMissed;
    paintBadge(latestMissed > getLastSeen());
  });
});

const origLoadPage = window.loadPage;
window.loadPage = function (page) {
  if (page === "profile") {
    setLastSeen(Date.now());
    paintBadge(false);
  }
  if (typeof origLoadPage === "function") origLoadPage(page);
  // Re-apply after the new page renders so freshly-mounted nav buttons
  // pick up the current state.
  setTimeout(() => { paintBadge(_latestMissed > getLastSeen()); }, 30);
};

function teardown() {
  try { _unsub?.(); } catch {}
  _unsub = null; _coupleId = null;
  _latestMissed = 0;
  paintBadge(false);
}

function getLastSeen() {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; }
}
function setLastSeen(ms) {
  try { localStorage.setItem(SEEN_KEY, String(ms)); } catch {}
}

function paintBadge(on) {
  document.querySelectorAll('button[data-page="profile"]').forEach((b) => {
    b.classList.toggle("has-call-badge", !!on);
  });
  if (!document.getElementById("nv-call-badge-style")) {
    const s = document.createElement("style");
    s.id = "nv-call-badge-style";
    s.textContent = `
      button[data-page="profile"] { position: relative; }
      button[data-page="profile"].has-call-badge::after {
        content: "";
        position: absolute; top: 6px; right: 12px;
        width: 9px; height: 9px; border-radius: 50%;
        background: linear-gradient(135deg,#ff5e7e,#c2425a);
        box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 4px 10px rgba(255,94,126,.55);
        animation: nv-call-badge-in .3s cubic-bezier(.22,1,.36,1);
      }
      @keyframes nv-call-badge-in {
        from { opacity: 0; transform: scale(.4); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(s);
  }
}
