// services/chatBadge.js — Unread-message badge on the Chat nav buttons.
// Side-effect: import for boot. Subscribes to the chat doc once a couple
// is paired and paints a small pink dot on:
//   • bottom-nav button[data-page="chat"]
//   • side-nav  button[data-page="chat"]  (id ends in -desktop)
// Cleared automatically because chatService writes unread.{uid} = 0
// whenever the user opens the chat (subscribeMessages → markDeliveredAndSeen).
// =====================================================================
import { db } from "../firebase.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";
import { chatIdFor } from "./chatService.js";

let _unsub = null;
let _coupleId = null;

onAppState((s) => {
  if (!s.ready) return;
  const myUid = s.user?.uid;
  const partnerId = s.partnerId;
  if (!myUid || !partnerId) {
    teardown();
    return;
  }
  const chatId = chatIdFor(myUid, partnerId);
  if (chatId === _coupleId) return;        // already subscribed
  teardown();
  _coupleId = chatId;
  _unsub = onSnapshot(doc(db, "chats", chatId), (snap) => {
    const data = snap.data() || {};
    const n = Number((data.unread || {})[myUid] || 0);
    paintBadge(n);
  });
});

function teardown() {
  try { _unsub?.(); } catch {}
  _unsub = null; _coupleId = null;
  paintBadge(0);
}

function paintBadge(n) {
  // Add a tiny pink dot via .has-badge / .badge-count attributes the CSS
  // can pick up. Works on any button[data-page="chat"] in either nav.
  const btns = document.querySelectorAll('button[data-page="chat"]');
  btns.forEach((b) => {
    if (n > 0) {
      b.classList.add("has-badge");
      b.setAttribute("data-badge", n > 99 ? "99+" : String(n));
    } else {
      b.classList.remove("has-badge");
      b.removeAttribute("data-badge");
    }
  });
  // Inject the badge CSS once
  if (!document.getElementById("nv-chat-badge-style")) {
    const s = document.createElement("style");
    s.id = "nv-chat-badge-style";
    s.textContent = `
      button[data-page="chat"] { position: relative; }
      button[data-page="chat"].has-badge::after {
        content: attr(data-badge);
        position: absolute; top: 4px; right: 8px;
        min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 999px;
        background: linear-gradient(135deg,#ff5e7e,#ff7eb6);
        color: #fff;
        font-size: 9px; font-weight: 800;
        display: grid; place-items: center;
        box-shadow: 0 2px 6px rgba(255,94,126,.5);
        animation: nv-chat-badge-in .25s cubic-bezier(.22,1,.36,1);
      }
      @keyframes nv-chat-badge-in {
        from { opacity: 0; transform: scale(.4); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(s);
  }
}
