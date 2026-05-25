// modules/dateIdeas.js — Date-night planner.
// Curated bank of date ideas tagged by mood/budget/season.
// "Tonight's pick" is deterministic by today's date so both partners
// land on the same idea. Favorites + completed are stored on the
// couple bond document.
//
// Storage:
//   bonds/{coupleId}/dates/{ideaId}  -> { savedAt, completedAt }
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState, getState } from "../state/appState.js";
import { spawnHeartBurst } from "../services/notifyService.js";
import { toast, toastSuccess, toastWarn, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";

let _container = null;
let _offState  = null;
let _unsub     = null;
let _state     = null;
let _picks     = {};       // ideaId → { savedAt?, completedAt? }
let _filter    = "all";    // 'all' | 'home' | 'out' | 'cheap' | 'long' | 'creative' | 'romantic'

// =====================================================================
// Curated bank — 50 ideas
// =====================================================================
const IDEAS = [
  // ---- HOME / COZY -------------------------------------------------
  { id: "blanket-fort",   icon: "🏰", title: "Blanket fort movie night", desc: "Pillows, fairy lights, two snacks each, no rules.", tags: ["home","cheap","romantic"] },
  { id: "candle-dinner",  icon: "🕯️", title: "Candle-lit dinner at home", desc: "Cook together. Phones in another room.", tags: ["home","cheap","romantic"] },
  { id: "letter-night",   icon: "💌", title: "Trade hand-written letters", desc: "30 minutes apart, then read each other's quietly.", tags: ["home","cheap","romantic","creative"] },
  { id: "spa-night",      icon: "🛁", title: "DIY home spa", desc: "Bath salts, face masks, a playlist that's mostly slow.", tags: ["home","cheap"] },
  { id: "puzzle-night",   icon: "🧩", title: "1000-piece puzzle marathon", desc: "Wine optional. Inside jokes mandatory.", tags: ["home","long","cheap"] },
  { id: "cooking-class",  icon: "🍝", title: "Cook a recipe you've never tried", desc: "Pick a country, pick a dish, mess up the kitchen.", tags: ["home","creative","long"] },
  { id: "stargaze-roof",  icon: "🌌", title: "Stargaze from the rooftop", desc: "Bring a thermos. Trade your favourite memories.", tags: ["home","cheap","romantic"] },
  { id: "playlist-swap",  icon: "🎧", title: "Make each other a 10-song playlist", desc: "Honest captions only. Press play together.", tags: ["home","cheap","creative"] },
  { id: "breakfast-bed",  icon: "🥞", title: "Breakfast in bed (your turn this time)", desc: "Whoever lost the last argument cooks. Laughing counts.", tags: ["home","cheap","romantic"] },
  { id: "old-photos",     icon: "📷", title: "Scroll through your oldest photos together", desc: "Tell the story behind the awkward ones.", tags: ["home","cheap","romantic"] },

  // ---- OUTSIDE / GO OUT --------------------------------------------
  { id: "long-drive",     icon: "🚗", title: "Aimless long drive", desc: "Pick a direction, no destination. AC on, music up.", tags: ["out","long","cheap"] },
  { id: "sunset-walk",    icon: "🌅", title: "Sunset walk, leave phones in the car", desc: "30 minutes of just walking + talking.", tags: ["out","cheap","romantic"] },
  { id: "farmer-market",  icon: "🥕", title: "Farmer's market crawl", desc: "Buy two things you've never tasted before.", tags: ["out","cheap"] },
  { id: "art-museum",     icon: "🖼️", title: "Tiny museum tour", desc: "Each pick a favorite piece, defend it like a lawyer.", tags: ["out","creative"] },
  { id: "bookstore-buy",  icon: "📚", title: "Bookstore date — pick books for each other", desc: "Budget cap of one each. Read sample pages on a bench.", tags: ["out","cheap","creative"] },
  { id: "boat-ride",      icon: "🛶", title: "Pedal boat / row boat hour", desc: "Whoever steers picks where. Don't capsize.", tags: ["out","romantic","creative"] },
  { id: "food-truck",     icon: "🌮", title: "Food truck rally tasting", desc: "Order one thing each from three different trucks.", tags: ["out","cheap"] },
  { id: "live-music",     icon: "🎤", title: "Find a tiny live music night", desc: "Open mic, indie show, jazz bar — whatever's local.", tags: ["out","creative","romantic"] },
  { id: "arcade-night",   icon: "👾", title: "Old-school arcade night", desc: "Race for high scores. Loser buys ice cream.", tags: ["out","cheap"] },
  { id: "bike-ride",      icon: "🚲", title: "Slow bike ride to nowhere", desc: "Stop at every food cart that smells good.", tags: ["out","cheap","long"] },

  // ---- CHEAP / FREE ------------------------------------------------
  { id: "park-picnic",    icon: "🧺", title: "Park picnic with whatever is in the fridge", desc: "Cheese, fruit, bread. Something cold. A blanket.", tags: ["out","cheap","romantic"] },
  { id: "library-date",   icon: "📖", title: "Library date — pick a poem each", desc: "Read them aloud quietly across the table.", tags: ["out","cheap","creative","romantic"] },
  { id: "people-watch",   icon: "☕", title: "Coffee shop people-watching", desc: "Make up a backstory for the most interesting person.", tags: ["out","cheap","creative"] },
  { id: "free-class",     icon: "🎨", title: "Free community class", desc: "Yoga, drawing, cooking, salsa — pick anything new.", tags: ["out","cheap","creative"] },
  { id: "thrift-shop",    icon: "👗", title: "Thrift shop dress-up", desc: "Pick outfits for each other under $10. Send a photo.", tags: ["out","cheap","creative"] },

  // ---- CREATIVE / WEIRD --------------------------------------------
  { id: "draw-each",      icon: "✏️", title: "Draw each other in 10 minutes", desc: "No looking until you're done. Compliments only.", tags: ["home","creative","cheap","romantic"] },
  { id: "song-write",     icon: "🎼", title: "Write a 4-line song about each other", desc: "It can be terrible. It will probably be terrible.", tags: ["home","creative","cheap"] },
  { id: "future-letter",  icon: "📜", title: "Write a letter to your 10-year-from-now selves", desc: "Seal it. Schedule a calendar reminder a decade out.", tags: ["home","creative","romantic"] },
  { id: "memory-jar",     icon: "🍯", title: "Start a memory jar together", desc: "Each write 3 small good things from this week.", tags: ["home","cheap","creative","long"] },
  { id: "polaroid-night", icon: "📸", title: "Take 10 polaroid-style portraits", desc: "Use a phone. Get silly. Print one favourite.", tags: ["home","creative"] },
  { id: "stargaze-trail", icon: "🛣️", title: "Drive somewhere dark to see real stars", desc: "Hot drinks. Blankets. One nice playlist.", tags: ["out","romantic","long","creative"] },

  // ---- LONG / EXPERIENCE -------------------------------------------
  { id: "hike-summit",    icon: "🥾", title: "Hike to a small summit", desc: "Start early. Bring snacks. Trade stories on the way up.", tags: ["out","long","cheap","creative"] },
  { id: "weekend-trip",   icon: "🚂", title: "Weekend train trip to a nearby town", desc: "Book a place last-minute. Walk everywhere.", tags: ["out","long","romantic"] },
  { id: "spa-day",        icon: "💆", title: "Real spa day", desc: "Both of you. Phones off. Whoever's working pays.", tags: ["out","long","romantic"] },
  { id: "festival",       icon: "🎪", title: "Find a local festival or fair", desc: "Eat too many things. Take an embarrassing photo each.", tags: ["out","long","creative"] },
  { id: "stay-cation",    icon: "🛏️", title: "Stay-cation — book a hotel in your own city", desc: "Order room service for breakfast.", tags: ["out","long","romantic"] },

  // ---- ROMANTIC ----------------------------------------------------
  { id: "first-date-redo",icon: "💞", title: "Re-do your first date, exactly", desc: "Same place, same order, different memory.", tags: ["out","romantic","long"] },
  { id: "slow-dance",     icon: "💃", title: "Slow dance in the kitchen", desc: "One song you both love, lights low.", tags: ["home","cheap","romantic"] },
  { id: "dream-board",    icon: "✂️", title: "Make a 5-year dream board together", desc: "Magazines, scissors, glue, honesty.", tags: ["home","creative","long","romantic"] },
  { id: "love-list",      icon: "📝", title: "Write 25 things you love about each other", desc: "Trade lists. Don't comment, just keep them.", tags: ["home","cheap","romantic","creative"] },
  { id: "couples-quiz",   icon: "❓", title: "How well do we know each other? quiz", desc: "20 questions, swap papers, score honestly.", tags: ["home","cheap","creative","romantic"] },

  // ---- SEASONAL ----------------------------------------------------
  { id: "leaf-walk",      icon: "🍂", title: "Autumn leaf walk + hot drinks", desc: "Find the most yellow tree on the block.", tags: ["out","cheap","romantic"] },
  { id: "snow-day",       icon: "❄️", title: "Snow day pancakes & a long film", desc: "Pillows on the floor. Whatever is most warm.", tags: ["home","cheap","long","romantic"] },
  { id: "rain-cafe",      icon: "🌧️", title: "Rainy day café with a book each", desc: "Same table. No talking required.", tags: ["out","cheap","creative","romantic"] },
  { id: "summer-pool",    icon: "🏊", title: "Backyard / hotel pool afternoon", desc: "Sunscreen. One playlist. Two cold drinks.", tags: ["out","romantic"] },
  { id: "spring-flowers", icon: "🌷", title: "Buy flowers for each other (separately, surprise)", desc: "Meet at home. Compare. Laugh. Trade them.", tags: ["out","cheap","romantic","creative"] },

  // ---- PLAYFUL -----------------------------------------------------
  { id: "board-game",     icon: "🎲", title: "Board game tournament", desc: "Best of three. Loser plans next date.", tags: ["home","cheap","long"] },
  { id: "karaoke",        icon: "🎙️", title: "Karaoke at home, dramatic edition", desc: "One ballad each. Standing on the bed allowed.", tags: ["home","cheap","creative"] },
  { id: "scavenger",      icon: "🗺️", title: "10-item neighbourhood scavenger hunt", desc: "Make the list together. Time yourselves. Selfie at each.", tags: ["out","cheap","creative","long"] },
  { id: "cocktail-mix",   icon: "🍹", title: "Invent a cocktail and name it after you", desc: "Three ingredients each. Vote on the best.", tags: ["home","cheap","creative"] },
];

const CATEGORIES = [
  { key: "all",      label: "All",       icon: "🔮" },
  { key: "home",     label: "At home",   icon: "🏡" },
  { key: "out",      label: "Out",       icon: "🚪" },
  { key: "cheap",    label: "Cheap",     icon: "💸" },
  { key: "long",     label: "Long form", icon: "🌅" },
  { key: "creative", label: "Creative",  icon: "🎨" },
  { key: "romantic", label: "Romantic",  icon: "💞" },
];

// =====================================================================
// Render
// =====================================================================
export function renderDateIdeas(container) {
  _container = container;
  _container.innerHTML = `<div class="di-loading">${skeletonList(3, "card")}</div>`;

  _offState = onAppState((s) => {
    if (!s.ready) return;
    _state = s;
    if (!s.coupleId) {
      _container.innerHTML = renderUnpaired();
      return;
    }
    if (!_unsub) attachSubscription(s.coupleId);
    paint();
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsub?.(); } catch {}
  _offState = null; _unsub = null;
  _state = null; _picks = {}; _container = null;
}

function attachSubscription(coupleId) {
  _unsub = onSnapshot(collection(db, "bonds", coupleId, "dates"), (snap) => {
    _picks = {};
    snap.forEach((d) => { _picks[d.id] = d.data() || {}; });
    paint();
  });
}

function paint() {
  if (!_container || !_state) return;
  const tonight = pickTonight(_state.coupleId);

  const filtered = _filter === "all"
    ? IDEAS
    : IDEAS.filter((it) => it.tags.includes(_filter));

  const favs = IDEAS.filter((it) => _picks[it.id]?.savedAt);
  const done = IDEAS.filter((it) => _picks[it.id]?.completedAt);
  maybeCelebrateFirstDate(done.length);

  _container.innerHTML = `
    <div class="di-page stagger">
      <header class="di-hero">
        <div class="di-hero__chip">Tonight's idea</div>
        <h2 class="di-hero__title">${escapeHtml(tonight.title)}</h2>
        <div class="di-hero__icon">${tonight.icon}</div>
        <p class="di-hero__desc">${escapeHtml(tonight.desc)}</p>
        <div class="di-hero__tags">
          ${tonight.tags.map(t => `<span class="di-tag">${escapeHtml(t)}</span>`).join("")}
        </div>
        <div class="di-hero__actions">
          <button class="btn btn-ghost"   id="diShuffle" title="New random pick">🎲 Shuffle</button>
          <button class="btn btn-primary" id="diSaveTonight" data-id="${escapeHtml(tonight.id)}">${_picks[tonight.id]?.savedAt ? "★ Saved" : "☆ Save"}</button>
          <button class="btn btn-primary" id="diDoneTonight" data-id="${escapeHtml(tonight.id)}">${_picks[tonight.id]?.completedAt ? "✓ Done" : "Mark done"}</button>
        </div>
      </header>

      <nav class="di-cats">
        ${CATEGORIES.map(c => `
          <button class="di-cat ${_filter === c.key ? "is-active" : ""}" data-cat="${c.key}">
            <span class="di-cat__icon">${c.icon}</span>
            <span class="di-cat__label">${escapeHtml(c.label)}</span>
          </button>
        `).join("")}
      </nav>

      <section class="di-section">
        <h3 class="di-h">Browse <span class="di-h__count">${filtered.length}</span></h3>
        <div class="di-grid">
          ${filtered.map(it => ideaCard(it)).join("")}
        </div>
      </section>

      ${favs.length ? `
        <section class="di-section">
          <h3 class="di-h">Saved <span class="di-h__count">${favs.length}</span></h3>
          <div class="di-grid">${favs.map(it => ideaCard(it)).join("")}</div>
        </section>` : ""}

      ${done.length ? `
        <section class="di-section">
          <h3 class="di-h">Completed <span class="di-h__count">${done.length}</span></h3>
          <div class="di-grid">${done.map(it => ideaCard(it)).join("")}</div>
        </section>` : ""}

      <p class="di-hint">Tonight's pick is the same on both your phones — pick another by hitting Shuffle.</p>
    </div>
  `;

  bind();
}

function ideaCard(it) {
  const saved = !!_picks[it.id]?.savedAt;
  const done  = !!_picks[it.id]?.completedAt;
  return `
    <article class="di-card ${done ? "is-done" : ""}" data-id="${escapeHtml(it.id)}">
      <div class="di-card__icon">${it.icon}</div>
      <div class="di-card__body">
        <div class="di-card__title">${escapeHtml(it.title)}</div>
        <div class="di-card__desc">${escapeHtml(it.desc)}</div>
        <div class="di-card__tags">
          ${it.tags.slice(0,3).map(t => `<span class="di-tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      </div>
      <div class="di-card__actions">
        <button class="di-icon-btn ${saved ? "is-on" : ""}" data-act="save" title="${saved ? "Saved" : "Save"}">${saved ? "★" : "☆"}</button>
        <button class="di-icon-btn ${done ? "is-on" : ""}" data-act="done" title="${done ? "Done" : "Mark done"}">${done ? "✓" : "○"}</button>
      </div>
    </article>`;
}

function renderUnpaired() {
  return `
    <div class="di-unpaired">
      <div class="di-unpaired__icon">💞</div>
      <h3>Pair up to plan dates together</h3>
      <p>Tonight's pick stays in sync between the two of you, so you both land on the same idea.</p>
      <button class="btn btn-primary" onclick="window.loadPage?.('bond')">Connect partner</button>
    </div>
  `;
}

// =====================================================================
// Bind
// =====================================================================
function bind() {
  // Hero buttons
  const tonight = pickTonight(_state.coupleId);
  _container.querySelector("#diShuffle")?.addEventListener("click", () => {
    // Shuffle = pick a fresh random idea once for this session
    const next = IDEAS[Math.floor(Math.random() * IDEAS.length)];
    _sessionShuffleId = next.id;
    paint();
  });
  _container.querySelector("#diSaveTonight")?.addEventListener("click", (e) =>
    toggleSave(e.currentTarget.dataset.id));
  _container.querySelector("#diDoneTonight")?.addEventListener("click", (e) =>
    toggleDone(e.currentTarget.dataset.id));

  // Category filter
  _container.querySelectorAll(".di-cat").forEach((b) => {
    b.addEventListener("click", () => {
      _filter = b.dataset.cat;
      paint();
    });
  });

  // Card actions
  _container.querySelectorAll(".di-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-act="save"]')?.addEventListener("click", (e) => {
      e.stopPropagation(); toggleSave(id);
    });
    card.querySelector('[data-act="done"]')?.addEventListener("click", (e) => {
      e.stopPropagation(); toggleDone(id);
    });
  });
}

// =====================================================================
// Toggle save / done
// =====================================================================
async function toggleSave(id) {
  if (!_state.coupleId) return;
  const ref = doc(db, "bonds", _state.coupleId, "dates", id);
  const cur = _picks[id] || {};
  if (cur.savedAt) {
    if (cur.completedAt) {
      // unset just savedAt by re-writing without it
      await safe(() => setDoc(ref, { completedAt: cur.completedAt, savedAt: null }, { merge: true }), null);
    } else {
      await safe(() => deleteDoc(ref), null);
    }
    toast("Removed from saved");
  } else {
    await safe(() => setDoc(ref, { savedAt: serverTimestamp() }, { merge: true }), "Couldn't save");
    toastSuccess("Saved 💜");
  }
}

async function toggleDone(id) {
  if (!_state.coupleId) return;
  const ref = doc(db, "bonds", _state.coupleId, "dates", id);
  const cur = _picks[id] || {};
  if (cur.completedAt) {
    if (cur.savedAt) {
      await safe(() => setDoc(ref, { savedAt: cur.savedAt, completedAt: null }, { merge: true }), null);
    } else {
      await safe(() => deleteDoc(ref), null);
    }
    toast("Marked not-done");
  } else {
    await safe(() => setDoc(ref, { completedAt: serverTimestamp() }, { merge: true }), "Couldn't update");
    toastSuccess("Done — that's a memory now ✨");
  }
}

// =====================================================================
// Tonight's pick — deterministic by date + coupleId
// =====================================================================
let _sessionShuffleId = null;
function pickTonight(coupleId) {
  if (_sessionShuffleId) {
    const found = IDEAS.find((it) => it.id === _sessionShuffleId);
    if (found) return found;
  }
  const today = new Date();
  const key = `${today.getFullYear()}${today.getMonth()}${today.getDate()}|${coupleId || "x"}`;
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return IDEAS[Math.abs(h) % IDEAS.length];
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}



// =====================================================================
// First-date celebration — fires once per couple when their dates
// completed-count transitions from 0 to 1+.
// =====================================================================
function maybeCelebrateFirstDate(total) {
  if (!total) return;
  const cid = getState()?.coupleId;
  if (!cid) return;
  const key = `nvvunenu.firstDate.${cid}`;
  let already = false;
  try { already = localStorage.getItem(key) === "1"; } catch {}
  if (already) return;
  try { localStorage.setItem(key, "1"); } catch {}

  setTimeout(() => {
    try { spawnHeartBurst(); } catch {}
    toastSuccess("First date checked off 🌹 — keep collecting them");
  }, 500);
}
