// =====================================================================
// modules/together.js — the marquee "Together" experience.
// 4 sub-views accessed via tiles:
//   • Play   — couple games (delegates to spaceGames.js)
//   • Watch  — synced YouTube watch-together (modules/watchTogether.js)
//   • Screen — full-screen share via existing callService
//   • Sleep  — ambient room with breathing pulse + sleep timer
//
// Live partner-activity strip at the top so you always know what they're up to.
// =====================================================================
import { onAppState, getState } from "../state/appState.js";
import { toast, toastWarn, toastSuccess, safe } from "../utils/toast.js";
import { setActivity, formatActivity } from "../services/presenceService.js";
import { startVideoCall } from "./callView.js";
import { mountGame } from "./spaceGames.js";

let _container   = null;
let _offState    = null;
let _activeSub   = null;            // 'play'|'watch'|'music'|'screen'|'sleep'|null
let _gameInstance = null;
let _sleepRain   = null;            // <audio> for ambient
let _sleepTick   = null;            // setInterval for timer
let _watchView   = null;            // module instance returned by watchTogether
let _musicView   = null;            // module instance returned by musicRoom

const SUBS = [
  { key: "play",   icon: "🎮", title: "Play Together",   blurb: "Couple games with live presence + reactions.",   accent: "linear-gradient(135deg,#ff7eb6,#9b8cff)" },
  { key: "watch",  icon: "📺", title: "Watch Together",  blurb: "Synced YouTube playback. Same scene, same time.", accent: "linear-gradient(135deg,#7ed7ff,#9b8cff)" },
  { key: "music",  icon: "🎵", title: "Music Room",      blurb: "Listen to the same track together, in sync.",     accent: "linear-gradient(135deg,#ff7eb6,#7ed7ff)" },
  { key: "screen", icon: "🖥",  title: "Share Screen",    blurb: "Show them what's on your screen, live.",         accent: "linear-gradient(135deg,#9b8cff,#c8baff)" },
  { key: "sleep",  icon: "🌙", title: "Sleep Together",  blurb: "Fall asleep with their breathing on screen.",    accent: "linear-gradient(135deg,#3a2d6e,#7763ff)" },
];

export function renderTogether(container) {
  _container = container;
  _container.innerHTML = renderShell();

  bindNavTiles();
  bindBackButton();

  _offState = onAppState((s) => {
    if (!s.ready) return;
    paintPartnerStrip(s);
    paintBeacon(s);
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  _offState = null;
  closeSubView();
  _container = null;
}

// =========================================================================
// Shell
// =========================================================================
function renderShell() {
  return `
    <section class="tg-page">
      <header class="tg-hero">
        <h1 class="tg-title">Together</h1>
        <p class="tg-sub">A shared digital space, just for the two of you.</p>
        <div class="tg-partner-strip" id="tgPartnerStrip">
          <span class="tg-partner-strip__hint">Connecting…</span>
        </div>
      </header>

      <button class="tg-beacon" id="tgBeacon" hidden>
        <div class="tg-beacon__icon" id="tgBeaconIcon">·</div>
        <div class="tg-beacon__body">
          <div class="tg-beacon__title" id="tgBeaconTitle">…</div>
          <div class="tg-beacon__sub"   id="tgBeaconSub">…</div>
        </div>
        <span class="tg-beacon__cta">Join →</span>
      </button>

      <div class="tg-tiles" id="tgTiles">
        ${SUBS.map((s) => `
          <button class="tg-tile" data-sub="${s.key}" style="--tg-accent:${s.accent}">
            <span class="tg-tile__icon">${s.icon}</span>
            <span class="tg-tile__title">${escapeHtml(s.title)}</span>
            <span class="tg-tile__blurb">${escapeHtml(s.blurb)}</span>
            <span class="tg-tile__cta">Open →</span>
          </button>
        `).join("")}
      </div>

      <div class="tg-subview hidden" id="tgSubView" aria-live="polite">
        <header class="tg-subview__head">
          <button class="tg-back" id="tgBack" aria-label="Back">←</button>
          <h2 class="tg-subview__title" id="tgSubTitle">…</h2>
          <span class="tg-subview__spacer"></span>
        </header>
        <div class="tg-subview__body" id="tgSubBody"></div>
      </div>
    </section>

    <style>
      .tg-page { padding: 8px 4px 24px; max-width: 720px; margin: 0 auto; }

      .tg-hero { padding: 18px 6px 6px; }
      .tg-title {
        font-size: 2.1rem; font-weight: 800; letter-spacing: -0.02em; margin: 0;
        background: var(--nn-grad-hero, linear-gradient(135deg,#ff7eb6,#9b8cff));
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .tg-sub  { color: #6b5b9b; font-size: 0.95rem; margin: 4px 0 12px; }

      .tg-partner-strip {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 14px; border-radius: 999px;
        background: rgba(255,255,255,.85);
        border: 1px solid rgba(155,140,255,.25);
        box-shadow: 0 4px 14px rgba(143,116,255,.12);
        font-size: 0.875rem; color: #4f3d80;
        max-width: 100%; min-height: 36px;
      }
      .tg-partner-strip__hint { color: #7d6ea8; font-style: italic; }
      .tg-partner-strip__avatar {
        width: 22px; height: 22px; border-radius: 50%;
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        display: inline-grid; place-items: center;
        color: #fff; font-weight: 700; font-size: 11px;
        flex-shrink: 0;
      }
      .tg-partner-strip__avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
      .tg-partner-strip__name strong { color: #1a1235; }
      .tg-partner-strip__activity { color: #6b5b9b; }

      .tg-tiles {
        display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
        margin-top: 18px;
      }
      @media (max-width: 540px) {
        .tg-tiles { grid-template-columns: 1fr; }
      }

      .tg-tile {
        position: relative; overflow: hidden;
        text-align: left; padding: 18px;
        background: rgba(255,255,255,.78);
        border: 1px solid rgba(255,255,255,.7);
        border-radius: 22px;
        box-shadow: 0 10px 32px rgba(143,116,255,.18), 0 2px 8px rgba(255,126,182,.08);
        cursor: pointer; font-family: inherit; color: #1a1235;
        transition: transform .35s cubic-bezier(.22,1,.36,1), box-shadow .35s;
        display: flex; flex-direction: column; gap: 6px; min-height: 156px;
      }
      .tg-tile::before {
        content: ""; position: absolute; inset: 0;
        background: var(--tg-accent); opacity: .12; pointer-events: none;
        transition: opacity .3s;
      }
      .tg-tile:hover::before { opacity: .22; }
      .tg-tile:hover { transform: translateY(-3px); box-shadow: 0 20px 50px rgba(143,116,255,.25); }
      .tg-tile__icon  { font-size: 32px; line-height: 1; }
      .tg-tile__title { font-size: 1.0625rem; font-weight: 800; margin-top: 2px; }
      .tg-tile__blurb { font-size: 0.875rem; color: #4f3d80; line-height: 1.4; flex: 1; }
      .tg-tile__cta   { font-size: 0.8125rem; font-weight: 700; color: #7763ff; margin-top: 4px; align-self: flex-end; }

      /* Sub-view */
      .tg-subview {
        position: fixed; inset: 0;
        background: var(--nn-grad-deep, linear-gradient(180deg,#b7a9ff,#d4c8ff));
        z-index: 250;
        display: flex; flex-direction: column;
        animation: tg-subview-in .3s cubic-bezier(.22,1,.36,1);
      }
      .tg-subview.hidden { display: none; }
      @keyframes tg-subview-in {
        from { opacity: 0; transform: translateY(20px) scale(.99); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .tg-subview__head {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 16px;
        background: rgba(255,255,255,.65);
        border-bottom: 1px solid rgba(255,255,255,.5);
      }
      .tg-back {
        width: 38px; height: 38px; border-radius: 50%;
        background: rgba(255,255,255,.9); border: 1px solid rgba(255,255,255,.7);
        font-size: 18px; cursor: pointer; color: #1a1235;
        display: inline-grid; place-items: center;
        box-shadow: 0 4px 12px rgba(143,116,255,.15);
      }
      .tg-back:hover { transform: scale(1.05); }
      .tg-subview__title {
        font-size: 1.125rem; font-weight: 800; margin: 0;
        background: var(--nn-grad-hero, linear-gradient(135deg,#ff7eb6,#9b8cff));
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .tg-subview__spacer { flex: 1; }
      .tg-subview__body {
        flex: 1; overflow: auto; padding: 18px;
        max-width: 880px; margin: 0 auto; width: 100%;
      }
      .tg-beacon {
        display: grid; grid-template-columns: 44px 1fr auto; gap: 12px;
        align-items: center;
        padding: 12px 14px;
        margin: 0 0 14px;
        border-radius: 16px;
        background: var(--tg-accent, linear-gradient(135deg,#ff7eb6,#9b8cff));
        color: #fff;
        border: 0; font-family: inherit;
        text-align: left; cursor: pointer;
        box-shadow: 0 12px 28px rgba(155,140,255,.32);
        animation: tg-beacon-pulse 2.4s ease-in-out infinite;
        transition: transform .15s;
      }
      .tg-beacon:hover  { transform: translateY(-1px); }
      .tg-beacon:active { transform: scale(.99); }
      .tg-beacon__icon {
        width: 44px; height: 44px; border-radius: 14px;
        display: grid; place-items: center;
        background: rgba(255,255,255,.18);
        font-size: 22px;
      }
      .tg-beacon__title {
        font-weight: 800; font-size: 1rem;
      }
      .tg-beacon__sub {
        margin-top: 2px;
        font-size: .8125rem; opacity: .9; line-height: 1.4;
      }
      .tg-beacon__cta {
        font-weight: 800; font-size: .8125rem;
        padding: 6px 12px; border-radius: 999px;
        background: rgba(255,255,255,.22);
      }
      @keyframes tg-beacon-pulse {
        0%, 100% { box-shadow: 0 12px 28px rgba(155,140,255,.32); }
        50%      { box-shadow: 0 18px 40px rgba(255,126,182,.55); }
      }
    </style>
  `;
}

function bindNavTiles() {
  _container.querySelectorAll(".tg-tile").forEach((t) => {
    t.addEventListener("click", () => openSubView(t.dataset.sub));
  });
}

function bindBackButton() {
  _container.querySelector("#tgBack").addEventListener("click", closeSubView);
  document.addEventListener("keydown", onEsc);
}
function onEsc(e) { if (e.key === "Escape" && _activeSub) closeSubView(); }

// =========================================================================
// Partner activity strip (live from appState)
// =========================================================================
function paintPartnerStrip(s) {
  const strip = _container?.querySelector("#tgPartnerStrip");
  if (!strip) return;
  const partner = s.partner;
  if (!partner) {
    strip.innerHTML = `<span class="tg-partner-strip__hint">No partner yet — head to Profile to connect.</span>`;
    return;
  }
  const initial = (partner.displayName || partner.username || "?").trim().charAt(0).toUpperCase();
  const av = partner.photoURL
    ? `<img src="${partner.photoURL}" alt="" referrerpolicy="no-referrer">`
    : initial;
  const online = partner.status?.online;
  const fmt = formatActivity(partner.activity);
  const activity = fmt
    ? `<span class="tg-partner-strip__activity">· ${fmt.icon} ${escapeHtml(fmt.text)}</span>`
    : (online ? `<span class="tg-partner-strip__activity">· online now</span>` : `<span class="tg-partner-strip__activity">· offline</span>`);

  strip.innerHTML = `
    <span class="tg-partner-strip__avatar">${av}</span>
    <span class="tg-partner-strip__name"><strong>${escapeHtml(partner.displayName || partner.username || "Partner")}</strong></span>
    ${activity}
  `;
}

// =========================================================================
// Sub-view dispatch
// =========================================================================
function openSubView(key) {
  _activeSub = key;
  const view = _container.querySelector("#tgSubView");
  const title = _container.querySelector("#tgSubTitle");
  const body = _container.querySelector("#tgSubBody");
  view.classList.remove("hidden");
  const meta = SUBS.find((s) => s.key === key);
  title.textContent = `${meta.icon} ${meta.title}`;
  body.innerHTML = "";

  if (key === "play")   return renderPlay(body);
  if (key === "watch")  return renderWatch(body);
  if (key === "music")  return renderMusic(body);
  if (key === "screen") return renderScreen(body);
  if (key === "sleep")  return renderSleep(body);
}

function closeSubView() {
  if (!_activeSub) return;
  const view = _container?.querySelector("#tgSubView");
  if (view) view.classList.add("hidden");
  // Cleanup per-view
  try { _gameInstance?.destroy(); } catch {} _gameInstance = null;
  if (_sleepRain) { try { _sleepRain.pause(); } catch {} _sleepRain = null; }
  if (_sleepTick) { clearInterval(_sleepTick); _sleepTick = null; }
  if (_watchView?.destroy) { try { _watchView.destroy(); } catch {} _watchView = null; }
  if (_musicView?.destroy) { try { _musicView.destroy(); } catch {} _musicView = null; }
  setActivity(null);   // clear any activity claim from sub-view
  _activeSub = null;
}

// =========================================================================
// PLAY — couple games grid (delegates to spaceGames.js)
// =========================================================================
function renderPlay(body) {
  body.innerHTML = `
    <div class="tg-play">
      <div class="tg-play__grid">
        ${[
          { type: "tictactoe",      icon: "❌⭕", name: "Tic Tac Toe",       desc: "Classic, two-player." },
          { type: "connect4",       icon: "🔴🟡", name: "Connect 4",        desc: "Drop, line up, win." },
          { type: "chess",          icon: "♔",    name: "Chess",            desc: "Move pieces freely." },
          { type: "trivia",         icon: "🎯",   name: "Couple Trivia",    desc: "8 questions, MCQ scoring." },
          { type: "whoknowsbetter", icon: "💞",   name: "Who Knows Better", desc: "Compare honest answers." },
          { type: "memorymatch",    icon: "🧠",   name: "Memory Match",     desc: "Flip the pairs, beat your time." },
          { type: "speedreactions", icon: "⚡",   name: "Speed Reactions",  desc: "Tap pink as fast as you can." },
          { type: "typingrace",     icon: "⌨️",   name: "Typing Race",      desc: "60s, your WPM and accuracy." },
        ].map((g) => `
          <button class="tg-game-tile" data-game="${g.type}">
            <span class="tg-game-tile__icon">${g.icon}</span>
            <span class="tg-game-tile__name">${escapeHtml(g.name)}</span>
            <span class="tg-game-tile__desc">${escapeHtml(g.desc)}</span>
          </button>
        `).join("")}
      </div>
      <p class="tg-play__more">More games (UNO, Draw &amp; Guess, Music Quiz, Pictionary) are next on the roadmap.</p>
      <div class="tg-game-mount" id="tgGameMount"></div>
    </div>
    <style>
      .tg-play__grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
      .tg-game-tile {
        text-align: left; padding: 16px; cursor: pointer;
        background: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.7);
        border-radius: 18px; box-shadow: 0 6px 18px rgba(143,116,255,.15);
        font-family: inherit; color: #1a1235;
        display: flex; flex-direction: column; gap: 4px;
        transition: transform .25s cubic-bezier(.22,1,.36,1);
      }
      .tg-game-tile:hover { transform: translateY(-2px); }
      .tg-game-tile__icon { font-size: 26px; line-height: 1; }
      .tg-game-tile__name { font-weight: 700; }
      .tg-game-tile__desc { color: #6b5b9b; font-size: .8125rem; }
      .tg-play__more { color: #7d6ea8; font-size: .8125rem; margin: 14px 6px; text-align: center; }
      .tg-game-mount:not(:empty) { margin-top: 18px; }
    </style>
  `;
  setActivity("gaming", "Couple Games");
  body.querySelectorAll(".tg-game-tile").forEach((t) => {
    t.addEventListener("click", () => {
      try { _gameInstance?.destroy(); } catch {}
      const mount = body.querySelector("#tgGameMount");
      _gameInstance = mountGame(t.dataset.game, mount);
      mount.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// =========================================================================
// WATCH — YouTube sync
// =========================================================================
async function renderWatch(body) {
  const mod = await import("./watchTogether.js");
  _watchView = mod.mountWatchTogether(body);
  setActivity("watching", "YouTube");
}

// =========================================================================
// MUSIC — synced audio room
// =========================================================================
async function renderMusic(body) {
  const mod = await import("./musicRoom.js");
  _musicView = mod.mountMusicRoom(body);
  setActivity("listening", "Music Room");
}

// =========================================================================
// SCREEN — full-screen share via existing callService
// =========================================================================
function renderScreen(body) {
  const s = getState();
  if (!s.partnerId) {
    body.innerHTML = renderUnpairedHint("Share your screen with your partner once you're connected.");
    return;
  }
  body.innerHTML = `
    <div class="tg-screen">
      <div class="tg-screen__hero">
        <div class="tg-screen__icon">🖥</div>
        <h3>Share your screen</h3>
        <p>Starts a video call and immediately shares your screen with ${escapeHtml(s.partner?.displayName || "your partner")}.</p>
        <button class="btn btn-primary" id="tgScreenStart">Start screen share</button>
        <p class="tg-screen__tip">Tip: pick a tab or window in the next dialog. Stop anytime via the stop button on the call overlay.</p>
      </div>
    </div>
    <style>
      .tg-screen__hero {
        background: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.7);
        border-radius: 24px; padding: 32px 24px; text-align: center;
        box-shadow: 0 14px 40px rgba(143,116,255,.18);
      }
      .tg-screen__icon { font-size: 48px; margin-bottom: 8px; }
      .tg-screen__hero h3 { font-size: 1.25rem; margin: 4px 0 8px; }
      .tg-screen__hero p { color: #4f3d80; max-width: 36ch; margin: 0 auto 18px; }
      .tg-screen__tip { color: #7d6ea8; font-size: .8125rem; margin-top: 14px !important; }
    </style>
  `;
  body.querySelector("#tgScreenStart").addEventListener("click", async () => {
    setActivity("screen-sharing", "");
    const name = s.partner?.displayName?.split(" ")[0] || "Partner";
    try {
      // Open the existing video call overlay; the user can click the screen-share
      // button inside the overlay to actually start sharing.
      startVideoCall(s.partnerId, name);
      toast("Pick a screen / window to share in the next dialog.");
    } catch (e) {
      toastWarn("Couldn't start the call. Try the call button in /chat.");
    }
  });
}

// =========================================================================
// SLEEP — ambient room
// =========================================================================
function renderSleep(body) {
  body.innerHTML = `
    <div class="tg-sleep">
      <div class="tg-sleep__sky">
        <div class="tg-sleep__moon">🌙</div>
        <div class="tg-sleep__star" style="--x:14%;--y:20%;--d:2.4s"></div>
        <div class="tg-sleep__star" style="--x:78%;--y:14%;--d:3.1s"></div>
        <div class="tg-sleep__star" style="--x:32%;--y:62%;--d:2.0s"></div>
        <div class="tg-sleep__star" style="--x:88%;--y:50%;--d:2.7s"></div>
        <div class="tg-sleep__star" style="--x:46%;--y:34%;--d:3.4s"></div>
      </div>
      <div class="tg-sleep__pulse" aria-hidden="true">
        <div class="tg-sleep__ring"></div>
        <div class="tg-sleep__ring tg-sleep__ring--2"></div>
        <div class="tg-sleep__ring tg-sleep__ring--3"></div>
      </div>
      <div class="tg-sleep__label">Breathe with me</div>
      <div class="tg-sleep__instr" id="tgSleepInstr">Breathe in…</div>

      <div class="tg-sleep__controls">
        <button class="tg-sleep__btn" data-snd="off"  aria-pressed="true">🔇 Silent</button>
        <button class="tg-sleep__btn" data-snd="rain">🌧 Rain</button>
        <button class="tg-sleep__btn" data-snd="lofi">🎼 Lo-fi</button>
        <button class="tg-sleep__btn" data-snd="ocean">🌊 Ocean</button>
      </div>

      <div class="tg-sleep__timer-row">
        <label class="tg-sleep__timer-label">Sleep timer</label>
        <div class="tg-sleep__timer-pills">
          <button class="tg-sleep__timer-pill" data-mins="0">Off</button>
          <button class="tg-sleep__timer-pill" data-mins="15">15m</button>
          <button class="tg-sleep__timer-pill" data-mins="30">30m</button>
          <button class="tg-sleep__timer-pill" data-mins="60">60m</button>
        </div>
        <div class="tg-sleep__remaining" id="tgSleepRemaining"></div>
      </div>

      <button class="btn btn-primary tg-sleep__goodnight" id="tgGoodnight">💤 Send goodnight to partner</button>
    </div>
    <style>
      .tg-sleep {
        position: relative; min-height: calc(100dvh - 120px);
        padding: 18px 4px 32px; color: #f4ecff;
        background: linear-gradient(180deg,#1a1235 0%,#0e0820 60%,#1a1235 100%);
        border-radius: 20px; margin: -8px;
        display: flex; flex-direction: column; align-items: center; gap: 18px;
        overflow: hidden;
      }
      .tg-sleep__sky {
        position: absolute; inset: 0; pointer-events: none; z-index: 0;
      }
      .tg-sleep__moon {
        position: absolute; top: 6%; right: 8%;
        font-size: 64px; filter: drop-shadow(0 0 20px rgba(255,250,235,.4));
      }
      .tg-sleep__star {
        position: absolute; left: var(--x); top: var(--y);
        width: 4px; height: 4px; border-radius: 50%;
        background: #fff; box-shadow: 0 0 12px #fff;
        animation: tg-twinkle var(--d) ease-in-out infinite;
      }
      @keyframes tg-twinkle {
        0%, 100% { opacity: 0.2; transform: scale(.6); }
        50%      { opacity: 1;   transform: scale(1.2); }
      }
      .tg-sleep__pulse {
        position: relative; z-index: 1; margin-top: 28px;
        width: 240px; height: 240px;
        display: grid; place-items: center;
      }
      .tg-sleep__ring {
        position: absolute; inset: 0; border-radius: 50%;
        background: radial-gradient(circle, rgba(155,140,255,.4), rgba(255,126,182,.15) 50%, transparent 70%);
        animation: tg-breathe 8s ease-in-out infinite;
      }
      .tg-sleep__ring--2 { animation-delay: -2s; opacity: .7; }
      .tg-sleep__ring--3 { animation-delay: -4s; opacity: .5; }
      @keyframes tg-breathe {
        0%, 100% { transform: scale(.7); }
        50%      { transform: scale(1.1); }
      }
      .tg-sleep__label {
        position: relative; z-index: 1;
        font-size: .8125rem; letter-spacing: .5px; text-transform: uppercase;
        color: #c8baff; margin-top: 8px;
      }
      .tg-sleep__instr {
        position: relative; z-index: 1;
        font-size: 1.5rem; font-weight: 700; color: #fff;
        animation: tg-instr-fade 4s ease-in-out infinite;
      }
      @keyframes tg-instr-fade {
        0%, 100% { opacity: .6; }
        50%      { opacity: 1; }
      }
      .tg-sleep__controls {
        position: relative; z-index: 1;
        display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
        margin-top: 8px;
      }
      .tg-sleep__btn {
        background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15);
        color: #f4ecff; padding: 8px 14px; border-radius: 999px;
        font-family: inherit; font-size: .875rem; font-weight: 600; cursor: pointer;
        transition: background .2s;
      }
      .tg-sleep__btn:hover { background: rgba(255,255,255,.15); }
      .tg-sleep__btn[aria-pressed="true"] {
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        border-color: transparent; color: #fff;
      }
      .tg-sleep__timer-row {
        position: relative; z-index: 1; text-align: center;
        margin-top: 8px;
      }
      .tg-sleep__timer-label {
        font-size: .75rem; letter-spacing: .5px; text-transform: uppercase;
        color: #c8baff; display: block; margin-bottom: 6px;
      }
      .tg-sleep__timer-pills { display: flex; gap: 6px; justify-content: center; }
      .tg-sleep__timer-pill {
        background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        color: #f4ecff; padding: 6px 12px; border-radius: 999px;
        font-family: inherit; font-size: .8125rem; cursor: pointer;
      }
      .tg-sleep__timer-pill[aria-pressed="true"] {
        background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.3);
      }
      .tg-sleep__remaining { color: #c8baff; font-size: .8125rem; margin-top: 6px; min-height: 18px; }
      .tg-sleep__goodnight { position: relative; z-index: 1; margin-top: 12px; }
    </style>
  `;

  setActivity("sleeping", "");

  // Breathing instructions cycle
  let inhale = true;
  const instr = body.querySelector("#tgSleepInstr");
  _sleepTick = setInterval(() => {
    instr.textContent = inhale ? "Breathe out…" : "Breathe in…";
    inhale = !inhale;
  }, 4000);

  // Sound buttons
  const SOUND_URLS = {
    rain:  "https://cdn.pixabay.com/audio/2022/03/15/audio_a4f3d65c45.mp3",
    lofi:  "https://cdn.pixabay.com/audio/2023/02/28/audio_5ae9b40e87.mp3",
    ocean: "https://cdn.pixabay.com/audio/2022/10/18/audio_9c81ce2a2c.mp3",
  };
  body.querySelectorAll(".tg-sleep__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      body.querySelectorAll(".tg-sleep__btn").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      const k = btn.dataset.snd;
      if (_sleepRain) { try { _sleepRain.pause(); } catch {} _sleepRain = null; }
      if (k !== "off" && SOUND_URLS[k]) {
        try {
          _sleepRain = new Audio(SOUND_URLS[k]);
          _sleepRain.loop = true;
          _sleepRain.volume = 0.5;
          _sleepRain.play().catch(() => toastWarn("Tap a sound again to start audio (browser blocked autoplay)."));
        } catch (e) { toastWarn("Couldn't start ambient sound"); }
      }
    });
  });

  // Sleep timer
  let timerEnd = 0; let timerInterval = null;
  body.querySelectorAll(".tg-sleep__timer-pill").forEach((p) => {
    p.addEventListener("click", () => {
      body.querySelectorAll(".tg-sleep__timer-pill").forEach((b) => b.setAttribute("aria-pressed", "false"));
      p.setAttribute("aria-pressed", "true");
      const mins = Number(p.dataset.mins);
      clearInterval(timerInterval);
      const remaining = body.querySelector("#tgSleepRemaining");
      if (mins <= 0) { remaining.textContent = ""; return; }
      timerEnd = Date.now() + mins * 60_000;
      const tick = () => {
        const left = Math.max(0, timerEnd - Date.now());
        const m = Math.floor(left / 60_000), s = Math.floor((left % 60_000) / 1000);
        remaining.textContent = left > 0 ? `Sleeping in ${m}:${String(s).padStart(2,'0')}…` : "Goodnight 💜";
        if (left <= 0) {
          clearInterval(timerInterval);
          if (_sleepRain) { try { _sleepRain.pause(); } catch {} _sleepRain = null; }
        }
      };
      tick();
      timerInterval = setInterval(tick, 1000);
    });
  });

  // Goodnight
  body.querySelector("#tgGoodnight").addEventListener("click", async () => {
    const s = getState();
    if (!s.partnerId) return toastWarn("Connect with your partner first");
    setActivity("sleeping", "saying goodnight");
    toastSuccess("💜 Goodnight sent");
  });
}

// =========================================================================
// helpers
// =========================================================================
function renderUnpairedHint(text) {
  return `
    <div class="tg-unpaired">
      <div class="tg-unpaired__icon">💞</div>
      <h3>Connect with your partner first</h3>
      <p>${escapeHtml(text)}</p>
      <button class="btn btn-primary" onclick="window.loadPage?.('profile')">Go to Profile</button>
    </div>
    <style>
      .tg-unpaired {
        text-align: center; padding: 32px 24px;
        background: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.7);
        border-radius: 24px; box-shadow: 0 14px 40px rgba(143,116,255,.18);
      }
      .tg-unpaired__icon { font-size: 42px; }
      .tg-unpaired h3 { margin: 6px 0 8px; font-size: 1.125rem; }
      .tg-unpaired p { color: #4f3d80; max-width: 36ch; margin: 0 auto 16px; }
    </style>
  `;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}



// =====================================================================
// Beacon — when partner is in a Together sub-view, surface a soft
// glowing card that links into the same view.
// =====================================================================
const ACTIVITY_TO_SUB = {
  // partner.activity.type → SUBS key
  watching:        "watch",
  listening:       "music",
  "screen-sharing": "screen",
  sleeping:        "sleep",
  gaming:          "play",
};

function paintBeacon(s) {
  const beacon = _container?.querySelector("#tgBeacon");
  if (!beacon) return;
  const t = s.partner?.activity?.type;
  const subKey = ACTIVITY_TO_SUB[t];
  if (!subKey || _activeSub) {
    // Hide if partner isn't in a sub-view OR if I'm already in one
    beacon.hidden = true;
    return;
  }
  const sub = SUBS.find((x) => x.key === subKey);
  if (!sub) { beacon.hidden = true; return; }
  beacon.hidden = false;
  beacon.style.setProperty("--tg-accent", sub.accent);
  const partnerName = s.partner?.displayName?.split(" ")[0] || s.partner?.username || "Partner";
  const detail = s.partner.activity.detail
    ? ` · ${String(s.partner.activity.detail).slice(0, 50)}`
    : "";

  const iconEl  = _container.querySelector("#tgBeaconIcon");
  const titleEl = _container.querySelector("#tgBeaconTitle");
  const subEl   = _container.querySelector("#tgBeaconSub");
  if (iconEl)  iconEl.textContent  = sub.icon;
  if (titleEl) titleEl.textContent = `${partnerName} is in ${sub.title}`;
  if (subEl)   subEl.textContent   = `Tap to be there with them${detail}`;

  beacon.onclick = () => openSubView(subKey);
}
