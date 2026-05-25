// =====================================================================
// modules/watchTogether.js — YouTube watch-together with Firestore sync.
// Both partners share state at: watchSessions/{coupleId}.
//   { url, videoId, state: 'playing'|'paused'|'idle',
//     time (seconds), updatedAt, updatedBy }
//
// One partner sets the URL → the other gets it via onSnapshot. Play/pause
// and seek events sync within ~500ms (jitter-tolerant). Reactions are
// posted to a sub-collection and float across both screens.
//
// Returns { destroy } from mountWatchTogether so the parent can clean up.
// =====================================================================
import { db } from "../firebase.js";
import { doc, setDoc, onSnapshot, collection, addDoc, query, orderBy, limit, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getState, onAppState } from "../state/appState.js";
import { setActivity } from "../services/presenceService.js";
import { toast, toastWarn, toastSuccess, safe } from "../utils/toast.js";

const SYNC_THRESHOLD_SEC = 1.5;   // resync if drift exceeds this
const SYNC_WRITE_THROTTLE = 1500; // min ms between our outbound writes

let _ytApiPromise = null;
function loadYouTubeAPI() {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });
  return _ytApiPromise;
}

function parseYouTubeId(url) {
  if (!url) return null;
  // Common patterns: youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID
  const patterns = [
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

export function mountWatchTogether(container) {
  let player = null;
  let unsubSession = null;
  let unsubReactions = null;
  let lastWriteAt = 0;
  let myUid = null;
  let coupleId = null;
  let suppressLocalEvents = false;   // ignore programmatic seeks from sync
  let detached = false;

  container.innerHTML = renderShell();
  bind(container);

  // Wait for appState to know coupleId
  const off = onAppState(async (s) => {
    if (!s.ready) return;
    myUid = s.user?.uid;
    if (!s.partnerId || !s.coupleId) {
      container.innerHTML = renderUnpairedHint();
      return;
    }
    if (coupleId !== s.coupleId) {
      coupleId = s.coupleId;
      attachSync();
      attachReactions();
    }
  });

  function attachSync() {
    unsubSession?.();
    unsubSession = onSnapshot(doc(db, "watchSessions", coupleId), (snap) => {
      const data = snap.data();
      if (!data) return;
      onRemoteUpdate(data);
    });
  }

  function attachReactions() {
    unsubReactions?.();
    const q = query(
      collection(db, "watchSessions", coupleId, "reactions"),
      orderBy("at", "desc"), limit(20)
    );
    let firstSnap = true;
    unsubReactions = onSnapshot(q, (snap) => {
      // Skip the initial burst (existing reactions); only show new ones.
      if (firstSnap) { firstSnap = false; return; }
      snap.docChanges().forEach((c) => {
        if (c.type === "added") spawnReaction(c.doc.data().emoji);
      });
    });
  }

  // ---------- DOM ----------
  function renderShell() {
    return `
      <div class="wt">
        <div class="wt__top">
          <input id="wtUrl" type="url" placeholder="Paste a YouTube URL…" inputmode="url" autocomplete="off">
          <button class="btn btn-primary" id="wtLoad">Load</button>
        </div>

        <div class="wt__player" id="wtPlayer">
          <div class="wt__placeholder">
            <div class="wt__placeholder-icon">📺</div>
            <p>Paste any YouTube URL to start watching together.</p>
            <p class="wt__placeholder-hint">Both of you must keep this page open. Playback stays in sync within ~1 second.</p>
          </div>
          <div class="wt__yt" id="wtYT" hidden></div>
          <div class="wt__reactions" id="wtReactions" aria-hidden="true"></div>
        </div>

        <div class="wt__row">
          <div class="wt__live-status" id="wtStatus">Idle</div>
          <div class="wt__react-bar">
            ${["❤️","😂","😮","🥺","🔥","👏","🎉"].map(e => `<button class="wt__react" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
          </div>
        </div>
      </div>
      <style>
        .wt { display: flex; flex-direction: column; gap: 12px; }
        .wt__top { display: flex; gap: 8px; }
        .wt__top input {
          flex: 1; height: 42px; padding: 0 14px; border-radius: 12px;
          border: 1px solid rgba(155,140,255,.3); background: rgba(255,255,255,.85);
          font-family: inherit; font-size: .9375rem; color: #1a1235;
        }
        .wt__top .btn { padding: 0 18px; height: 42px; border-radius: 12px; }

        .wt__player {
          position: relative; aspect-ratio: 16/9;
          background: #000; border-radius: 16px; overflow: hidden;
          box-shadow: 0 14px 40px rgba(143,116,255,.22);
        }
        .wt__yt, .wt__yt iframe { width: 100%; height: 100%; }
        .wt__placeholder {
          position: absolute; inset: 0; display: grid; place-items: center;
          padding: 24px; text-align: center; color: #d8c9ff;
        }
        .wt__placeholder-icon { font-size: 48px; line-height: 1; }
        .wt__placeholder p { color: #cbb9ff; max-width: 36ch; margin: 8px auto 4px; }
        .wt__placeholder-hint { font-size: .8125rem; opacity: .8; }

        .wt__reactions { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .wt__reactions span {
          position: absolute; bottom: 8%; font-size: 28px;
          animation: wt-rise 2s ease-out forwards;
          will-change: transform, opacity;
        }
        @keyframes wt-rise {
          0%   { transform: translateY(0)    rotate(0)   scale(.8); opacity: 1; }
          100% { transform: translateY(-200px) rotate(20deg) scale(1.2); opacity: 0; }
        }

        .wt__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .wt__live-status {
          padding: 6px 12px; border-radius: 999px;
          background: rgba(255,255,255,.85); border: 1px solid rgba(155,140,255,.25);
          font-size: .8125rem; font-weight: 600; color: #4f3d80;
        }
        .wt__live-status.is-playing { background: linear-gradient(135deg,#ff7eb6,#9b8cff); color: #fff; border-color: transparent; }

        .wt__react-bar { display: flex; gap: 6px; flex-wrap: wrap; }
        .wt__react {
          width: 38px; height: 38px; border-radius: 50%;
          background: rgba(255,255,255,.85); border: 1px solid rgba(155,140,255,.25);
          font-size: 18px; cursor: pointer; transition: transform .15s;
        }
        .wt__react:hover { transform: scale(1.1); }
      </style>
    `;
  }

  function renderUnpairedHint() {
    return `
      <div style="text-align:center;padding:32px;background:rgba(255,255,255,.85);border-radius:18px;">
        <div style="font-size:42px;">💞</div>
        <h3 style="margin:6px 0 8px">Pair up to watch together</h3>
        <p style="color:#4f3d80;max-width:36ch;margin:0 auto 16px">Both partners need to be connected so we know whose playhead to sync.</p>
        <button class="btn btn-primary" onclick="window.loadPage?.('profile')">Connect partner</button>
      </div>
    `;
  }

  function bind(root) {
    root.querySelector("#wtLoad").addEventListener("click", onLoad);
    root.querySelector("#wtUrl").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); onLoad(); }
    });
    root.querySelectorAll(".wt__react").forEach((btn) => {
      btn.addEventListener("click", () => sendReaction(btn.dataset.emoji));
    });
  }

  // ---------- Load video ----------
  async function onLoad() {
    if (!coupleId) return toastWarn("Connect with your partner first");
    const url = container.querySelector("#wtUrl").value.trim();
    const id = parseYouTubeId(url);
    if (!id) return toastWarn("That doesn't look like a YouTube URL");
    await safe(() => setDoc(doc(db, "watchSessions", coupleId), {
      url, videoId: id, state: "playing", time: 0,
      updatedAt: serverTimestamp(), updatedBy: myUid
    }, { merge: true }), "Couldn't start session");
    // The onSnapshot will then mount the player.
  }

  // ---------- Player ----------
  async function ensurePlayer(videoId) {
    await loadYouTubeAPI();
    if (player && player._videoId === videoId) return player;
    const ytEl = container.querySelector("#wtYT");
    container.querySelector(".wt__placeholder").style.display = "none";
    ytEl.hidden = false;
    if (player) { try { player.destroy(); } catch {} player = null; }
    return new Promise((resolve) => {
      player = new window.YT.Player(ytEl, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            player._videoId = videoId;
            resolve(player);
          },
          onStateChange: onLocalStateChange
        }
      });
    });
  }

  function onLocalStateChange(ev) {
    if (suppressLocalEvents || !coupleId) return;
    const YT = window.YT;
    if (!YT) return;
    const time = player.getCurrentTime ? player.getCurrentTime() : 0;
    let state = "idle";
    if (ev.data === YT.PlayerState.PLAYING) state = "playing";
    else if (ev.data === YT.PlayerState.PAUSED) state = "paused";
    else return;
    if (Date.now() - lastWriteAt < SYNC_WRITE_THROTTLE) return;
    lastWriteAt = Date.now();
    setDoc(doc(db, "watchSessions", coupleId), {
      state, time, updatedAt: serverTimestamp(), updatedBy: myUid
    }, { merge: true }).catch(() => {});
    setActivity("watching", state === "playing" ? "▶ together" : "paused");
  }

  // ---------- Apply remote updates ----------
  async function onRemoteUpdate(data) {
    if (detached || !data?.videoId) return;
    container.querySelector("#wtUrl").value = data.url || "";
    const updatedByMe = data.updatedBy === myUid;
    const p = await ensurePlayer(data.videoId);

    // Avoid feedback: skip applying our own writes
    if (updatedByMe) {
      paintStatus(data.state);
      return;
    }
    suppressLocalEvents = true;
    try {
      const myTime = p.getCurrentTime ? p.getCurrentTime() : 0;
      if (Math.abs((data.time || 0) - myTime) > SYNC_THRESHOLD_SEC) {
        try { p.seekTo(data.time || 0, true); } catch {}
      }
      if (data.state === "playing") { try { p.playVideo(); } catch {} }
      else if (data.state === "paused") { try { p.pauseVideo(); } catch {} }
    } finally {
      // Allow local events again next tick
      setTimeout(() => { suppressLocalEvents = false; }, 600);
    }
    paintStatus(data.state);
  }

  function paintStatus(state) {
    const el = container.querySelector("#wtStatus");
    if (!el) return;
    el.classList.toggle("is-playing", state === "playing");
    el.textContent = state === "playing" ? "▶ Playing together"
                    : state === "paused"  ? "⏸ Paused"
                    : "Idle";
  }

  // ---------- Reactions ----------
  async function sendReaction(emoji) {
    if (!coupleId || !myUid) return;
    spawnReaction(emoji);   // local immediate feedback
    await safe(() => addDoc(collection(db, "watchSessions", coupleId, "reactions"), {
      emoji, by: myUid, at: serverTimestamp()
    }), null);
  }

  function spawnReaction(emoji) {
    const layer = container.querySelector("#wtReactions");
    if (!layer) return;
    const el = document.createElement("span");
    el.textContent = emoji;
    el.style.left = (10 + Math.random() * 80) + "%";
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2100);
  }

  // ---------- Cleanup ----------
  function destroy() {
    detached = true;
    try { off?.(); } catch {}
    try { unsubSession?.(); } catch {}
    try { unsubReactions?.(); } catch {}
    try { player?.destroy(); } catch {}
    player = null;
  }

  return { destroy };
}
