// =====================================================================
// modules/profile.js — Your own profile (edit-yourself surface).
// Migrated to appState (no inline getDoc(users/uid) calls).
// Avatar upload via services/storageService.js.
// All editing flows use modals — no prompt() / confirm().
// =====================================================================
import { auth, db } from "../firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState, getState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";
import { uploadMedia, compressImage } from "../services/storageService.js";
import { setUsername, isUsernameAvailable } from "../services/feedService.js";
import { getSubscription, PLANS } from "../services/subscriptionService.js";

let _container = null;
let _offState  = null;

export function renderProfile(container) {
  _container = container;
  _container.innerHTML = `<div class="profile-loading">${skeletonList(3, "card")}</div>`;

  _offState = onAppState(async (s) => {
    if (!s.ready) return;
    paint(s);
    const sub = await safe(() => getSubscription(s.user.uid), null);
    if (sub) paintPlanRow(sub);
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  _offState = null; _container = null;
}

// =========================================================================
// Render
// =========================================================================
function paint(s) {
  const me = s.user || {};
  const name = me.displayName || me.username || "You";
  const handle = me.username ? `@${me.username}` : "Set a username";
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const avatarUrl = me.photoURL ||
    (typeof window.avatarFor === "function" ? window.avatarFor(me, me.uid) : null);

  // Aura ring color set comes from currentMood emoji or a stored preference.
  const auraKey = pickAuraKey(me.currentMood);
  const planBadge = pickPlanBadge(me);
  const moodStrip = renderMoodStrip(me.moodLog);

  _container.innerHTML = `
    <section class="profile-page stagger">
      <header class="profile-hero">
        <button class="profile-avatar-wrap profile-avatar-wrap--aura" data-aura="${auraKey}"
                id="btnAvatarUpload"
                title="Change photo" aria-label="Change profile photo">
          <span class="profile-aura-ring" aria-hidden="true"></span>
          ${avatarUrl
            ? `<img class="profile-avatar" alt="" src="${avatarUrl}" referrerpolicy="no-referrer">`
            : `<div class="profile-avatar profile-avatar--initial">${escapeHtml(initial)}</div>`}
          ${planBadge
            ? `<span class="profile-plan-badge ${planBadge.cls}" title="${escapeHtml(planBadge.title)}" aria-label="${escapeHtml(planBadge.title)}">${planBadge.icon}</span>`
            : ""}
          <span class="profile-avatar-edit">📷</span>
        </button>
        <div class="profile-meta">
          <div class="profile-name">${escapeHtml(name)}</div>
          <div class="profile-handle" id="profileHandle">${escapeHtml(handle)}</div>
        </div>
      </header>

      ${moodStrip}

      <section class="card profile-section">
        <h3 class="profile-h">About you</h3>
        <p class="profile-bio" id="profileBio">${escapeHtml(me.bio || "")}</p>
        <div class="profile-row-actions">
          <button class="btn btn-ghost"   data-act="editBio">Edit bio</button>
          <button class="btn btn-ghost"   data-act="editName">Edit username</button>
          <button class="btn btn-primary" data-act="viewPublic">View public profile</button>
        </div>
      </section>

      <section class="card profile-section">
        <h3 class="profile-h">Your emotional identity</h3>
        <ul class="identity-list">
          <li><button data-edit="loveStyle"   class="identity-row">
            <span class="ic">💜</span><div><div class="row-label">Love style</div>
            <div class="row-val">${escapeHtml(me.loveStyle || "Tap to set")}</div></div>
            <span class="row-arrow">›</span></button></li>
          <li><button data-edit="comfortSong" class="identity-row">
            <span class="ic">🎵</span><div><div class="row-label">Comfort song</div>
            <div class="row-val">${escapeHtml(me.comfortSong || "Not set")}</div></div>
            <span class="row-arrow">›</span></button></li>
          <li><button data-edit="currentMood" class="identity-row">
            <span class="ic">🌙</span><div><div class="row-label">Current mood</div>
            <div class="row-val">${escapeHtml(me.currentMood || "—")}</div></div>
            <span class="row-arrow">›</span></button></li>
          <li><button data-edit="favMemory"   class="identity-row">
            <span class="ic">📸</span><div><div class="row-label">Favorite memory</div>
            <div class="row-val">${escapeHtml(me.favMemory || "Not set")}</div></div>
            <span class="row-arrow">›</span></button></li>
          <li><button data-edit="customStatus" class="identity-row">
            <span class="ic">✨</span><div><div class="row-label">Custom status</div>
            <div class="row-val">${escapeHtml(me.customStatus || "Tap to set")}</div></div>
            <span class="row-arrow">›</span></button></li>
        </ul>
      </section>

      <section class="card profile-section" id="planRow">
        <h3 class="profile-h">Plan</h3>
        <div class="profile-plan">
          <div>
            <div class="row-label" id="planName">…</div>
            <div class="row-val"   id="planSub">—</div>
          </div>
          <button class="btn btn-primary" data-act="upgrade">Manage plan</button>
        </div>
      </section>

      <section class="card profile-section">
        <h3 class="profile-h">Quick links</h3>
        <ul class="settings-list">
          <li><button class="settings-item" data-act="bond">
            <span class="icon">💞</span><span class="label">Bond / Pairing</span><span class="arrow">›</span></button></li>
          <li><button class="settings-item" data-act="widgets">
            <span class="icon">📱</span><span class="label">Lock-screen widgets</span><span class="arrow">›</span></button></li>
          <li><button class="settings-item" data-act="copyCode">
            <span class="icon">🔗</span><span class="label">Copy invite code</span><span class="arrow">›</span></button></li>
          <li><button class="settings-item" data-act="settings">
            <span class="icon">⚙️</span><span class="label">Settings</span><span class="arrow">›</span></button></li>
          <li><button class="settings-item danger" data-act="signOut">
            <span class="icon">👋</span><span class="label">Sign out</span><span class="arrow">›</span></button></li>
        </ul>
      </section>
    </section>
  `;

  wireActions();
}

function paintPlanRow(sub) {
  const planId = sub?.plan || "free";
  const def = PLANS[planId] || PLANS.free;
  const nameEl = _container?.querySelector("#planName");
  const subEl  = _container?.querySelector("#planSub");
  if (nameEl) nameEl.textContent = def.label;
  if (subEl)  subEl.textContent  = planId === "free"
    ? "You're on the Free plan."
    : `${def.label} · $${def.priceMonthly.toFixed(2)} / month`;

  // Refresh the avatar plan-badge from the live subscription doc
  const wrap = _container?.querySelector("#btnAvatarUpload");
  if (wrap) {
    wrap.querySelector(".profile-plan-badge")?.remove();
    const badge = pickPlanBadge({ plan: planId });
    if (badge) {
      const el = document.createElement("span");
      el.className = `profile-plan-badge ${badge.cls}`;
      el.title = badge.title;
      el.setAttribute("aria-label", badge.title);
      el.textContent = badge.icon;
      // Insert before the camera icon so DOM order matches initial render
      const editIcon = wrap.querySelector(".profile-avatar-edit");
      wrap.insertBefore(el, editIcon || null);
    }
  }
}

// =========================================================================
// Actions
// =========================================================================
function wireActions() {
  // Avatar upload
  _container.querySelector("#btnAvatarUpload")?.addEventListener("click", openAvatarPicker);

  // Section actions
  _container.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener("click", () => onAction(btn.dataset.act));
  });

  // Identity row edits
  _container.querySelectorAll('button[data-edit]').forEach((btn) => {
    btn.addEventListener("click", () => openEditFieldModal(btn.dataset.edit));
  });
}

function onAction(act) {
  switch (act) {
    case "editBio":     return openBioModal();
    case "editName":    return openUsernameModal();
    case "viewPublic":  return viewMyPublic();
    case "upgrade":     return window.loadPage?.("subscription");
    case "bond":        return window.loadPage?.("bond");
    case "widgets":     return window.loadPage?.("widgets");
    case "settings":    return window.loadPage?.("settings");
    case "copyCode":    return copyInviteCode();
    case "signOut":     return openSignOutModal();
  }
}

async function viewMyPublic() {
  const s = getState();
  if (!s.user?.uid) return;
  window.__viewUserUid = s.user.uid;
  window.loadPage?.("profileView");
}

async function copyInviteCode() {
  const uid = getState().user?.uid;
  if (!uid) return toastError("Not signed in");
  try {
    await navigator.clipboard.writeText(uid);
    toastSuccess("Invite code copied — share it with your partner");
  } catch {
    toastWarn("Couldn't copy automatically — your code is your UID");
  }
}

// =========================================================================
// Modals
// =========================================================================
function openModal({ title, body, primary = "Save", onSubmit, onMounted }) {
  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <div class="bond-modal__head">${escapeHtml(title)}</div>
      <div class="bond-modal__body">${body}</div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">${escapeHtml(primary)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const ok = wrap.querySelector('[data-act="ok"]');
    ok.disabled = true;
    const handled = await Promise.resolve(onSubmit(wrap));
    ok.disabled = false;
    if (handled !== false) close();
  });
  onMounted?.(wrap);
  (wrap.querySelector("textarea, input") || null)?.focus();
}

const FIELD_LABELS = {
  loveStyle:    { label: "Love style",    placeholder: "Gentle, Passionate, Playful, Protective…" },
  comfortSong:  { label: "Comfort song",  placeholder: "Artist — Song" },
  currentMood:  { label: "Current mood",  placeholder: "🌙 Calm" },
  favMemory:    { label: "Favorite memory", placeholder: "A line about a moment that means a lot…" },
  customStatus: { label: "Custom status", placeholder: "✨ At the rooftop, missing them" },
};

function openEditFieldModal(field) {
  const def = FIELD_LABELS[field] || { label: field, placeholder: "" };
  const me  = getState().user || {};
  const cur = me[field] || "";

  openModal({
    title: `Edit: ${def.label}`,
    body: `<label class="bond-field"><span>${escapeHtml(def.label)}</span>
             <input id="fldVal" type="text" maxlength="120"
                    placeholder="${escapeAttr(def.placeholder)}" value="${escapeAttr(cur)}"></label>`,
    primary: "Save",
    onSubmit: async (root) => {
      const v = root.querySelector("#fldVal").value.trim();
      const ok = await safe(
        () => updateDoc(doc(db, "users", me.uid), { [field]: v }),
        "Couldn't save"
      );
      if (ok !== null) toastSuccess("Saved 💜");
    }
  });
}

function openBioModal() {
  const me = getState().user || {};
  openModal({
    title: "Edit your bio",
    body: `<label class="bond-field"><span>Bio (200 chars max)</span>
             <textarea id="bioVal" rows="3" maxlength="200" placeholder="A line about you…">${escapeHtml(me.bio || "")}</textarea></label>`,
    primary: "Save",
    onSubmit: async (root) => {
      const v = root.querySelector("#bioVal").value.trim().slice(0, 200);
      const ok = await safe(() => updateDoc(doc(db, "users", me.uid), { bio: v }), "Couldn't save");
      if (ok !== null) toastSuccess("Bio updated");
    }
  });
}

function openUsernameModal() {
  const me = getState().user || {};
  openModal({
    title: "Edit username",
    body: `
      <label class="bond-field"><span>Username (3+ chars, a–z 0–9 _ . )</span>
        <input id="userVal" type="text" maxlength="30"
               placeholder="your_username" value="${escapeAttr(me.username || "")}"></label>
      <p class="bond-tip" id="userStatus">Type a username and we'll check availability.</p>
    `,
    primary: "Save",
    onSubmit: async (root) => {
      const v = root.querySelector("#userVal").value.trim().toLowerCase();
      if (!v) { toastWarn("Pick a username"); return false; }
      try {
        const claimed = await setUsername(v);
        toastSuccess(`Username set: @${claimed}`);
      } catch (e) {
        if (e?.message === "USERNAME_TAKEN")        toastError("That username is taken");
        else if (e?.message === "USERNAME_TOO_SHORT") toastWarn("Username must be 3+ characters");
        else                                          toastError("Couldn't set username");
        return false;
      }
    },
    onMounted: (root) => {
      const inp = root.querySelector("#userVal");
      const out = root.querySelector("#userStatus");
      let t = null;
      inp.addEventListener("input", () => {
        clearTimeout(t);
        const v = inp.value.trim().toLowerCase();
        if (!v || v.length < 3) { out.textContent = "Type at least 3 characters."; return; }
        out.textContent = "Checking…";
        t = setTimeout(async () => {
          try {
            const ok = await isUsernameAvailable(v);
            out.textContent = ok ? "✅ Available" : "❌ That one is taken";
          } catch { out.textContent = ""; }
        }, 350);
      });
    }
  });
}

function openSignOutModal() {
  openModal({
    title: "Sign out?",
    body: `<p class="bond-modal__p">You'll be returned to the login screen. Your data stays safe.</p>`,
    primary: "Sign out",
    onSubmit: async () => {
      const ok = await safe(() => signOut(auth), "Couldn't sign out");
      if (ok !== null) toast("Signed out");
      // app.js's onAuthStateChanged will redirect to login.html
    }
  });
}

// =========================================================================
// Avatar upload
// =========================================================================
function openAvatarPicker() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.style.display = "none";
  inp.addEventListener("change", async () => {
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toastError("Max 8 MB"); return; }
    await uploadAvatar(file);
  });
  document.body.appendChild(inp);
  inp.click();
  setTimeout(() => inp.remove(), 1000);
}

async function uploadAvatar(file) {
  const me = getState().user;
  if (!me?.uid) return toastError("Not signed in");

  // Optimistic preview
  const wrap = _container?.querySelector("#btnAvatarUpload");
  let url;
  try { url = URL.createObjectURL(file); } catch {}
  if (url && wrap) {
    const previewHtml = `<img class="profile-avatar" alt="" src="${url}" referrerpolicy="no-referrer">
                         <span class="profile-avatar-edit">⏳</span>`;
    wrap.innerHTML = previewHtml;
  }

  toast("Uploading photo…");
  const compressed = await compressImage(file, 800, 0.85);
  const upload = await safe(
    () => uploadMedia(compressed, { folder: `avatars/${me.uid}` }),
    "Upload failed"
  );
  if (!upload) {
    if (url) URL.revokeObjectURL(url);
    paint(getState());
    return;
  }

  await safe(
    () => updateDoc(doc(db, "users", me.uid), { photoURL: upload.url }),
    "Saved photo, but couldn't update profile"
  );
  if (url) URL.revokeObjectURL(url);
  toastSuccess("Photo updated 💜");
  // appState onSnapshot will fire and re-paint via the listener.
}

// =========================================================================
// helpers
// =========================================================================
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}



// =====================================================================
// Aura ring + plan badge + mood-history helpers
// =====================================================================
const AURA_BY_MOOD = {
  // emoji prefix → aura palette key
  "💜": "calm",     "🥰": "love",    "🌸": "bloom",
  "🥺": "tender",   "🌙": "night",   "✨": "glow",
  "😍": "love",     "🌧": "rain",    "🌊": "ocean",
  "🔥": "warm",     "🌿": "fresh",   "🌻": "sunny",
};
function pickAuraKey(currentMood) {
  if (!currentMood) return "calm";
  const ch = [...String(currentMood)][0];
  return AURA_BY_MOOD[ch] || "calm";
}

function pickPlanBadge(me) {
  // Use whatever plan signal we have on the user doc; the plan card paints later
  // from the subscription doc, so this is a best-effort visual hint that updates
  // every render. Falls back to no badge for free users.
  const plan = me?.plan || me?.subscription?.plan || null;
  if (plan === "forever")        return { cls: "is-forever",  icon: "♾",  title: "Forever plan" };
  if (plan === "together_plus")  return { cls: "is-together", icon: "✦",  title: "Together+" };
  return null;
}

function renderMoodStrip(moodLog) {
  const days = lastNDays(7);
  const log = moodLog && typeof moodLog === "object" ? moodLog : {};
  const cells = days.map(({ key, short }) => {
    const emoji = log[key];
    return `
      <div class="mood-strip__cell ${emoji ? "is-set" : ""}">
        <div class="mood-strip__emoji">${emoji ? escapeHtml(emoji) : "·"}</div>
        <div class="mood-strip__day">${short}</div>
      </div>`;
  }).join("");
  return `
    <section class="card profile-section">
      <h3 class="profile-h">Past 7 days</h3>
      <div class="mood-strip">${cells}</div>
      <p class="profile-hint">Each day's check-in lives here. Pick a mood on Home to fill today.</p>
    </section>`;
}

function lastNDays(n) {
  const out = [];
  const labels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push({ key: `${y}-${m}-${day}`, short: labels[d.getDay()] });
  }
  return out;
}
