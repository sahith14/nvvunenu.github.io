// =====================================================================
// modules/cuteFx.js — Floating hearts BG, click sparkles, ripple,
//                     like-bursts, confetti, cute modal.
// Auto-bootstraps on import. Exposes window.cuteConfetti / window.cuteModal.
// All CSS classes live under .cute-* (paired with styles/cuteFx.css).
// =====================================================================

const HEART_EMOJIS = ["💕","💜","💖","🌸","✨","💝","💗","🦋"];
const SPARK_EMOJIS = ["✨","💖","💕","⭐","🌟"];

let _booted = false;
let _heartsTimer = null;

// Quietly disable on the auth pages — only animate in the app shell.
function inAppShell() {
  return Boolean(document.getElementById("app"));
}

// Honor reduced-motion preferences for accessibility.
function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

// ---------- 1) Floating hearts background ----------
function mountHeartsBg() {
  if (document.getElementById("cuteHeartsBg")) return;
  if (reducedMotion()) return;
  const bg = document.createElement("div");
  bg.id = "cuteHeartsBg";
  bg.setAttribute("aria-hidden", "true");
  document.body.appendChild(bg);

  const spawn = () => {
    if (document.hidden) return;
    const h = document.createElement("span");
    h.className = "cute-heart";
    h.textContent = HEART_EMOJIS[Math.floor(Math.random() * HEART_EMOJIS.length)];
    h.style.left = Math.random() * 100 + "vw";
    h.style.fontSize = (16 + Math.random() * 16) + "px";
    const duration = 8 + Math.random() * 8;
    h.style.animationDuration = duration + "s";
    bg.appendChild(h);
    setTimeout(() => h.remove(), duration * 1000 + 200);
  };
  for (let i = 0; i < 4; i++) setTimeout(spawn, i * 500);
  _heartsTimer = setInterval(spawn, 2400);
}

// ---------- 2) Click sparkle bursts ----------
function mountClickSparkles() {
  if (reducedMotion()) return;
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest("button, a, .quick-action, .activity-card, .game-card, .chat-suggest__chip, .post-actions, .like-btn")) return;

    const x = e.clientX, y = e.clientY;
    const count = 6;
    for (let i = 0; i < count; i++) {
      const sp = document.createElement("span");
      sp.className = "cute-spark";
      sp.textContent = SPARK_EMOJIS[Math.floor(Math.random() * SPARK_EMOJIS.length)];
      sp.style.left = x + "px";
      sp.style.top  = y + "px";
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist  = 30 + Math.random() * 30;
      sp.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      sp.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 750);
    }
  }, { passive: true });
}

// ---------- 3) Button ripple ----------
function mountRipple() {
  if (reducedMotion()) return;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.classList.contains("tick") ||
        btn.classList.contains("cute-modal-close") ||
        btn.classList.contains("ah-btn") ||
        btn.classList.contains("seg-btn")) return;
    const rect = btn.getBoundingClientRect();
    const dot  = document.createElement("span");
    dot.className = "cute-ripple-dot";
    const size = Math.max(rect.width, rect.height);
    dot.style.width  = size + "px";
    dot.style.height = size + "px";
    dot.style.left   = (e.clientX - rect.left - size / 2) + "px";
    dot.style.top    = (e.clientY - rect.top  - size / 2) + "px";
    if (!btn.style.position) btn.style.position = "relative";
    btn.style.overflow = "hidden";
    btn.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  }, { passive: true });
}

// ---------- 4) Like-button heart bursts ----------
function mountLikeHearts() {
  if (reducedMotion()) return;
  document.addEventListener("click", (e) => {
    const likeBtn = e.target.closest(".like-btn, [data-action='like']");
    if (!likeBtn) return;
    const rect = likeBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    for (let i = 0; i < 8; i++) {
      const h = document.createElement("span");
      h.textContent = "💖";
      h.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;font-size:${14 + Math.random() * 14}px;pointer-events:none;z-index:9999;transition:all .9s cubic-bezier(.34,1.56,.64,1);`;
      document.body.appendChild(h);
      requestAnimationFrame(() => {
        const angle = (Math.PI * 2 * i) / 8;
        const dist  = 40 + Math.random() * 50;
        h.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 30}px) scale(1.4) rotate(${(Math.random() - 0.5) * 60}deg)`;
        h.style.opacity = "0";
      });
      setTimeout(() => h.remove(), 1000);
    }
  }, { passive: true });
}

// ---------- 5) Confetti (celebration) ----------
window.cuteConfetti = function (count = 60) {
  if (reducedMotion()) return;
  const colors = ["#ff8fb1", "#a78bfa", "#c8f7e2", "#ffd2c1", "#fff3b0", "#d8c9ff"];
  for (let i = 0; i < count; i++) {
    const c = document.createElement("span");
    c.className = "cute-confetti";
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.left = (50 + (Math.random() - 0.5) * 20) + "vw";
    c.style.setProperty("--tx", ((Math.random() - 0.5) * 200) + "vw");
    c.style.animationDelay = (Math.random() * 0.4) + "s";
    c.style.animationDuration = (1.5 + Math.random() * 1.5) + "s";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
};

// ---------- 6) Cute Modal (lightweight global modal helper) ----------
window.cuteModal = function ({ title = "Hello", icon = "💜", body = "", footer = "" } = {}) {
  document.querySelectorAll(".cute-modal").forEach((m) => m.remove());
  const modal = document.createElement("div");
  modal.className = "cute-modal";
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.innerHTML = `
    <div class="cute-modal-card">
      <div class="cute-modal-head">
        <h3>${escapeHtml(icon + " " + title)}</h3>
        <button class="cute-modal-close" aria-label="Close" onclick="this.closest('.cute-modal').remove()">×</button>
      </div>
      <div class="cute-modal-body">${body}</div>
      ${footer ? `<div class="cute-modal-footer">${footer}</div>` : ""}
    </div>`;
  document.body.appendChild(modal);
  return modal;
};
window.closeCuteModals = function () { document.querySelectorAll(".cute-modal").forEach((m) => m.remove()); };

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- Boot ----------
export function boot() {
  if (_booted) return;
  if (!inAppShell()) return;
  _booted = true;
  mountHeartsBg();
  mountClickSparkles();
  mountRipple();
  mountLikeHearts();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
