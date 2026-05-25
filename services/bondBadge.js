// services/bondBadge.js — Unseen bond-activity badge on Bond nav.
// Side-effect module. Watches the latest entry in three sub-collections:
//   • bonds/{cid}/kindness     ordered by at desc
//   • bonds/{cid}/dates        ordered by completedAt desc
//   • bonds/{cid}/qotw         ordered by updatedAt desc
// If any of the latest docs were authored / answered by the partner
// AFTER the user last opened /bond, paints a pink dot on every
// button[data-page="bond"].
//
// Cleared when the user navigates to /bond (writes lastSeenAt = now).
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";

const SEEN_KEY = "nvvunenu.bondLastSeenAt";

let _unsubs = [];
let _coupleId = null;
let _myUid = null;
let _state = { kindness: 0, dates: 0, qotw: 0 };

onAppState((s) => {
  if (!s.ready) return;
  _myUid = s.user?.uid;
  if (!_myUid || !s.coupleId) { teardown(); return; }
  if (s.coupleId === _coupleId) return;
  teardown();
  _coupleId = s.coupleId;
  attach("kindness", "at",          (m) => m.by   !== _myUid);
  attach("dates",    "completedAt", () => true);   // completion can come from either side; both are bond-positive
  attach("qotw",     "updatedAt",   (m) => {
    const answers = m.answers || {};
    return Object.keys(answers).some((k) => k !== _myUid);
  });
});

function attach(sub, timeField, isInbound) {
  const q = query(
    collection(db, "bonds", _coupleId, sub),
    orderBy(timeField, "desc"),
    limit(1)
  );
  const off = onSnapshot(q, (snap) => {
    let latest = 0;
    snap.forEach((d) => {
      const m = d.data() || {};
      if (!isInbound(m)) return;
      const t = m[timeField]?.toMillis?.() || m[timeField]?.seconds * 1000 || 0;
      if (t > latest) latest = t;
    });
    _state[sub] = latest;
    paintBadge(maxLatest() > getLastSeen());
  });
  _unsubs.push(off);
}

function maxLatest() {
  return Math.max(_state.kindness, _state.dates, _state.qotw);
}

const origLoadPage = window.loadPage;
window.loadPage = function (page) {
  if (page === "bond") {
    setLastSeen(Date.now());
    paintBadge(false);
  }
  if (typeof origLoadPage === "function") origLoadPage(page);
  // After the new page renders (next frame is enough — modules paint
  // synchronously), re-apply the badge so newly-mounted buttons pick
  // up the current state. Especially Profile Quick Links data-act="bond".
  setTimeout(() => {
    paintBadge(maxLatest() > getLastSeen());
  }, 30);
};

function teardown() {
  _unsubs.forEach((off) => { try { off(); } catch {} });
  _unsubs = [];
  _coupleId = null;
  _state = { kindness: 0, dates: 0, qotw: 0 };
  paintBadge(false);
}

function getLastSeen() {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; }
}
function setLastSeen(ms) {
  try { localStorage.setItem(SEEN_KEY, String(ms)); } catch {}
}

function paintBadge(on) {
  const sels = 'button[data-page="bond"], button[data-act="bond"]';
  document.querySelectorAll(sels).forEach((b) => {
    b.classList.toggle("has-bond-badge", !!on);
  });
  if (!document.getElementById("nv-bond-badge-style")) {
    const s = document.createElement("style");
    s.id = "nv-bond-badge-style";
    s.textContent = `
      button[data-page="bond"], button[data-act="bond"] { position: relative; }
      button.has-bond-badge::after {
        content: "";
        position: absolute; top: 8px; right: 12px;
        width: 9px; height: 9px; border-radius: 50%;
        background: linear-gradient(135deg,#ff7eb6,#ff5e7e);
        box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 4px 10px rgba(255,126,182,.45);
        animation: nv-bond-badge-in .3s cubic-bezier(.22,1,.36,1);
      }
      @keyframes nv-bond-badge-in {
        from { opacity: 0; transform: scale(.4); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(s);
  }
}
