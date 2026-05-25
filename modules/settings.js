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
import { db } from "../firebase.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { askNativeNotifPermission, nativeNotifSupported, nativeNotifPermission } from "../services/notifyService.js";
import { setAIDemoEnabled, isAIDemoEnabled } from "../services/aiProviderMock.js";

const THEME_KEY = "nvvunenu.theme";    // legacy — kept for cleanup only
const NOTIFY_KEY = "nvvunenu.notify";  // "1" | "0"

// Dark mode is removed for now. applyTheme is a no-op that just ensures
// the cute pastel theme is the only thing active.
export function getStoredTheme() { return "cute"; }
export function applyTheme() {
  document.body.classList.remove("theme-light", "theme-dark", "theme-cute");
  document.documentElement.classList.remove("theme-light", "theme-dark", "theme-cute");
  document.body.classList.add("theme-cute");
  document.documentElement.classList.add("theme-cute");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", "#fff5fa");
  // Clear any prior dark setting so a refresh doesn't restore it.
  try { localStorage.removeItem(THEME_KEY); } catch {}
}

export function getNotifyEnabled() {
  try { return (localStorage.getItem(NOTIFY_KEY) ?? "1") === "1"; }
  catch { return true; }
}
export function setNotifyEnabled(on) {
  try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch {}
}

// =====================================================================
// Notification snooze — short-term mute. Persists ms-since-epoch
// timestamp; once Date.now() passes it, snooze is no longer active.
// =====================================================================
const NOTIF_SNOOZE_KEY = "nvvunenu.notifSnoozeUntil";
export function setNotifSnooze(durationMs) {
  try {
    if (!durationMs || durationMs <= 0) localStorage.removeItem(NOTIF_SNOOZE_KEY);
    else localStorage.setItem(NOTIF_SNOOZE_KEY, String(Date.now() + Number(durationMs)));
  } catch {}
}
export function notifSnoozeEnd() {
  try {
    const v = Number(localStorage.getItem(NOTIF_SNOOZE_KEY) || 0);
    return v > Date.now() ? v : 0;
  } catch { return 0; }
}
export function isNotifSnoozed() { return notifSnoozeEnd() > 0; }

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
  const n = getNotifyEnabled();
  return `
    <section class="settings-page">
      <h1 class="page-title">Settings</h1>

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
            <div class="settings-sub">Master switch — turns all toasts on or off.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleNotify" ${n?'checked':''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="settings-row" id="rowNativeNotif">
          <div>
            <div class="settings-label">Browser notifications</div>
            <div class="settings-sub" id="nativeNotifSub">…</div>
          </div>
          <button class="btn btn-ghost" id="btnNativeNotif">Enable</button>
        </div>
        <div class="settings-row" id="rowSnooze">
          <div>
            <div class="settings-label">Snooze</div>
            <div class="settings-sub" id="snoozeSub">All notifications are flowing.</div>
          </div>
          <div class="snooze-chips">
            <button class="snooze-chip" data-mins="60">1h</button>
            <button class="snooze-chip" data-mins="240">4h</button>
            <button class="snooze-chip" data-mins="480">8h</button>
            <button class="snooze-chip" data-mins="0" id="snoozeOff" hidden>Resume</button>
          </div>
        </div>
        <div class="settings-prefs" id="notifPrefs"></div>
      </div>

      <div class="card settings-section" id="setAIDemo">
        <h3 class="settings-h">AI</h3>
        <div class="settings-row">
          <div>
            <div class="settings-label">AI demo mode</div>
            <div class="settings-sub">Plug in canned responses so you can see how transcripts, smart replies, weekly recaps and memory captions feel — no API key needed.</div>
          </div>
          <label class="switch">
            <input type="checkbox" id="toggleAIDemo">
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
        <div class="settings-row">
          <div>
            <div class="settings-label">Welcome tour</div>
            <div class="settings-sub">See the four-card intro again.</div>
          </div>
          <button class="btn btn-ghost" id="btnReplayTour">Show tour</button>
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
      .settings-prefs{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding-top:10px;border-top:1px solid var(--border)}
      .settings-pref{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center;padding:8px 4px}
      .settings-pref.is-disabled{opacity:.55}
      .settings-pref__icon{font-size:18px;line-height:1;text-align:center}
      .settings-pref__body{min-width:0}
      .snooze-chips{display:flex;gap:6px;flex-wrap:wrap}
      .snooze-chip{
        padding:6px 12px;border-radius:999px;border:1px solid var(--border);
        background:var(--surface);color:var(--text);
        font-family:inherit;font-size:.75rem;font-weight:700;cursor:pointer;
        transition:all .15s var(--ease-out);
      }
      .snooze-chip:hover{border-color:#9b8cff;transform:translateY(-1px)}
      #snoozeOff{
        background:linear-gradient(135deg,#7effc2,#5ed3a3);
        color:#fff;border-color:transparent;
      }
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

  // Notifications
  container.querySelector("#toggleNotify").addEventListener("change", (e) => {
    setNotifyEnabled(e.target.checked);
    toast(e.target.checked ? "Notifications on" : "Notifications off");
    paintNotifPrefs(container, s);
  });

  paintNotifPrefs(container, s);
  paintNativeNotifRow(container);
  paintSnoozeRow(container);

  // AI demo toggle
  const aiToggle = container.querySelector("#toggleAIDemo");
  if (aiToggle) {
    aiToggle.checked = isAIDemoEnabled();
    aiToggle.addEventListener("change", (e) => {
      setAIDemoEnabled(e.target.checked);
      toast(e.target.checked
        ? "AI demo on — try a transcript or recap"
        : "AI demo off");
    });
  }

  // Account / Plan / Danger actions
  container.querySelector("#btnEditProfile").addEventListener("click", () => {
    if (typeof window.loadPage === "function") window.loadPage("profile");
  });
  container.querySelector("#btnUpgrade").addEventListener("click", () => {
    if (typeof window.loadPage === "function") window.loadPage("subscription");
  });
  container.querySelector("#btnReplayTour")?.addEventListener("click", () => {
    try { localStorage.removeItem("nvvunenu.tourSeen"); } catch {}
    toast("Tour reset · heading home");
    if (typeof window.loadPage === "function") window.loadPage("home");
  });
  container.querySelector("#btnSignOut").addEventListener("click", async () => {
    await safe(() => signOut(auth), "Couldn't sign out");
    // onAuthStateChanged in app.js will redirect.
  });
  container.querySelector("#btnDelete").addEventListener("click", () => {
    toastError("Account deletion will be available soon. Email support to delete now.");
  });
}



// =====================================================================
// Per-event notification preferences
// Persisted at users/{uid}.notifPrefs.{key} = boolean.
// Default = true for everything.
// =====================================================================
const NOTIF_PREFS = [
  { key: "sound",     label: "Notification sound", sub: "A soft 2-tone bell when partner activity arrives.", icon: "🔔" },
  { key: "messages",  label: "Messages",        sub: "Toast when your partner sends a chat message.",      icon: "💬" },
  { key: "calls",     label: "Incoming calls",  sub: "Ringer + toast for voice & video calls.",            icon: "📞" },
  { key: "moods",     label: "Mood shares",     sub: "Toast when your partner shares a new mood.",         icon: "🌙" },
  { key: "kindness",  label: "Kindness acts",   sub: "Toast when a kind act is logged on the bond.",       icon: "💛" },
  { key: "dates",     label: "Date completion", sub: "Toast when a date idea is marked done.",             icon: "🌹" },
  { key: "letters",   label: "Letter unlocks",  sub: "Toast when a sealed time-capsule letter unlocks.",   icon: "📜" },
  { key: "presence",  label: "Partner activity",sub: "Toast when partner starts a session (game / room).", icon: "🟢" },
  { key: "polls",     label: "Polls",           sub: "Toast when partner votes on a poll.",                icon: "📊" },
];

function paintNotifPrefs(container, s) {
  const host = container.querySelector("#notifPrefs");
  if (!host) return;
  const masterOn = getNotifyEnabled();
  const userPrefs = s.user?.notifPrefs || {};

  host.innerHTML = NOTIF_PREFS.map((p) => {
    const checked = isNotifPrefOn(userPrefs, p.key);
    return `
      <div class="settings-pref ${masterOn ? "" : "is-disabled"}">
        <div class="settings-pref__icon">${p.icon}</div>
        <div class="settings-pref__body">
          <div class="settings-label">${escape(p.label)}</div>
          <div class="settings-sub">${escape(p.sub)}</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-pref="${p.key}" ${checked ? "checked" : ""} ${masterOn ? "" : "disabled"}>
          <span class="slider"></span>
        </label>
      </div>`;
  }).join("");

  host.querySelectorAll('input[data-pref]').forEach((el) => {
    el.addEventListener("change", async (ev) => {
      const key = ev.target.dataset.pref;
      const on  = ev.target.checked;
      const ok = await safe(() => updateDoc(doc(db, "users", s.user.uid), {
        [`notifPrefs.${key}`]: on
      }), "Couldn't save preference");
      if (ok !== false) toast(`${on ? "On" : "Off"} · ${key}`);
    });
  });
}

export function isNotifPrefOn(userPrefs, key) {
  if (!getNotifyEnabled()) return false;        // master kill-switch
  if (isNotifSnoozed())     return false;        // snooze active
  if (!userPrefs) return true;                  // default on
  const v = userPrefs[key];
  return v === undefined ? true : !!v;
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}


// =====================================================================
// Browser-native notification permission row
// =====================================================================
function paintNativeNotifRow(container) {
  const row    = container.querySelector("#rowNativeNotif");
  const subEl  = container.querySelector("#nativeNotifSub");
  const btn    = container.querySelector("#btnNativeNotif");
  if (!row || !subEl || !btn) return;
  if (!nativeNotifSupported()) {
    subEl.textContent = "This browser doesn't support web notifications.";
    btn.style.display = "none";
    return;
  }
  const refresh = () => {
    const p = nativeNotifPermission();
    if (p === "granted") {
      subEl.textContent = "Enabled — alerts ring even when the tab is hidden.";
      btn.textContent = "Granted";
      btn.disabled = true;
    } else if (p === "denied") {
      subEl.textContent = "Blocked. Enable from your browser site settings.";
      btn.textContent = "Blocked";
      btn.disabled = true;
    } else {
      subEl.textContent = "Get a real OS-level alert when partner activity arrives.";
      btn.textContent = "Enable";
      btn.disabled = false;
    }
  };
  refresh();
  btn.addEventListener("click", async () => {
    const result = await askNativeNotifPermission();
    refresh();
    if (result === "granted") toast("Browser notifications enabled");
    else if (result === "denied") toast("Permission blocked. Allow it from site settings.");
  });
}


// =====================================================================
// Snooze row — quick mute for 1h / 4h / 8h
// =====================================================================
function paintSnoozeRow(container) {
  const sub  = container.querySelector("#snoozeSub");
  const off  = container.querySelector("#snoozeOff");
  if (!sub || !off) return;

  const refresh = () => {
    const end = notifSnoozeEnd();
    if (!end) {
      sub.textContent = "All notifications are flowing.";
      off.hidden = true;
    } else {
      const ms = end - Date.now();
      const m  = Math.max(1, Math.round(ms / 60000));
      const txt = m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
      sub.textContent = `Muted for ${txt} more.`;
      off.hidden = false;
    }
  };

  container.querySelectorAll(".snooze-chip[data-mins]").forEach((b) => {
    b.addEventListener("click", () => {
      const mins = Number(b.dataset.mins);
      setNotifSnooze(mins ? mins * 60 * 1000 : 0);
      refresh();
      toast(mins ? `Muted for ${mins >= 60 ? Math.round(mins / 60) + "h" : mins + "m"}` : "Notifications resumed");
    });
  });
  refresh();

  // Tick every minute so the countdown stays fresh while Settings is open
  const interval = setInterval(refresh, 60_000);
  container.addEventListener("click", () => {}, { once: false });
  // Best-effort cleanup tied to the page render cycle
  if (window.__nvSnoozeInterval) clearInterval(window.__nvSnoozeInterval);
  window.__nvSnoozeInterval = interval;
}
