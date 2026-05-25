// services/togetherBadge.js — Partner-in-sub-view badge on Together nav.
// Side-effect module. Paints a small purple dot on every
// button[data-page="together"] when partner.activity.type matches one of
// the Together sub-view types: watching / listening / screen-sharing /
// sleeping / gaming.
//
// Cleared when the user opens /together (the activity strip + beacon
// inside the page already make the partner's state visible).
// =====================================================================
import { onAppState } from "../state/appState.js";

const ACTIVE_TYPES = new Set([
  "watching", "listening", "screen-sharing", "sleeping", "gaming",
]);

let _suppressed = false;   // set when user is on /together

onAppState((s) => {
  if (!s.ready) return;
  const t = s.partner?.activity?.type;
  const partnerInSub = !!t && ACTIVE_TYPES.has(t);
  paintBadge(partnerInSub && !_suppressed);
});

// Hook navigation so the badge clears the moment the user opens Together.
const origLoadPage = window.loadPage;
window.loadPage = function (page) {
  if (page === "together") {
    _suppressed = true;
    paintBadge(false);
  } else {
    _suppressed = false;
  }
  if (typeof origLoadPage === "function") origLoadPage(page);
};

function paintBadge(on) {
  document.querySelectorAll('button[data-page="together"]').forEach((b) => {
    b.classList.toggle("has-tg-badge", !!on);
  });
  if (!document.getElementById("nv-tg-badge-style")) {
    const s = document.createElement("style");
    s.id = "nv-tg-badge-style";
    s.textContent = `
      button[data-page="together"] { position: relative; }
      button[data-page="together"].has-tg-badge::after {
        content: "";
        position: absolute; top: 6px; right: 12px;
        width: 9px; height: 9px; border-radius: 50%;
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 0 14px rgba(155,140,255,.7);
        animation: nv-tg-badge-pulse 1.6s ease-in-out infinite;
      }
      @keyframes nv-tg-badge-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.25); }
      }
    `;
    document.head.appendChild(s);
  }
}
