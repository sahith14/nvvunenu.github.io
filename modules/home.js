// =====================================================================
// modules/home.js — Couple home dashboard.
// Reactive: subscribes to appState; hooks coupleService for poke/mood/bond.
// All data flows: appState (user/partner) + couples/{coupleId}/meta/stats.
// =====================================================================
import { db } from "../firebase.js";
import { onAppState, getState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";
import {
  initCoupleMeta, subscribeCoupleMeta, sendThinkingOfYou,
  updateMood, daysTogether
} from "../services/coupleService.js";
import {
  doc, addDoc, collection, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const MOODS = [
  { emoji: "😊", label: "Happy"   },
  { emoji: "🥰", label: "Loving"  },
  { emoji: "🙂", label: "Calm"    },
  { emoji: "😴", label: "Tired"   },
  { emoji: "😤", label: "Stressed"},
  { emoji: "😔", label: "Low"     },
];

let _container = null;
let _offState  = null;
let _unsubMeta = null;
let _tickerId  = null;
let _myMood    = null;        // { emoji, label }
let _lastPokeAt = 0;          // ms

export function renderHome(container) {
  _container = container;
  _container.innerHTML = `
    <div class="home-page stagger">
      <header class="home-hero">
        <h1 class="home-greeting" id="homeGreeting">…</h1>
      </header>

      <section class="presence-card" id="presenceCard" role="button" tabindex="0">
        <div class="presence-avatar">
          <img id="partnerPhoto" alt="" hidden referrerpolicy="no-referrer">
          <span id="partnerInitial" aria-hidden="true">💜</span>
          <div class="orb presence-orb" id="presenceOrb"></div>
        </div>
        <div class="presence-info">
          <div class="presence-name"   id="partnerName">Find your partner</div>
          <div class="presence-status" id="partnerStatus">Tap to connect →</div>
          <div class="presence-last"   id="partnerLast"></div>
        </div>
        <button class="poke-btn" id="pokeBtn" hidden title="Send a 'Thinking of you'">💞</button>
      </section>

      <section class="checkin-section">
        <h3>Today's Check-in</h3>
        <div class="checkin-card" id="checkinCard">
          <div class="checkin-mood"  id="myMood">🙂</div>
          <div class="checkin-details">
            <div class="label">How are you feeling?</div>
            <div class="value" id="myNeed">Tap to share your mood</div>
            <div class="love-battery"><div class="fill" id="batteryFill" style="width:50%"></div></div>
          </div>
        </div>
      </section>

      <section class="today-stats" id="todayStats">
        <div class="stat-card"><div class="num" id="streakDays">—</div><div class="label">Day streak</div></div>
        <div class="stat-card"><div class="num" id="bondScore">—</div><div class="label">Bond</div></div>
        <div class="stat-card"><div class="num" id="totalDays">—</div><div class="label">Together</div></div>
        <div class="stat-card"><div class="num" id="memCount">—</div><div class="label">Memories</div></div>
      </section>

      <section class="quick-actions" id="quickActions">
        <button class="quick-action" id="qaKiss"><span class="icon">💋</span><span class="label">Send Kiss</span></button>
        <button class="quick-action" id="qaCall"><span class="icon">🌙</span><span class="label">Sleep Call</span></button>
        <button class="quick-action" id="qaMemory"><span class="icon">📸</span><span class="label">Add Memory</span></button>
        <button class="quick-action" id="qaNote"><span class="icon">💌</span><span class="label">Surprise Note</span></button>
        <button class="quick-action" id="qaPlay"><span class="icon">🎮</span><span class="label">Play Game</span></button>
        <button class="quick-action" id="qaBond"><span class="icon">💫</span><span class="label">Our Bond</span></button>
      </section>
    </div>
  `;

  wireQuickActions();
  wirePresenceCard();
  wireCheckinCard();

  // React to appState
  _offState = onAppState(async (s) => {
    if (!s.ready) return;
    paint(s);

    // (Re)subscribe to couple meta when coupleId changes
    if (s.coupleId) {
      try { _unsubMeta?.(); } catch {}
      _unsubMeta = null;
      // Initialize meta doc if missing (safe upsert)
      const otherUid = s.partnerId;
      try {
        await initCoupleMeta(s.coupleId, s.user.uid, otherUid, s.user.matchedAt || new Date());
      } catch (e) { /* rules may forbid until paired both sides — ignore */ }
      _unsubMeta = subscribeCoupleMeta(s.coupleId, (meta) => paintMeta(meta, s));
    }
  });

  // Light ticker to keep "last seen" fresh
  _tickerId = setInterval(() => {
    const s = getState();
    if (s?.partner?.status?.lastSeen) updateLastSeen(s.partner.status.lastSeen);
  }, 30_000);

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsubMeta?.(); } catch {}
  clearInterval(_tickerId);
  _offState = null; _unsubMeta = null; _tickerId = null;
  _container = null; _myMood = null; _lastPokeAt = 0;
}

// ---------- Painters ----------

function paint(s) {
  if (!_container) return;
  const me = s.user || {};
  const partner = s.partner || {};
  const firstName = (me.displayName || me.username || "You").split(" ")[0];

  _container.querySelector("#homeGreeting").textContent =
    `${greeting()}, ${firstName} 💜`;

  const card     = _container.querySelector("#presenceCard");
  const photoEl  = _container.querySelector("#partnerPhoto");
  const initEl   = _container.querySelector("#partnerInitial");
  const nameEl   = _container.querySelector("#partnerName");
  const statusEl = _container.querySelector("#partnerStatus");
  const lastEl   = _container.querySelector("#partnerLast");
  const orbEl    = _container.querySelector("#presenceOrb");
  const pokeEl   = _container.querySelector("#pokeBtn");

  if (s.partnerId && partner?.uid) {
    card.dataset.paired = "1";
    card.style.cursor = "default";
    nameEl.textContent = partner.displayName || partner.username || "Partner";
    const presence = partner.status || {};
    statusEl.textContent = presence.online ? "Online now" : "Offline";
    if (orbEl) orbEl.classList.toggle("online", !!presence.online);
    updateLastSeen(presence.lastSeen);
    pokeEl.hidden = false;

    if (partner.photoURL) {
      photoEl.src = partner.photoURL;
      photoEl.hidden = false;
      initEl.hidden = true;
    } else {
      photoEl.hidden = true; photoEl.removeAttribute("src");
      initEl.hidden = false;
      initEl.textContent = (partner.displayName || partner.username || "?").trim().charAt(0).toUpperCase();
    }
  } else {
    delete card.dataset.paired;
    card.style.cursor = "pointer";
    nameEl.textContent = "Find your partner";
    statusEl.textContent = "Tap to connect →";
    lastEl.textContent = "";
    orbEl.classList.remove("online");
    pokeEl.hidden = true;
    photoEl.hidden = true; photoEl.removeAttribute("src");
    initEl.hidden = false; initEl.textContent = "💜";
  }

  // Days together (uses me.togetherSince OR matchedAt)
  const startTs = me.togetherSince?.toMillis?.() ?? me.matchedAt?.toMillis?.() ?? null;
  const totalDaysEl = _container.querySelector("#totalDays");
  if (totalDaysEl) {
    totalDaysEl.textContent = startTs ? daysTogether({ toMillis: () => startTs }) : "—";
  }
}

function paintMeta(meta, s) {
  if (!_container) return;
  const bondEl    = _container.querySelector("#bondScore");
  const streakEl  = _container.querySelector("#streakDays");
  if (bondEl)   bondEl.textContent   = (meta?.bondScore ?? 50) + "";
  if (streakEl) streakEl.textContent = (meta?.streak    ?? 0)  + "";

  // My mood (if previously set, reflect it)
  const myMood = meta?.moods?.[s.user?.uid];
  if (myMood?.emoji) {
    _container.querySelector("#myMood").textContent = myMood.emoji;
    _container.querySelector("#myNeed").textContent = myMood.label || "Mood shared";
    _myMood = myMood;
  }

  // Track our own lastPoke for cooldown UI
  const lp = meta?.lastPokeAt?.[s.user?.uid];
  _lastPokeAt = lp?.toMillis?.() || 0;
}

function updateLastSeen(ts) {
  const lastEl = _container?.querySelector("#partnerLast");
  if (!lastEl) return;
  if (!ts) { lastEl.textContent = ""; return; }
  const ms = ts?.toMillis?.() ?? +new Date(ts);
  if (!ms) { lastEl.textContent = ""; return; }
  lastEl.textContent = "Last seen " + relativeTime(ms);
}

// ---------- Wiring ----------

function wirePresenceCard() {
  const card = _container.querySelector("#presenceCard");
  card.addEventListener("click", (e) => {
    if (e.target.closest("#pokeBtn")) return; // poke handled separately
    if (!card.dataset.paired) window.loadPage?.("bond");
  });
  card.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !card.dataset.paired) {
      e.preventDefault(); window.loadPage?.("bond");
    }
  });

  _container.querySelector("#pokeBtn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const s = getState();
    if (!s.coupleId || !s.partnerId) return;
    const remaining = 3 * 60 * 1000 - (Date.now() - _lastPokeAt);
    if (remaining > 0) {
      const sec = Math.ceil(remaining / 1000);
      toastWarn(`Wait ${sec}s before sending another 💞`);
      return;
    }
    e.currentTarget.disabled = true;
    const out = await safe(
      () => sendThinkingOfYou(s.coupleId, s.user.uid, s.partnerId),
      "Couldn't send 💞"
    );
    e.currentTarget.disabled = false;
    if (out?.ok) toastSuccess("💞 Thinking of you, sent");
    else if (out?.nextAt) toastWarn("Sent recently — try again in a moment");
  });
}

function wireCheckinCard() {
  _container.querySelector("#checkinCard").addEventListener("click", openMoodPicker);
}

function wireQuickActions() {
  _container.querySelector("#qaKiss").addEventListener("click", sendKiss);
  _container.querySelector("#qaCall").addEventListener("click", () => window.loadPage?.("space"));
  _container.querySelector("#qaMemory").addEventListener("click", () => window.loadPage?.("moments"));
  _container.querySelector("#qaNote").addEventListener("click", openSurpriseNote);
  _container.querySelector("#qaPlay").addEventListener("click", () => window.loadPage?.("space"));
  _container.querySelector("#qaBond").addEventListener("click", () => window.loadPage?.("bond"));
}

// ---------- Actions ----------

async function sendKiss() {
  const s = getState();
  if (!s.partnerId) return toastWarn("Connect with your partner first");
  // Persist a notification (server-side rules permitting); always toast locally.
  try {
    await addDoc(collection(db, "notifications"), {
      type: "kiss", from: s.user.uid, to: s.partnerId,
      createdAt: serverTimestamp()
    });
  } catch (e) { /* swallow — UX still positive */ }
  toastSuccess("💋 Kiss sent");
}

function openMoodPicker() {
  const s = getState();
  if (!s?.user?.uid) return;
  openModal({
    title: "How are you feeling?",
    body: `
      <div class="hm-mood-grid">
        ${MOODS.map(m => `
          <button type="button" class="hm-mood-btn" data-emoji="${m.emoji}" data-label="${escapeHtml(m.label)}">
            <span class="hm-mood-emoji">${m.emoji}</span>
            <span class="hm-mood-label">${escapeHtml(m.label)}</span>
          </button>`).join("")}
      </div>
      <div class="hm-battery-wrap">
        <label class="hm-battery-label">Love battery <span id="hmBattVal">50</span></label>
        <input type="range" id="hmBattInput" min="0" max="100" value="50">
      </div>
    `,
    primary: "Save",
    onSubmit: async (root) => {
      const sel = root.querySelector(".hm-mood-btn.active");
      const emoji = sel?.dataset.emoji || _myMood?.emoji || "🙂";
      const label = sel?.dataset.label || _myMood?.label || "Calm";
      const battery = +(root.querySelector("#hmBattInput")?.value || 50);

      // Update local UI immediately for responsiveness
      _container.querySelector("#myMood").textContent = emoji;
      _container.querySelector("#myNeed").textContent = label;
      _container.querySelector("#batteryFill").style.width = `${battery}%`;

      // Persist mood on couple meta + my own checkin doc
      if (s.coupleId) {
        await safe(() => updateMood(s.coupleId, s.user.uid, emoji), "Couldn't share mood");
      }
      await safe(() => setDoc(doc(db, "checkins", s.user.uid), {
        mood: emoji, need: label, battery, timestamp: serverTimestamp()
      }, { merge: true }), "Couldn't save check-in");
      toastSuccess("Check-in saved 💜");
    },
    onMounted: (root) => {
      // Toggle selection
      const btns = root.querySelectorAll(".hm-mood-btn");
      btns.forEach((b) => {
        b.addEventListener("click", () => {
          btns.forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
        });
      });
      // Default-select current mood
      if (_myMood?.emoji) {
        const cur = root.querySelector(`.hm-mood-btn[data-emoji="${CSS.escape(_myMood.emoji)}"]`);
        cur?.classList.add("active");
      }
      // Battery readout
      const range = root.querySelector("#hmBattInput");
      const out   = root.querySelector("#hmBattVal");
      range?.addEventListener("input", () => { out.textContent = range.value; });
    }
  });
}

function openSurpriseNote() {
  const s = getState();
  if (!s.partnerId) return toastWarn("Connect with your partner first");
  openModal({
    title: "Send a surprise note 💌",
    body: `
      <label class="bond-field"><span>Your note</span>
        <textarea id="hmNote" rows="3" maxlength="280"
          placeholder="Just a little something… 💜"></textarea></label>
    `,
    primary: "Send",
    onSubmit: async (root) => {
      const note = root.querySelector("#hmNote").value.trim();
      if (!note) { toastWarn("Write something first"); return false; }
      const ok = await safe(() => addDoc(collection(db, "surprises"), {
        from: s.user.uid, to: s.partnerId, note,
        createdAt: serverTimestamp(), opened: false
      }), "Couldn't send note");
      if (ok !== null) toastSuccess("💌 Note sent");
    }
  });
}

// ---------- Modal helper (matches bond.js style) ----------

function openModal({ title, body, primary, onSubmit, onMounted }) {
  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
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
    const okBtn = wrap.querySelector('[data-act="ok"]');
    okBtn.disabled = true;
    const handled = await Promise.resolve(onSubmit(wrap));
    okBtn.disabled = false;
    if (handled !== false) close();
  });
  onMounted?.(wrap);
  // Focus first focusable
  (wrap.querySelector("textarea, input, button[data-act]") || null)?.focus();
}

// ---------- helpers ----------
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}
function relativeTime(ms) {
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
