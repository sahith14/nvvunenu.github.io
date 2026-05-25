// services/memoriesBadge.js — Unseen-memory badge on Memories nav buttons.
// Side-effect module. Subscribes to the most recent memory doc once a
// user has a coupleId. If the latest createdBy !== myUid AND its
// createdAt > lastSeenMs, paints a small gold dot on:
//   button[data-page="memories"]
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";

const SEEN_KEY = "nvvunenu.memoriesLastSeenAt";

let _unsub = null;
let _coupleId = null;
let _myUid = null;

onAppState((s) => {
  if (!s.ready) return;
  const myUid = s.user?.uid;
  const cid = s.coupleId;
  _myUid = myUid;
  if (!myUid || !cid) { teardown(); return; }
  if (cid === _coupleId) return;
  teardown();
  _coupleId = cid;
  const q = query(
    collection(db, "memories", cid, "entries"),
    orderBy("createdAt", "desc"),
    limit(1)
  );
  _unsub = onSnapshot(q, (snap) => {
    let unseen = false;
    snap.forEach((d) => {
      const m = d.data() || {};
      if (m.createdBy === myUid) return;
      const at = m.createdAt?.toMillis?.() || m.createdAt?.seconds * 1000 || 0;
      if (at > getLastSeen()) unseen = true;
    });
    paintBadge(unseen);
  });
});

// Hook navigation to /memories so the badge clears when the user looks.
const origLoadPage = window.loadPage;
window.loadPage = function (page) {
  if (page === "memories") {
    setLastSeen(Date.now());
    paintBadge(false);
  }
  if (typeof origLoadPage === "function") origLoadPage(page);
};

function teardown() {
  try { _unsub?.(); } catch {}
  _unsub = null; _coupleId = null;
  paintBadge(false);
}

function getLastSeen() {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch { return 0; }
}
function setLastSeen(ms) {
  try { localStorage.setItem(SEEN_KEY, String(ms)); } catch {}
}

function paintBadge(on) {
  document.querySelectorAll('button[data-page="memories"]').forEach((b) => {
    b.classList.toggle("has-mem-badge", !!on);
  });
  if (!document.getElementById("nv-mem-badge-style")) {
    const s = document.createElement("style");
    s.id = "nv-mem-badge-style";
    s.textContent = `
      button[data-page="memories"] { position: relative; }
      button[data-page="memories"].has-mem-badge::after {
        content: "";
        position: absolute; top: 6px; right: 12px;
        width: 9px; height: 9px; border-radius: 50%;
        background: linear-gradient(135deg,#ffd47a,#ff8a00);
        box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 4px 10px rgba(255,138,0,.45);
        animation: nv-mem-badge-in .3s cubic-bezier(.22,1,.36,1);
      }
      @keyframes nv-mem-badge-in {
        from { opacity: 0; transform: scale(.4); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(s);
  }
}
