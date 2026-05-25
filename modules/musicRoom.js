// =====================================================================
// modules/musicRoom.js — synced couple music room.
// Mirrors watchTogether's architecture but for audio:
//   musicRooms/{coupleId} = { url, kind, title, state, time, updatedAt, updatedBy }
//   musicRooms/{coupleId}/reactions = sub-collection of emoji bursts.
//
// Supports two source kinds:
//   • direct  — any direct audio URL (mp3/m4a/ogg). Played via <audio>.
//   • youtube — YouTube URL. Played via the YT IFrame API in audio mode.
// =====================================================================
import { db } from "../firebase.js";
import { doc, setDoc, onSnapshot, collection, addDoc, query, orderBy, limit, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getState, onAppState } from "../state/appState.js";
import { setActivity } from "../services/presenceService.js";
import { toast, toastWarn, safe } from "../utils/toast.js";

const SYNC_THRESHOLD_SEC   = 1.5;
const SYNC_WRITE_THROTTLE  = 1500;

let _ytApiPromise = null;
function loadYouTubeAPI() {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch {} resolve(window.YT); };
  });
  return _ytApiPromise;
}

function parseSource(url) {
  if (!url) return null;
  const ytPatterns = [
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of ytPatterns) {
    const m = url.match(re);
    if (m) return { kind: "youtube", id: m[1], url };
  }
  if (/\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(url)) return { kind: "direct", url };
  // Fallback: assume direct audio
  return { kind: "direct", url };
}

export function mountMusicRoom(container) {
  let unsubSession = null;
  let unsubReactions = null;
  let myUid = null, coupleId = null;
  let lastWriteAt = 0;
  let suppressLocalEvents = false;
  let detached = false;

  // active player state
  let kind = null;     // 'direct' | 'youtube' | null
  let audioEl = null;  // <audio>
  let ytPlayer = null;

  container.innerHTML = renderShell();
  bind();

  const off = onAppState((s) => {
    if (!s.ready) return;
    myUid = s.user?.uid;
    if (!s.partnerId || !s.coupleId) {
      container.innerHTML = renderUnpaired();
      return;
    }
    if (coupleId !== s.coupleId) {
      coupleId = s.coupleId;
      attachSync();
      attachReactions();
    }
  });

  // ---------- Subscriptions ----------
  function attachSync() {
    unsubSession?.();
    unsubSession = onSnapshot(doc(db, "musicRooms", coupleId), (snap) => {
      const data = snap.data();
      if (!data) return;
      onRemoteUpdate(data);
    });
  }
  function attachReactions() {
    unsubReactions?.();
    const q = query(
      collection(db, "musicRooms", coupleId, "reactions"),
      orderBy("at", "desc"), limit(20)
    );
    let firstSnap = true;
    unsubReactions = onSnapshot(q, (snap) => {
      if (firstSnap) { firstSnap = false; return; }
      snap.docChanges().forEach((c) => {
        if (c.type === "added") spawnReaction(c.doc.data().emoji);
      });
    });
  }

  // ---------- DOM ----------
  function renderShell() {
    return `
      <div class="mr">
        <div class="mr__top">
          <input id="mrUrl" type="url" placeholder="Paste a song link (YouTube or direct mp3)…" inputmode="url" autocomplete="off">
          <button class="btn btn-primary" id="mrLoad">Load</button>
        </div>

        <div class="mr__player" id="mrPlayer">
          <div class="mr__cover" aria-hidden="true">
            <div class="mr__disc"></div>
            <div class="mr__disc-glow"></div>
          </div>
          <div class="mr__title-row">
            <div class="mr__title" id="mrTitle">No track loaded</div>
            <div class="mr__sub"   id="mrSub">Load any YouTube link or direct audio URL to listen together.</div>
          </div>
          <audio id="mrAudio" preload="metadata" controls></audio>
          <div class="mr__yt"   id="mrYt" hidden></div>
          <div class="mr__reactions" id="mrReactions" aria-hidden="true"></div>
        </div>

        <div class="mr__row">
          <div class="mr__live-status" id="mrStatus">Idle</div>
          <div class="mr__react-bar">
            ${["💜","🔥","🥺","😭","🎶","✨"].map(e => `<button class="mr__react" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
          </div>
        </div>
      </div>
      <style>
        .mr { display: flex; flex-direction: column; gap: 12px; }
        .mr__top { display: flex; gap: 8px; }
        .mr__top input {
          flex: 1; height: 42px; padding: 0 14px; border-radius: 12px;
          border: 1px solid rgba(155,140,255,.3); background: rgba(255,255,255,.85);
          font-family: inherit; font-size: .9375rem; color: #1a1235;
        }
        .mr__top .btn { padding: 0 18px; height: 42px; border-radius: 12px; }

        .mr__player {
          position: relative;
          background: linear-gradient(135deg,#1a1235 0%,#3a2d6e 60%,#1a1235 100%);
          border-radius: 22px; padding: 22px;
          color: #fff;
          box-shadow: 0 14px 40px rgba(143,116,255,.25);
          overflow: hidden;
          min-height: 220px;
        }
        .mr__cover {
          position: relative; width: 130px; height: 130px; margin: 0 auto;
        }
        .mr__disc {
          position: absolute; inset: 0; border-radius: 50%;
          background:
            radial-gradient(circle at 50% 50%, #1a1235 0%, #1a1235 22%, transparent 22%),
            conic-gradient(from 0deg, rgba(255,126,182,.85), rgba(155,140,255,.85), rgba(126,215,255,.85), rgba(255,126,182,.85));
          animation: mr-spin 8s linear infinite;
          filter: drop-shadow(0 8px 24px rgba(255,126,182,.5));
        }
        .mr__disc-glow {
          position: absolute; inset: -20%; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,126,182,.4), transparent 60%);
          filter: blur(20px); pointer-events: none;
        }
        @keyframes mr-spin { to { transform: rotate(360deg); } }
        .mr__title-row { text-align: center; margin-top: 14px; }
        .mr__title { font-size: 1rem; font-weight: 700; color: #fff; }
        .mr__sub   { font-size: .8125rem; color: #c8baff; margin-top: 2px; }
        .mr__player audio {
          display: block; width: 100%; margin-top: 16px;
          filter: invert(1) hue-rotate(180deg) brightness(.95);  /* tint the controls */
        }
        .mr__yt iframe { width: 100%; height: 60px; }
        .mr__reactions { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .mr__reactions span {
          position: absolute; bottom: 6%; font-size: 26px;
          animation: mr-rise 2s ease-out forwards;
          will-change: transform, opacity;
        }
        @keyframes mr-rise {
          0%   { transform: translateY(0)     rotate(0)   scale(.8); opacity: 1; }
          100% { transform: translateY(-200px) rotate(20deg) scale(1.2); opacity: 0; }
        }

        .mr__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .mr__live-status {
          padding: 6px 12px; border-radius: 999px;
          background: rgba(255,255,255,.85); border: 1px solid rgba(155,140,255,.25);
          font-size: .8125rem; font-weight: 600; color: #4f3d80;
        }
        .mr__live-status.is-playing {
          background: linear-gradient(135deg,#ff7eb6,#9b8cff);
          color: #fff; border-color: transparent;
        }
        .mr__react-bar { display: flex; gap: 6px; flex-wrap: wrap; }
        .mr__react {
          width: 38px; height: 38px; border-radius: 50%;
          background: rgba(255,255,255,.85); border: 1px solid rgba(155,140,255,.25);
          font-size: 18px; cursor: pointer; transition: transform .15s;
        }
        .mr__react:hover { transform: scale(1.1); }
      </style>
    `;
  }

  function renderUnpaired() {
    return `
      <div style="text-align:center;padding:32px;background:rgba(255,255,255,.85);border-radius:18px;">
        <div style="font-size:42px;">🎵</div>
        <h3 style="margin:6px 0 8px">Pair up to listen together</h3>
        <p style="color:#4f3d80;max-width:36ch;margin:0 auto 16px">Both partners need to be connected so we can sync the same playhead.</p>
        <button class="btn btn-primary" onclick="window.loadPage?.('profile')">Connect partner</button>
      </div>
    `;
  }

  function bind() {
    container.querySelector("#mrLoad")?.addEventListener("click", onLoad);
    container.querySelector("#mrUrl")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); onLoad(); }
    });
    container.querySelectorAll(".mr__react").forEach((btn) => {
      btn.addEventListener("click", () => sendReaction(btn.dataset.emoji));
    });

    // direct audio events
    audioEl = container.querySelector("#mrAudio");
    if (audioEl) {
      audioEl.addEventListener("play",  () => writeOutboundIfDirect("playing"));
      audioEl.addEventListener("pause", () => writeOutboundIfDirect("paused"));
      audioEl.addEventListener("seeked",() => writeOutboundIfDirect());  // best-effort
    }
  }

  // ---------- Load track ----------
  async function onLoad() {
    if (!coupleId) return toastWarn("Connect with your partner first");
    const url = container.querySelector("#mrUrl").value.trim();
    const src = parseSource(url);
    if (!src) return toastWarn("That URL doesn't look right");
    await safe(() => setDoc(doc(db, "musicRooms", coupleId), {
      url: src.url, kind: src.kind, videoId: src.id || null,
      title: extractTitle(src),
      state: "playing", time: 0,
      updatedAt: serverTimestamp(), updatedBy: myUid
    }, { merge: true }), "Couldn't start music room");
  }

  function extractTitle(src) {
    if (src.kind === "youtube") return "YouTube · " + src.id;
    try {
      const u = new URL(src.url);
      const last = decodeURIComponent(u.pathname.split("/").pop() || "");
      return last || u.host;
    } catch { return "Track"; }
  }

  // ---------- Apply remote updates ----------
  async function onRemoteUpdate(data) {
    if (detached || !data?.url) return;
    container.querySelector("#mrUrl").value = data.url;
    container.querySelector("#mrTitle").textContent = data.title || "Track";
    container.querySelector("#mrSub").textContent = data.kind === "youtube" ? "YouTube · synced" : "Direct audio · synced";

    const updatedByMe = data.updatedBy === myUid;
    if (data.kind === "youtube") {
      await ensureYouTube(data.videoId);
      // hide direct audio
      audioEl.hidden = true;
      container.querySelector("#mrYt").hidden = false;
      if (updatedByMe) { paintStatus(data.state); return; }
      suppressLocalEvents = true;
      try {
        const myTime = ytPlayer?.getCurrentTime?.() || 0;
        if (Math.abs((data.time || 0) - myTime) > SYNC_THRESHOLD_SEC) {
          try { ytPlayer.seekTo(data.time || 0, true); } catch {}
        }
        if (data.state === "playing") { try { ytPlayer.playVideo(); } catch {} }
        else if (data.state === "paused") { try { ytPlayer.pauseVideo(); } catch {} }
      } finally { setTimeout(() => { suppressLocalEvents = false; }, 600); }
      paintStatus(data.state);
    } else {
      // direct audio
      kind = "direct";
      container.querySelector("#mrYt").hidden = true;
      audioEl.hidden = false;
      if (audioEl.src !== data.url) audioEl.src = data.url;
      if (updatedByMe) { paintStatus(data.state); return; }
      suppressLocalEvents = true;
      try {
        if (Math.abs((data.time || 0) - audioEl.currentTime) > SYNC_THRESHOLD_SEC) {
          try { audioEl.currentTime = data.time || 0; } catch {}
        }
        if (data.state === "playing") { try { await audioEl.play(); } catch {} }
        else if (data.state === "paused") { try { audioEl.pause(); } catch {} }
      } finally { setTimeout(() => { suppressLocalEvents = false; }, 600); }
      paintStatus(data.state);
    }
  }

  async function ensureYouTube(videoId) {
    await loadYouTubeAPI();
    if (ytPlayer && ytPlayer._videoId === videoId) return ytPlayer;
    const ytEl = container.querySelector("#mrYt");
    if (ytPlayer) { try { ytPlayer.destroy(); } catch {} ytPlayer = null; }
    return new Promise((resolve) => {
      ytPlayer = new window.YT.Player(ytEl, {
        videoId,
        height: "60", width: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
        events: {
          onReady: () => { ytPlayer._videoId = videoId; kind = "youtube"; resolve(ytPlayer); },
          onStateChange: (ev) => onYTStateChange(ev),
        }
      });
    });
  }

  function onYTStateChange(ev) {
    if (suppressLocalEvents || !coupleId) return;
    const YT = window.YT; if (!YT) return;
    const time = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    let state = "idle";
    if (ev.data === YT.PlayerState.PLAYING) state = "playing";
    else if (ev.data === YT.PlayerState.PAUSED) state = "paused";
    else return;
    writeOutbound(state, time);
  }

  function writeOutboundIfDirect(stateOverride) {
    if (suppressLocalEvents || !coupleId || kind !== "direct") return;
    const time = audioEl.currentTime || 0;
    const state = stateOverride || (audioEl.paused ? "paused" : "playing");
    writeOutbound(state, time);
  }
  function writeOutbound(state, time) {
    if (Date.now() - lastWriteAt < SYNC_WRITE_THROTTLE) return;
    lastWriteAt = Date.now();
    setDoc(doc(db, "musicRooms", coupleId), {
      state, time, updatedAt: serverTimestamp(), updatedBy: myUid
    }, { merge: true }).catch(() => {});
    setActivity("listening", state === "playing" ? "▶ together" : "paused");
  }

  function paintStatus(state) {
    const el = container.querySelector("#mrStatus");
    if (!el) return;
    el.classList.toggle("is-playing", state === "playing");
    el.textContent = state === "playing" ? "▶ Listening together"
                    : state === "paused"  ? "⏸ Paused"
                    : "Idle";
  }

  // ---------- Reactions ----------
  async function sendReaction(emoji) {
    if (!coupleId || !myUid) return;
    spawnReaction(emoji);
    await safe(() => addDoc(collection(db, "musicRooms", coupleId, "reactions"), {
      emoji, by: myUid, at: serverTimestamp()
    }), null);
  }
  function spawnReaction(emoji) {
    const layer = container.querySelector("#mrReactions");
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
    try { ytPlayer?.destroy(); } catch {}
    try { audioEl?.pause(); } catch {}
    audioEl = null; ytPlayer = null;
  }

  return { destroy };
}
