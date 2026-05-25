// =====================================================================
// modules/settings.js — app settings page.
// Sections: Appearance (theme), Account, Notifications, Premium, About,
//           Danger zone (sign out + delete-account placeholder).
// =====================================================================
import { auth } from "../firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { onAppState } from "../state/appState.js";
import { toast, toastSuccess, toastError, safe } from "../utils/toast.js";
import { getSubscription, PLANS } from "../services/subscriptionService.js";

const THEME_KEY = "nvvunenu.theme";    // "dark" | "light"
const NOTIFY_KEY = "nvvunenu.notify";  // "1" | "0"

export function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || "dark"; }
  catch { return "dark"; }
}
export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", t === "light");
  document.body.classList.toggle("theme-dark",  t === "dark");
  // Update mobile status-bar color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#F7F8FB" : "#0F1117");
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

export function getNotifyEnabled() {
  try { return (localStorage.getItem(NOTIFY_KEY) ?? "1") === "1"; }
  catch { return true; }
}
export function setNotifyEnabled(on) {
  try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch {}
}

// ----- Page render -----
export async function renderSettings(container) {
  container.innerHTML = shell();

  // Hydrate state when appState is ready (or immediately if already)
  let off = onAppState(async (s) => {
    if (!s.ready) return;
    off?.(); off = null;

    const sub = await safe(() => getSubscription(s.user.uid), "Couldn't load plan");
    paint(container, s, sub);
  });

  // Cleanup
  return () => { try { off?.(); } catch {} };
}

function shell() {
  const t = getStoredTheme();
  const n = getNotifyEnabled();
  return `
    <section class="settings-page">
      <h1 class="page-title">Settings</h1>

      <div class="card settings-section" id="setAppearance">
        <h3 class="settings-h">Appearance</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">Theme</div>
            <div class="settings-sub">Choose how Nuvvu Nenu looks.</div>
          </div>
          <div class="seg" role="tablist" aria-label="Theme">
            <button class="seg-btn ${t==='dark'?'active':''}"  data-theme="dark"  role="tab">🌙 Dark</button>
            <button class="seg-btn ${t==='light'?'active':''}" data-theme="light" role="tab">☀️ Light</button>
          </div>
        </div>
      </div>

      <div class="card settings-section" id="setAccount">
        <h3 class="settings-h">Account</h3>
        <div class="settings-row" id="rowAccount">
          <div>
            <div class="settings-label" id="acctName">…</div>
            <div class="settings-sub"   id="acctEmail">…</div>
          </div>
          <button class="btn btn-ghost" id="btnEditProfile">Edit profile</button>
        </div>
      </div>

      <div class="card settings-section" id="setPremium">
        <h3 class="settings-h">Plan</h3>
        <div class="settings-row" id="rowPlan">
          <div>
            <div class="settings-label" id="planName">Loading…</div>
            <div class="settings-sub"   id="planSub">—</div>
          </div>
          <button class="btn btn-primary" id="btnUpgrade">Upgrade</button>
        </div>
      </div>

      <div class="card settings-section" id="setNotify">
        <h3 class="settings-h">Notifications</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">In-app notifications</div>
            <div class="settings-sub">Toasts for new messages, calls and pokes.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleNotify" ${n?'checked':''}>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="card settings-section" id="setAbout">
        <h3 class="settings-h">About</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">Nuvvu Nenu</div>
            <div class="settings-sub">A place for two hearts. Vanilla JS + Firebase.</div>
          </div>
        </div>
      </div>

      <div class="card settings-section danger" id="setDanger">
        <h3 class="settings-h">Account actions</h3>
        <div class="settings-actions">
          <button class="btn btn-ghost"   id="btnSignOut">Sign out</button>
          <button class="btn btn-danger"  id="btnDelete">Delete account…</button>
        </div>
      </div>
    </section>

    <style>
      .settings-page{display:flex;flex-direction:column;gap:14px;padding-bottom:24px}
      .page-title{font-size:1.5rem;font-weight:800;margin:6px 2px}
      .settings-section{display:flex;flex-direction:column;gap:10px}
      .settings-h{font-size:.8125rem;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0}
      .settings-row{display:flex;align-items:center;gap:12px;justify-content:space-between}
      .settings-row > div:first-child{min-width:0;flex:1}
      .settings-label{font-weight:600;color:var(--text)}
      .settings-sub{font-size:.8125rem;color:var(--muted);margin-top:2px}
      .settings-actions{display:flex;gap:10px;flex-wrap:wrap}
      .seg{display:inline-flex;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-full);padding:3px}
      .seg-btn{padding:7px 12px;border-radius:var(--radius-full);font-size:.8125rem;color:var(--muted);font-weight:600}
      .seg-btn.active{background:var(--card);color:var(--text);box-shadow:var(--shadow-sm)}
      .switch{position:relative;display:inline-block;width:44px;height:26px;flex-shrink:0}
      .switch input{opacity:0;width:0;height:0}
      .switch .slider{position:absolute;inset:0;background:var(--surface);border:1px solid var(--border);border-radius:99px;transition:.2s}
      .switch .slider::before{content:"";position:absolute;left:3px;top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s}
      .switch input:checked + .slider{background:var(--glow-pink);border-color:transparent}
      .switch input:checked + .slider::before{transform:translateX(18px)}
      .btn-danger{background:rgba(255,99,99,.12);color:#ff8a8a;border:1px solid rgba(255,99,99,.35)}
      .btn-danger:hover{background:rgba(255,99,99,.18)}
      .danger .settings-h{color:#ff8a8a}
    </style>
  `;
}

function paint(container, s, sub) {
  // Account
  const name  = s.user?.displayName || s.user?.username || "You";
  const email = s.user?.email || "";
  container.querySelector("#acctName").textContent  = name;
  container.querySelector("#acctEmail").textContent = email;

  // Plan
  const planId = sub?.plan || "free";
  const def = PLANS[planId] || PLANS.free;
  container.querySelector("#planName").textContent = def.label;
  container.querySelector("#planSub").textContent =
    planId === "free" ? "You're on the Free plan."
    : `$${def.priceMonthly.toFixed(2)} / month — thanks for supporting us 💕`;

  // Theme buttons
  container.querySelectorAll(".seg-btn[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.theme;
      applyTheme(t);
      container.querySelectorAll(".seg-btn[data-theme]").forEach((b) =>
        b.classList.toggle("active", b === btn));
      toast(`Theme: ${t}`);
    });
  });

  // Notifications
  container.querySelector("#toggleNotify").addEventListener("change", (e) => {
    setNotifyEnabled(e.target.checked);
    toast(e.target.checked ? "Notifications on" : "Notifications off");
  });

  // Account / Plan / Danger actions
  container.querySelector("#btnEditProfile").addEventListener("click", () => {
    if (typeof window.loadPage === "function") window.loadPage("profile");
  });
  container.querySelector("#btnUpgrade").addEventListener("click", () => {
    if (typeof window.loadPage === "function") window.loadPage("subscription");
  });
  container.querySelector("#btnSignOut").addEventListener("click", async () => {
    await safe(() => signOut(auth), "Couldn't sign out");
    // onAuthStateChanged in app.js will redirect.
  });
  container.querySelector("#btnDelete").addEventListener("click", () => {
    toastError("Account deletion will be available soon. Email support to delete now.");
  });
}
