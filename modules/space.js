// =====================================================================
// modules/space.js — Couple Space (private relationship room).
// Reactive: subscribes to appState; replaces 4 inline getDoc(users/uid) calls.
// Wires real games via modules/spaceGames.js.
// =====================================================================
import { db } from "../firebase.js";
import { onAppState, getState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, safe } from "../utils/toast.js";
import { gateSleepTogether } from "../services/featureGate.js";
import { startVideoCall, startAudioCall } from "./callView.js";
import { mountGame } from "./spaceGames.js";
import { coupleMetaPath } from "../services/coupleService.js";
import {
  doc, setDoc, updateDoc, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let _container = null;
let _offState = null;
let _touchTimeout = null;
let _breathInterval = null;
let _breathOriginalHTML = null;
let _gameInstance = null;
let _unsubMeta = null;
let _currentTheme = "default";

// Room scenes — each adds floating particles and tints the live-room.
const ROOM_THEMES = [
  { key: "default",  icon: "🫧", label: "Default" },
  { key: "sakura",   icon: "🌸", label: "Sakura" },
  { key: "moonlit",  icon: "🌙", label: "Moonlit" },
  { key: "beach",    icon: "🏖", label: "Beach" },
  { key: "library",  icon: "📚", label: "Library" },
  { key: "aurora",   icon: "🌌", label: "Aurora" },
  { key: "cafe",     icon: "☕", label: "Café" },
];

// Catalog of real games (delegated to spaceGames.js).
const REAL_GAMES = [
  { type: "tictactoe", icon: "❌⭕", name: "Tic Tac Toe", desc: "Play with your partner" },
  { type: "connect4",  icon: "🔴🟡", name: "Connect 4",   desc: "Drop pieces" },
  { type: "chess",     icon: "♔",    name: "Chess",      desc: "Move pieces" }
];
// Quick "card draw" mini-games (text-only — toast result).
const QUICK_GAMES = {
  truth: ["What's one thing you've never told me?","What's your favorite memory of us?","What do you love most about me?","What scares you about our future?","When did you first know you loved me?"],
  compatibility: ["Favorite date night?","Dream vacation together?","How many kids?","City or countryside?","Morning person or night owl?"],
  guess: ["What would I choose: beach or mountains?","What's my biggest fear?","What makes me happiest?"],
  tarot: ["💜 The Lovers — Deep connection ahead","⭐ The Star — Hope and renewal in your bond","🌙 The Moon — Trust your intuition together","☀️ The Sun — Joy and warmth surround you","🎡 Wheel of Fortune — Exciting changes coming"],
  date: ["Cook dinner together 🍳","Stargazing night 🌟","Movie marathon 🎬","Write letters to each other 💌","Take a walk and talk 🚶","Play 20 questions 🎯"]
};

export function renderSpace(container) {
  _container = container;
  _container.innerHTML = `
    <div class="space-page stagger">
      <div class="live-room" id="liveRoom" data-room-theme="default">
        <div class="room-particles" id="roomParticles" aria-hidden="true"></div>
        <div class="breathing-orb"></div>
        <div class="room-avatars">
          <div class="room-avatar you">🫧</div>
          <div class="room-avatar partner">💜</div>
        </div>
        <div class="room-status" id="roomStatus">Your private space together</div>
      </div>

      <div class="room-themes" id="roomThemes">
        ${ROOM_THEMES.map(t => `
          <button class="room-theme-btn" data-theme="${t.key}" title="${t.label}">
            <span class="room-theme-btn__icon">${t.icon}</span>
            <span class="room-theme-btn__label">${t.label}</span>
          </button>
        `).join("")}
      </div>

      <div class="space-activities" id="spaceActivities">
        <button class="activity-card primary" data-act="video">
          <span class="icon">📹</span><span class="name">Video Call</span><span class="desc">Face to face</span>
        </button>
        <button class="activity-card primary" data-act="audio">
          <span class="icon">📞</span><span class="name">Voice Call</span><span class="desc">Just hear them</span>
        </button>
        <button class="activity-card" data-act="sleep">
          <span class="icon">🌙</span><span class="name">Sleep Together</span><span class="desc">Ambient comfort</span>
        </button>
        <button class="activity-card" data-act="watch">
          <span class="icon">🎬</span><span class="name">Watch Together</span><span class="desc">Synced viewing</span>
        </button>
        <button class="activity-card" data-act="breath">
          <span class="icon">🫁</span><span class="name">Breathing Sync</span><span class="desc">Calm together</span>
        </button>
        <button class="activity-card" data-act="games">
          <span class="icon">🎮</span><span class="name">Couple Games</span><span class="desc">Play together</span>
        </button>
      </div>

      <div class="touch-zone" id="touchZone">
        <div class="hint">Hold to send your touch</div>
        <div class="fingerprint">👆</div>
      </div>

      <div class="games-grid hidden" id="gamesGrid">
        ${REAL_GAMES.map((g) =>
          `<button class="game-card" data-game="${g.type}">
            <span class="icon">${g.icon}</span>
            <span class="name">${g.name}</span>
            <span class="desc">${g.desc}</span>
          </button>`
        ).join("")}
        ${["truth","compatibility","guess","tarot","date"].map((q) =>
          `<button class="game-card quick" data-quick="${q}">
            <span class="icon">${q==='tarot'?'🔮':q==='date'?'🎲':q==='truth'?'🎯':q==='compatibility'?'💕':'🤔'}</span>
            <span class="name">${q==='tarot'?'Love Tarot':q==='date'?'Date Roulette':q==='truth'?'Truth Game':q==='compatibility'?'Compatibility':'Guess My Answer'}</span>
            <span class="desc">Quick draw</span>
          </button>`
        ).join("")}
      </div>

      <div class="sp-game-slot" id="spGameSlot"></div>

      <div class="sleep-mode hidden" id="sleepMode">
        <div class="moon">🌙</div>
        <h3>Sleep Together Mode</h3>
        <p>Ambient comfort • Breathing glow • Goodnight</p>
        <button class="btn btn-ghost" id="btnExitSleep" style="margin-top:16px">Wake up ☀️</button>
      </div>
    </div>
  `;

  attachActivityHandlers();
  attachGameHandlers();
  attachThemeHandlers();
  setupTouch();

  // Mark presence + subscribe to couple meta (room theme syncs across both)
  _offState = onAppState((s) => {
    if (!s.ready) return;
    if (s.user?.uid) {
      safe(() => updateDoc(doc(db, "users", s.user.uid), {
        inSpace: true, lastSpaceVisit: serverTimestamp()
      }), null);
    }
    if (s.coupleId && !_unsubMeta) {
      attachMetaSubscription(s.coupleId);
    }
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsubMeta?.(); } catch {}
  clearTimeout(_touchTimeout);
  clearInterval(_breathInterval);
  try { _gameInstance?.destroy(); } catch {}
  _offState = null; _unsubMeta = null;
  _touchTimeout = null; _breathInterval = null;
  _gameInstance = null; _breathOriginalHTML = null;
  _container = null;
  _currentTheme = "default";
}

// ---------- Activity handlers ----------
function attachActivityHandlers() {
  _container.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'video') startCall('video');
      else if (act === 'audio') startCall('audio');
      else if (act === 'sleep') enterSleepMode();
      else if (act === 'watch') openWatchTogetherModal();
      else if (act === 'breath') startBreathingSync();
      else if (act === 'games') toggleGamesGrid();
    });
  });
  _container.querySelector('#btnExitSleep')?.addEventListener('click', exitSleepMode);
}

async function startCall(kind) {
  const s = getState();
  if (!s.partnerId) {
    toastWarn("Connect with your partner first 💜");
    window.loadPage?.('bond'); return;
  }
  const name = s.partner?.displayName?.split(' ')[0] || s.partner?.username || 'Partner';
  if (kind === 'video') startVideoCall(s.partnerId, name);
  else                  startAudioCall(s.partnerId, name);
}

function toggleGamesGrid() {
  const g = _container.querySelector('#gamesGrid');
  g.classList.toggle('hidden');
  if (!g.classList.contains('hidden')) g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- Touch zone ----------
function setupTouch() {
  const zone = _container.querySelector('#touchZone');
  if (!zone) return;
  const start = () => {
    zone.classList.add('active');
    _touchTimeout = setTimeout(sendTouch, 800);
  };
  const end = () => {
    zone.classList.remove('active');
    if (_touchTimeout) { clearTimeout(_touchTimeout); _touchTimeout = null; }
  };
  zone.addEventListener('touchstart', (e) => { e.preventDefault(); start(); }, { passive: false });
  zone.addEventListener('mousedown', start);
  zone.addEventListener('touchend',  end);
  zone.addEventListener('mouseup',   end);
  zone.addEventListener('mouseleave',end);
}

async function sendTouch() {
  const s = getState();
  if (!s.user?.uid) return;
  if (!s.partnerId) {
    toastWarn("Connect with your partner first 💜"); return;
  }
  if (navigator.vibrate) try { navigator.vibrate([50, 30, 50]); } catch {}
  toast('Touch sent 💜');
  await safe(() => setDoc(doc(db, 'touches', s.partnerId), {
    from: s.user.uid, type: 'hold', createdAt: serverTimestamp()
  }, { merge: true }), null);
}

// ---------- Sleep mode ----------
async function enterSleepMode() {
  // Premium-gated (Together+ unlocks)
  const gate = await gateSleepTogether();
  if (gate && gate.allowed === false) return; // featureGate handles toast + redirect
  _container.querySelector('#sleepMode')?.classList.remove('hidden');
  _container.querySelector('#spaceActivities')?.classList.add('hidden');
  _container.querySelector('#touchZone')?.classList.add('hidden');
  document.body.style.background = '#060810';
  toast('🌙 Sleep mode active');
}
function exitSleepMode() {
  _container.querySelector('#sleepMode')?.classList.add('hidden');
  _container.querySelector('#spaceActivities')?.classList.remove('hidden');
  _container.querySelector('#touchZone')?.classList.remove('hidden');
  document.body.style.background = '';
}

// ---------- Breathing sync ----------
function startBreathingSync() {
  const room = _container.querySelector('#liveRoom');
  if (!room) return;
  if (!_breathOriginalHTML) _breathOriginalHTML = room.innerHTML;

  toast('🫁 Breathe in… and out…');
  room.innerHTML = `
    <div class="breathing-orb" style="width:150px;height:150px;filter:blur(15px);animation:breathe 5s cubic-bezier(.22,1,.36,1) infinite"></div>
    <div style="position:relative;z-index:1;text-align:center">
      <p style="font-size:1.25rem;font-weight:600;color:var(--violet)" id="breathText">Breathe in…</p>
      <p style="font-size:.8rem;color:var(--muted);margin-top:8px">Tap below to stop</p>
      <button class="btn btn-ghost" id="btnStopBreath" style="margin-top:10px">Stop</button>
    </div>
  `;
  let inhale = true;
  _breathInterval = setInterval(() => {
    const el = _container?.querySelector('#breathText');
    if (el) el.textContent = inhale ? 'Breathe out…' : 'Breathe in…';
    inhale = !inhale;
  }, 4000);
  _container.querySelector('#btnStopBreath')?.addEventListener('click', stopBreathingSync);
}
function stopBreathingSync() {
  clearInterval(_breathInterval); _breathInterval = null;
  const room = _container?.querySelector('#liveRoom');
  if (room && _breathOriginalHTML) room.innerHTML = _breathOriginalHTML;
}

// ---------- Watch Together (modal, no prompt) ----------
function openWatchTogetherModal() {
  const s = getState();
  if (!s.partnerId || !s.coupleId) {
    toastWarn("Connect with your partner first 💜");
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'bond-modal';
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="Watch Together">
      <div class="bond-modal__head">🎬 Watch together</div>
      <div class="bond-modal__body">
        <p class="bond-modal__p">Paste a video link (YouTube, Vimeo, or direct URL). Your partner will get a notification.</p>
        <label class="bond-field"><span>Video URL</span>
          <input id="wtUrl" type="url" inputmode="url" placeholder="https://…"></label>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">Start session</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.querySelector('#wtUrl').focus();
  wrap.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    const url = wrap.querySelector('#wtUrl').value.trim();
    if (!url) return toastWarn("Paste a URL first");
    try { new URL(url); } catch { return toastWarn("That URL doesn't look right"); }
    const ok = await safe(
      () => setDoc(doc(db, 'watchSessions', s.coupleId), {
        url, startedBy: s.user.uid, playing: true, startedAt: serverTimestamp()
      }, { merge: true }),
      "Couldn't start session"
    );
    if (ok !== null) { toastSuccess("🎬 Session started"); close(); }
  });
}

// ---------- Games ----------
function attachGameHandlers() {
  _container.querySelectorAll('[data-game]').forEach((card) => {
    card.addEventListener('click', () => launchRealGame(card.dataset.game));
  });
  _container.querySelectorAll('[data-quick]').forEach((card) => {
    card.addEventListener('click', () => playQuick(card.dataset.quick));
  });
}

function launchRealGame(type) {
  // Tear down any existing instance
  try { _gameInstance?.destroy(); } catch {}
  const slot = _container.querySelector('#spGameSlot');
  if (!slot) return;
  _gameInstance = mountGame(type, slot);
  slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function playQuick(type) {
  const options = QUICK_GAMES[type] || [];
  if (!options.length) return;
  const pick = options[Math.floor(Math.random() * options.length)];
  toast(`🎮 ${pick}`, { duration: 4500 });
}



// =====================================================================
// Room theme: pick scene → persist to couples/{cid}/meta + subscribe so
// either partner can change the room and both see it instantly.
// =====================================================================
function attachThemeHandlers() {
  _container.querySelectorAll(".room-theme-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.theme;
      applyRoomTheme(key);             // optimistic local apply
      const s = getState();
      if (!s.coupleId) return;
      safe(() => setDoc(coupleMetaPath(s.coupleId), {
        roomTheme: key, updatedAt: serverTimestamp()
      }, { merge: true }), "Couldn't save room theme");
    });
  });
}

function attachMetaSubscription(coupleId) {
  _unsubMeta = onSnapshot(coupleMetaPath(coupleId), (snap) => {
    const data = snap.data() || {};
    const incoming = data.roomTheme || "default";
    if (incoming !== _currentTheme) applyRoomTheme(incoming);
  });
}

function applyRoomTheme(key) {
  if (!_container) return;
  _currentTheme = key;
  const room = _container.querySelector("#liveRoom");
  if (room) room.setAttribute("data-room-theme", key);
  // Highlight active button
  _container.querySelectorAll(".room-theme-btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.theme === key)
  );
  paintParticles(key);
}

function paintParticles(key) {
  const layer = _container.querySelector("#roomParticles");
  if (!layer) return;
  layer.innerHTML = "";
  if (key === "default") return;

  const config = {
    sakura:  { glyphs: ["🌸","🌸","🌸","🌺"],     count: 16, kind: "fall"   },
    moonlit: { glyphs: ["✦","✧","⋆","✩","·"],   count: 22, kind: "twinkle"},
    beach:   { glyphs: ["🌊","🐚","☀"],            count: 10, kind: "drift"  },
    library: { glyphs: ["·","·","·","✦"],         count: 18, kind: "drift"  },
    aurora:  { glyphs: ["~","~","~"],             count: 5,  kind: "ribbon" },
    cafe:    { glyphs: ["·","∙","∘"],             count: 14, kind: "rise"   },
  }[key] || null;
  if (!config) return;

  for (let i = 0; i < config.count; i++) {
    const span = document.createElement("span");
    span.className = `room-particle is-${config.kind}`;
    span.textContent = config.glyphs[i % config.glyphs.length];
    span.style.left = `${Math.random() * 100}%`;
    span.style.animationDelay = `-${Math.random() * 8}s`;
    span.style.animationDuration = `${5 + Math.random() * 8}s`;
    span.style.fontSize = `${10 + Math.random() * 14}px`;
    span.style.opacity = `${0.5 + Math.random() * 0.5}`;
    layer.appendChild(span);
  }
}
