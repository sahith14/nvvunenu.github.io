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
import { formatActivity } from "../services/presenceService.js";
import { addMemory } from "../services/memoryService.js";
import { aiCall } from "../services/aiProvider.js";
import {
  doc, addDoc, collection, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const MOODS = [
  { emoji: "😊", label: "Happy"             },
  { emoji: "🥰", label: "Loving"            },
  { emoji: "🥺", label: "Miss You"          },
  { emoji: "💭", label: "Thinking of you"   },
  { emoji: "🙂", label: "Calm"              },
  { emoji: "✨", label: "Vibing"            },
  { emoji: "😴", label: "Sleeping"          },
  { emoji: "💼", label: "Busy"              },
  { emoji: "🎮", label: "Gaming"            },
  { emoji: "🥹", label: "Need Attention"    },
  { emoji: "😤", label: "Angry"             },
  { emoji: "😔", label: "Low"               },
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

      <section class="mood-nudge" id="moodNudge" hidden>
        <div class="mood-nudge__icon">🌙</div>
        <div class="mood-nudge__body">
          <div class="mood-nudge__title">Share today's mood</div>
          <div class="mood-nudge__sub">Keep the streak alive. A single tap is enough.</div>
        </div>
        <button class="btn mood-nudge__cta" id="moodNudgeBtn">Pick a mood</button>
      </section>

      <section class="anniv-banner" id="annivBanner" hidden>
        <div class="anniv-banner__icon">🎂</div>
        <div class="anniv-banner__body">
          <div class="anniv-banner__title" id="annivBannerTitle">Anniversary coming up</div>
          <div class="anniv-banner__sub"   id="annivBannerSub">…</div>
        </div>
        <button class="btn anniv-banner__cta" id="annivBannerCta">Plan</button>
      </section>

      <section class="anniv-banner anniv-banner--bday" id="bdayBanner" hidden>
        <div class="anniv-banner__icon">🎂</div>
        <div class="anniv-banner__body">
          <div class="anniv-banner__title" id="bdayBannerTitle">Birthday coming up</div>
          <div class="anniv-banner__sub"   id="bdayBannerSub">…</div>
        </div>
        <button class="btn anniv-banner__cta" id="bdayBannerCta">Plan</button>
      </section>

      <section class="ai-recap" id="aiRecap">
        <div class="ai-recap__head">
          <span class="ai-recap__badge">✨ AI</span>
          <h3>This week with you</h3>
        </div>
        <p class="ai-recap__body" id="aiRecapBody">
          We're crunching the numbers on your week together. Recaps appear here every Sunday with a snapshot of your highlights.
        </p>
        <button class="btn btn-ghost ai-recap__cta" id="aiRecapCta">Open Memories</button>
      </section>

      <section class="quick-actions" id="quickActions">
        <button class="quick-action" id="qaTogether"><span class="icon">🫧</span><span class="label">Together</span></button>
        <button class="quick-action" id="qaKiss"><span class="icon">💋</span><span class="label">Send Kiss</span></button>
        <button class="quick-action" id="qaCall"><span class="icon">🌙</span><span class="label">Sleep Mode</span></button>
        <button class="quick-action" id="qaMemory"><span class="icon">📸</span><span class="label">Add Memory</span></button>
        <button class="quick-action" id="qaNote"><span class="icon">💌</span><span class="label">Surprise Note</span></button>
        <button class="quick-action" id="qaPlay"><span class="icon">🎮</span><span class="label">Play Game</span></button>
        <button class="quick-action" id="qaBond"><span class="icon">💫</span><span class="label">Our Bond</span></button>
      </section>

      <button class="home-capture-fab" id="homeCaptureFab" aria-label="Capture a memory" title="Capture a memory">
        <span class="home-capture-fab__icon">📷</span>
      </button>
      <input type="file" id="homeCaptureInput" accept="image/*" capture="environment" hidden>
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
    const activityFmt = formatActivity(partner.activity);
    if (activityFmt) {
      statusEl.textContent = `${activityFmt.icon} ${activityFmt.text}`;
    } else {
      statusEl.textContent = presence.online ? "Online now" : "Offline";
    }
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
  paintAnnivBanner(startTs);
  paintBdayBanner(s.partner);
  paintMoodNudge(s);
}

function paintMeta(meta, s) {
  if (!_container) return;
  const bondEl    = _container.querySelector("#bondScore");
  const streakEl  = _container.querySelector("#streakDays");
  if (bondEl)   bondEl.textContent   = (meta?.bondScore ?? 50) + "";

  // Streak — sourced from the user doc (streakService maintains it)
  const streakNow  = Number(s?.user?.streak     ?? meta?.streak ?? 0);
  const streakBest = Number(s?.user?.streakBest ?? streakNow);
  if (streakEl) {
    streakEl.innerHTML = `${streakNow}${
      streakBest > 0 && streakBest >= streakNow
        ? ` <span class="streak-best ${streakNow > 0 && streakNow === streakBest ? "is-record" : ""}">${streakNow > 0 && streakNow === streakBest ? "🏆" : "best " + streakBest}</span>`
        : ""
    }`;
  }

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

  // AI recap heuristic — local, no API. Picks a template based on stats.
  paintRecap(meta, s);
}

function paintRecap(meta, s) {
  const body = _container?.querySelector("#aiRecapBody");
  if (!body) return;
  const partnerName = s.partner?.displayName?.split(" ")[0] || s.partner?.username || "your partner";
  const bond = meta?.bondScore ?? 50;
  const streak = meta?.streak ?? 0;
  const days = (() => {
    const t = s.user?.togetherSince?.toMillis?.() ?? s.user?.matchedAt?.toMillis?.();
    return t ? Math.max(1, Math.floor((Date.now() - t) / 86_400_000)) : 0;
  })();

  // Local heuristic — used when no AI provider is plugged in.
  const lines = [];
  if (days > 0)    lines.push(`You and ${partnerName} have shared ${days} day${days === 1 ? "" : "s"} together.`);
  if (streak >= 3) lines.push(`That's a ${streak}-day streak going strong 🔥`);
  if (bond >= 75)  lines.push("Your bond score is glowing — keep it up.");
  else if (bond >= 50) lines.push("Steady week. A little surprise note could spark things.");
  else             lines.push("It's been quiet. Try a quick voice note or memory drop.");

  // Paint the heuristic immediately so the card is never empty.
  body.innerHTML = lines.map((l) => `<span>${l}</span>`).join(" ");

  // Then ask a real provider (if one is plugged in) for a richer recap.
  const summary = {
    partnerName, bondScore: bond, streak, daysTogether: days,
    moods: meta?.moods || {},
  };
  aiCall("recapWeek", summary).then((text) => {
    if (typeof text === "string" && text.trim()) {
      body.innerHTML = `<span>${escapeHtml(text.trim())}</span>`;
    }
  }).catch(() => {});
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
  _container.querySelector("#qaTogether").addEventListener("click", () => window.loadPage?.("together"));
  _container.querySelector("#qaKiss").addEventListener("click", sendKiss);
  _container.querySelector("#qaCall").addEventListener("click", () => window.loadPage?.("together"));
  _container.querySelector("#qaMemory").addEventListener("click", () => window.loadPage?.("memories"));
  _container.querySelector("#qaNote").addEventListener("click", openSurpriseNote);
  _container.querySelector("#qaPlay").addEventListener("click", () => window.loadPage?.("together"));
  _container.querySelector("#qaBond").addEventListener("click", () => window.loadPage?.("bond"));
  _container.querySelector("#aiRecapCta")?.addEventListener("click", () => window.loadPage?.("memories"));

  // Quick capture — open camera, save the photo as a memory in one tap.
  const fab   = _container.querySelector("#homeCaptureFab");
  const input = _container.querySelector("#homeCaptureInput");
  fab?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", onCaptureFile);
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



// =====================================================================
// Anniversary banner — surfaces only within 14 days of the next
// month/day occurrence of the start date. Quietly hidden otherwise.
// =====================================================================
function paintAnnivBanner(startTs) {
  const banner = _container?.querySelector("#annivBanner");
  if (!banner) return;
  if (!startTs) { banner.hidden = true; return; }

  const start = new Date(startTs);
  const today = new Date();
  // Next anniversary is the start month/day in either this year or next.
  let next = new Date(today.getFullYear(), start.getMonth(), start.getDate());
  // Strip time; compare against today at midnight
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (next < todayMid) next.setFullYear(today.getFullYear() + 1);
  const days = Math.round((next - todayMid) / 86400000);
  const yearsAway = next.getFullYear() - start.getFullYear();

  // Hide when too far out
  if (days > 14) { banner.hidden = true; return; }

  const titleEl = _container.querySelector("#annivBannerTitle");
  const subEl   = _container.querySelector("#annivBannerSub");
  const ctaEl   = _container.querySelector("#annivBannerCta");
  const dateStr = next.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  let titleTxt = "";
  let subTxt   = "";
  if (days === 0) {
    titleTxt = "Happy anniversary 💜";
    subTxt   = `Year ${yearsAway} together — celebrate today.`;
    banner.classList.add("is-today");
  } else if (days === 1) {
    titleTxt = "Anniversary tomorrow";
    subTxt   = `${dateStr} · year ${yearsAway} together. Plan something soft.`;
    banner.classList.remove("is-today");
  } else {
    titleTxt = `${days} days to your anniversary`;
    subTxt   = `${dateStr} · year ${yearsAway} together.`;
    banner.classList.remove("is-today");
  }

  if (titleEl) titleEl.textContent = titleTxt;
  if (subEl)   subEl.textContent   = subTxt;
  if (ctaEl) {
    ctaEl.textContent = days === 0 ? "Open Bond" : "Plan a date";
    ctaEl.onclick = () => window.loadPage?.(days === 0 ? "bond" : "dates");
  }
  banner.hidden = false;
}


// =====================================================================
// Quick capture — turns a single camera shot into a saved memory.
// =====================================================================
async function onCaptureFile(ev) {
  const input = ev.target;
  const file  = input.files?.[0];
  // Reset so picking the same file twice still fires "change"
  input.value = "";
  if (!file) return;

  const s = getState();
  if (!s.coupleId) {
    toastWarn("Connect with your partner first");
    return;
  }

  const fab = _container?.querySelector("#homeCaptureFab");
  fab?.classList.add("is-uploading");
  toast("Saving moment…");

  const today = new Date();
  const titleAuto = today.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const ok = await safe(() => addMemory({
    coupleId: s.coupleId,
    title: titleAuto,
    description: "",
    date: today.toISOString().slice(0, 10),
    file,
    onProgress: () => {},
    sourceKind: "camera",
  }), "Couldn't save memory");

  fab?.classList.remove("is-uploading");
  if (ok !== false) {
    toastSuccess("Saved 💜");
    // Optional: jump to memories so the user can see it
    setTimeout(() => window.loadPage?.("memories"), 500);
  }
}


// =====================================================================
// Partner birthday banner — within 14 days of partner.birthday (MM-DD)
// =====================================================================
function paintBdayBanner(partner) {
  const banner = _container?.querySelector("#bdayBanner");
  if (!banner) return;
  const mmdd = partner?.birthday;
  const days = bdayDaysAway(mmdd);
  if (days === null || days > 14) { banner.hidden = true; return; }

  const titleEl = _container.querySelector("#bdayBannerTitle");
  const subEl   = _container.querySelector("#bdayBannerSub");
  const ctaEl   = _container.querySelector("#bdayBannerCta");
  const partnerName = partner?.displayName?.split(" ")[0] || partner?.username || "your partner";
  const dateStr = formatBdayDate(mmdd);

  let titleTxt, subTxt;
  if (days === 0) {
    titleTxt = `🎂 Happy birthday to ${partnerName}!`;
    subTxt   = "Make today gentle and warm.";
    banner.classList.add("is-today");
  } else if (days === 1) {
    titleTxt = `${partnerName}'s birthday is tomorrow`;
    subTxt   = `${dateStr} · plan a small surprise.`;
    banner.classList.remove("is-today");
  } else {
    titleTxt = `${days} days to ${partnerName}'s birthday`;
    subTxt   = `${dateStr} · time to plan something kind.`;
    banner.classList.remove("is-today");
  }
  if (titleEl) titleEl.textContent = titleTxt;
  if (subEl)   subEl.textContent   = subTxt;
  if (ctaEl) {
    ctaEl.textContent = days === 0 ? "Send a kiss" : "Plan a date";
    ctaEl.onclick = () => {
      if (days === 0) sendKiss();
      else            window.loadPage?.("dates");
    };
  }
  banner.hidden = false;
}

function bdayDaysAway(mmdd) {
  if (!mmdd) return null;
  const m = /^(\d{2})-(\d{2})$/.exec(String(mmdd));
  if (!m) return null;
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < todayMid) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - todayMid) / 86400000);
}
function formatBdayDate(mmdd) {
  if (!mmdd) return "";
  const m = /^(\d{2})-(\d{2})$/.exec(String(mmdd));
  if (!m) return "";
  const d = new Date(2024, Number(m[1]) - 1, Number(m[2]));
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}


// =====================================================================
// Mood nudge card — surfaces only when today's moodLog entry is empty.
// Tapping the CTA opens the existing mood picker modal.
// =====================================================================
function paintMoodNudge(s) {
  const card = _container?.querySelector("#moodNudge");
  if (!card) return;
  const me = s?.user || {};
  const today = todayKeyLocal();
  const log = (me.moodLog && typeof me.moodLog === "object") ? me.moodLog : {};
  const sharedToday = !!log[today];
  if (sharedToday) { card.hidden = true; return; }
  card.hidden = false;
  const btn = _container.querySelector("#moodNudgeBtn");
  if (btn) btn.onclick = () => openMoodPicker();
}

function todayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
