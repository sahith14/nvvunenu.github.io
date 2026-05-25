// modules/wrapped.js — Couple's Wrapped (Spotify-style monthly recap).
// 7 auto-advancing story slides computed from the last 30 days of
// activity: messages, top emoji, top mood, kindness, dates, days
// together, and a closing love-letter slide.
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, where, orderBy, limit, getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";
import { chatIdFor } from "../services/chatService.js";
import { coupleMetaPath } from "../services/coupleService.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, safe } from "../utils/toast.js";

let _container = null;
let _offState  = null;
let _state     = null;
let _ticker    = null;
let _stats     = null;
let _slideIdx  = 0;
let _paused    = false;

const WINDOW_DAYS = 30;
const SLIDE_MS = 4500;

// =====================================================================
// Render
// =====================================================================
export function renderWrapped(container) {
  _container = container;
  _container.innerHTML = `<div class="wr-loading">${skeletonList(2, "card")}</div>`;

  _offState = onAppState(async (s) => {
    if (!s.ready) return;
    _state = s;
    if (!s.coupleId) {
      _container.innerHTML = renderUnpaired();
      return;
    }
    if (!_stats) {
      _container.innerHTML = `<div class="wr-loading">${skeletonList(2, "card")}</div>`;
      _stats = await safe(() => computeStats(s.coupleId, s.user?.uid, s.partnerId), null) || {};
    }
    paint();
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  clearInterval(_ticker);
  _offState = null; _ticker = null;
  _state = null; _stats = null; _slideIdx = 0; _paused = false;
  _container = null;
}

// =====================================================================
// Slides
// =====================================================================
function slideTitle()    { return slide("title"); }
function slideMessages() { return slide("messages"); }
function slideEmoji()    { return slide("emoji"); }
function slideMood()     { return slide("mood"); }
function slideKindness() { return slide("kindness"); }
function slideDates()    { return slide("dates"); }
function slideOutro()    { return slide("outro"); }

const SLIDES = [
  slideTitle, slideMessages, slideEmoji, slideMood,
  slideKindness, slideDates, slideOutro
];

function slide(kind) {
  const s = _stats || {};
  const partnerName = _state?.partner?.displayName?.split(" ")[0] || _state?.partner?.username || "your partner";

  switch (kind) {
    case "title":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#ff7eb6,#9b8cff,#7ed7ff)",
        body: `
          <div class="wr-slide__chip">Couple's Wrapped</div>
          <div class="wr-slide__big">${escapeHtml(monthLabel())}</div>
          <div class="wr-slide__sub">A look at the last ${WINDOW_DAYS} days, just the two of you.</div>
        `
      });
    case "messages":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#ff7eb6,#ff5e7e)",
        body: `
          <div class="wr-slide__chip">Messages</div>
          <div class="wr-slide__big">${formatNum(s.messageCount || 0)}</div>
          <div class="wr-slide__sub">things said to each other this month</div>
          <div class="wr-slide__hint">${avgPerDay(s.messageCount || 0)} a day, on average.</div>
        `
      });
    case "emoji":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#ffd47a,#ff7eb6)",
        body: `
          <div class="wr-slide__chip">Top emoji</div>
          <div class="wr-slide__giant">${escapeHtml(s.topEmoji || "💜")}</div>
          <div class="wr-slide__sub">used ${s.topEmojiCount || 0} time${s.topEmojiCount === 1 ? "" : "s"}</div>
        `
      });
    case "mood":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#7ed7ff,#9b8cff)",
        body: `
          <div class="wr-slide__chip">Most-shared mood</div>
          <div class="wr-slide__giant">${escapeHtml(s.topMood || "🙂")}</div>
          <div class="wr-slide__sub">was the feeling of the month</div>
        `
      });
    case "kindness":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#ffb347,#ff7eb6)",
        body: `
          <div class="wr-slide__chip">Kindness</div>
          <div class="wr-slide__big">${formatNum(s.kindnessCount || 0)}</div>
          <div class="wr-slide__sub">kind acts logged this month 💛</div>
          ${s.kindnessCount === 0 ? `<div class="wr-slide__hint">Tip: log them on the Bond page.</div>` : ""}
        `
      });
    case "dates":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#9b8cff,#7763ff)",
        body: `
          <div class="wr-slide__chip">Dates done</div>
          <div class="wr-slide__big">${formatNum(s.datesDoneCount || 0)}</div>
          <div class="wr-slide__sub">memories made together 🌹</div>
        `
      });
    case "outro":
      return slideShell({
        kind, accent: "linear-gradient(135deg,#ff7eb6,#9b8cff)",
        body: `
          <div class="wr-slide__chip">${escapeHtml(s.daysTogether ? `${s.daysTogether} days strong` : "Together")}</div>
          <div class="wr-slide__title">You & ${escapeHtml(partnerName)}</div>
          <div class="wr-slide__sub">Here's to one more month.<br>Keep choosing each other.</div>
          <button class="wr-slide__btn" id="wrShare" type="button">Restart</button>
        `
      });
  }
  return "";
}

function slideShell({ kind, accent, body }) {
  return `
    <div class="wr-slide" data-kind="${kind}" style="--wr-accent:${accent};">
      <div class="wr-slide__bg"></div>
      <div class="wr-slide__inner">${body}</div>
    </div>`;
}

// =====================================================================
// Paint full surface
// =====================================================================
function paint() {
  if (!_container || !_state) return;
  const idx = _slideIdx;
  const slideHtml = SLIDES[idx]?.() || "";
  const total = SLIDES.length;

  _container.innerHTML = `
    <div class="wr-page">
      <div class="wr-bars">
        ${SLIDES.map((_, i) => `
          <div class="wr-bar ${i < idx ? "is-done" : ""} ${i === idx ? "is-active" : ""}">
            <div class="wr-bar__fill"></div>
          </div>
        `).join("")}
      </div>
      <div class="wr-stage" id="wrStage">
        ${slideHtml}
      </div>
      <button class="wr-tap wr-tap--prev" id="wrPrev" aria-label="Previous slide"></button>
      <button class="wr-tap wr-tap--next" id="wrNext" aria-label="Next slide"></button>
    </div>
  `;
  bind();
  resetTicker();
}

function bind() {
  _container.querySelector("#wrPrev")?.addEventListener("click", () => goto(_slideIdx - 1));
  _container.querySelector("#wrNext")?.addEventListener("click", () => goto(_slideIdx + 1));
  _container.querySelector("#wrShare")?.addEventListener("click", () => goto(0));

  // Pause while pressed
  const stage = _container.querySelector("#wrStage");
  if (stage) {
    const pause = () => { _paused = true; resetTicker(); };
    const resume = () => { _paused = false; resetTicker(); };
    stage.addEventListener("touchstart", pause, { passive: true });
    stage.addEventListener("touchend",   resume);
    stage.addEventListener("mousedown",  pause);
    stage.addEventListener("mouseup",    resume);
    stage.addEventListener("mouseleave", resume);
  }
}

function resetTicker() {
  clearInterval(_ticker);
  if (_paused) return;
  _ticker = setInterval(() => goto(_slideIdx + 1), SLIDE_MS);
}

function goto(idx) {
  const total = SLIDES.length;
  if (idx >= total) idx = 0;
  if (idx < 0) idx = total - 1;
  _slideIdx = idx;
  paint();
}

function renderUnpaired() {
  return `
    <div class="wr-unpaired">
      <div class="wr-unpaired__icon">🎁</div>
      <h3>Pair up to unlock Wrapped</h3>
      <p>Couple's Wrapped is built from 30 days of shared activity — connect with your partner first.</p>
      <button class="btn btn-primary" onclick="window.loadPage?.('bond')">Connect partner</button>
    </div>
  `;
}

// =====================================================================
// Stats — reads 30d of messages + couple meta + bond sub-collections.
// =====================================================================
async function computeStats(coupleId, myUid, partnerUid) {
  const since = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86400000);
  const out = {
    messageCount: 0,
    topEmoji: null,
    topEmojiCount: 0,
    topMood: null,
    kindnessCount: 0,
    datesDoneCount: 0,
    daysTogether: 0,
  };

  // Messages: count + top emoji
  if (myUid && partnerUid) {
    const chatId = chatIdFor(myUid, partnerUid);
    try {
      const q = query(
        collection(db, "chats", chatId, "messages"),
        where("time", ">=", since),
        orderBy("time", "desc"),
        limit(800)
      );
      const snap = await getDocs(q);
      out.messageCount = snap.size;
      const tally = {};
      snap.forEach((d) => {
        const t = (d.data().text || "");
        for (const ch of [...t]) {
          if (/\p{Extended_Pictographic}/u.test(ch)) tally[ch] = (tally[ch] || 0) + 1;
        }
      });
      let bestE = null, bestN = 0;
      for (const k of Object.keys(tally)) {
        if (tally[k] > bestN) { bestE = k; bestN = tally[k]; }
      }
      if (bestE) { out.topEmoji = bestE; out.topEmojiCount = bestN; }
    } catch {}
  }

  // Couple meta — top mood + days together
  try {
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const metaSnap = await getDoc(coupleMetaPath(coupleId));
    const meta = metaSnap.data() || {};
    const startedAt = meta.startedAt?.toMillis?.() || meta.startedAt?.seconds * 1000 || null;
    if (startedAt) out.daysTogether = Math.max(0, Math.floor((Date.now() - startedAt) / 86400000));
    // Tally moods from both partners' user-doc moodLog (best signal). Fall
    // back to current meta moods snapshot.
    const moods = meta.moods || {};
    const moodTally = {};
    for (const uid of Object.keys(moods)) {
      const e = moods[uid]?.emoji;
      if (e) moodTally[e] = (moodTally[e] || 0) + 1;
    }
    // Walk both users' moodLog maps if present
    for (const uid of [myUid, partnerUid]) {
      if (!uid) continue;
      try {
        const u = await getDoc((await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js")).doc(db, "users", uid));
        const log = u.data()?.moodLog || {};
        for (const k of Object.keys(log)) moodTally[log[k]] = (moodTally[log[k]] || 0) + 1;
      } catch {}
    }
    let bestM = null, bestNM = 0;
    for (const k of Object.keys(moodTally)) {
      if (moodTally[k] > bestNM) { bestM = k; bestNM = moodTally[k]; }
    }
    if (bestM) out.topMood = bestM;
  } catch {}

  // Bond sub-collections
  out.kindnessCount   = await countSubcol(coupleId, "kindness", "at", since);
  out.datesDoneCount  = await countSubcol(coupleId, "dates",    "completedAt", since);

  return out;
}

async function countSubcol(coupleId, sub, field, since) {
  try {
    const q = query(
      collection(db, "bonds", coupleId, sub),
      where(field, ">=", since),
      orderBy(field, "desc"),
      limit(200)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch { return 0; }
}

// =====================================================================
// Helpers
// =====================================================================
function monthLabel() {
  return new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function formatNum(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function avgPerDay(n) {
  const v = (n / WINDOW_DAYS);
  return v < 1 ? "Less than 1" : Math.round(v);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
