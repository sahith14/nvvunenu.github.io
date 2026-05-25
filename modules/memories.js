// =====================================================================
// modules/memories.js — Cinematic couple memory experience.
// Sections: hero, On this day, search, view toggle (Timeline | Photos),
// AI weekly recap (heuristic), lightbox, FAB.
//
// Storage stays unchanged — uses services/memoryService.js.
// =====================================================================
import { onAppState, getState } from "../state/appState.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { addMemory, subscribeRecent, deleteMemory, toggleFavoriteMemory } from "../services/memoryService.js";

let _container       = null;
let _offState        = null;
let _unsub           = null;
let _lastCoupleId    = null;
let _allMemories     = [];     // last snapshot, full array
let _filteredMemories= [];     // after search filter
let _sourceFilter    = "all";  // 'all' | 'camera' | 'chat' | 'gallery'
let _searchTimer     = null;
let _query           = "";
let _view            = "timeline";   // 'timeline' | 'photos'

export function renderMemories(container) {
  _container = container;
  _container.innerHTML = renderShell();
  bind();

  _offState = onAppState((s) => {
    if (!s.ready) return;
    if (s.coupleId !== _lastCoupleId) {
      _lastCoupleId = s.coupleId;
      try { _unsub?.(); } catch {}
      _unsub = null;
      if (!s.coupleId) {
        renderUnpaired();
      } else {
        _unsub = subscribeRecent(s.coupleId, (rows) => {
          _allMemories = rows || [];
          applyFilter();
        }, 60);
      }
    }
    paintHero(s);
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsub?.(); } catch {}
  clearTimeout(_searchTimer);
  _offState = _unsub = null;
  _container = null;
  _allMemories = []; _filteredMemories = []; _query = ""; _view = "timeline"; _lastCoupleId = null;
  _sourceFilter = "all";
}

// =========================================================================
// Shell
// =========================================================================
function renderShell() {
  return `
    <section class="mem-page">
      <header class="mem-hero">
        <div class="mem-hero__inner">
          <div class="mem-hero__eyebrow">Our shared archive</div>
          <h1 class="mem-hero__title">Memories</h1>
          <p class="mem-hero__sub" id="memHeroSub">Every photo and note you save here is just for the two of you.</p>
          <div class="mem-hero__stats" id="memHeroStats">
            <div class="mem-stat"><div class="num" id="memCountStat">—</div><div class="lbl">Memories</div></div>
            <div class="mem-stat"><div class="num" id="memDaysStat">—</div><div class="lbl">Days together</div></div>
            <div class="mem-stat"><div class="num" id="memMonthStat">—</div><div class="lbl">This month</div></div>
          </div>
        </div>
        <div class="mem-hero__glow" aria-hidden="true"></div>
      </header>

      <section class="mem-on-this-day" id="memOnThisDay" hidden>
        <h3 class="mem-section-h">📅 On this day</h3>
        <div class="mem-otd-strip" id="memOtdStrip"></div>
      </section>

      <section class="mem-recap" id="memRecap">
        <div class="mem-recap__head">
          <span class="mem-recap__badge">✨ AI</span>
          <h3>This week's reel</h3>
        </div>
        <p class="mem-recap__body" id="memRecapBody">Crunching this week's memories…</p>
      </section>

      <div class="mem-toolbar">
        <div class="mem-search">
          <span class="mem-search__icon">🔍</span>
          <input id="memSearch" type="search" placeholder="Search memories…" autocomplete="off" spellcheck="false">
          <button class="mem-search__clear" id="memSearchClear" hidden>✕</button>
        </div>
        <div class="mem-view-toggle" role="tablist" aria-label="View">
          <button class="mem-view-btn active" data-view="timeline" role="tab">📜 Timeline</button>
          <button class="mem-view-btn"        data-view="photos"   role="tab">▦ Photos</button>
          <button class="mem-view-btn"        data-view="favorites" role="tab">★ Favorites</button>
        </div>
        <div class="mem-source-chips" role="tablist" aria-label="Source">
          <button class="mem-chip is-active" data-source="all">All</button>
          <button class="mem-chip" data-source="camera">📷 Camera</button>
          <button class="mem-chip" data-source="chat">💬 Chat</button>
          <button class="mem-chip" data-source="gallery">🖼 Gallery</button>
        </div>
      </div>

      <div class="mem-body" id="memBody">${skeletonList(4, "memory")}</div>

      <button class="mem-fab" id="memFab" aria-label="Add a memory" title="Add a memory">+</button>
    </section>

    <style>
      .mem-page { padding: 8px 4px 100px; max-width: 760px; margin: 0 auto; }

      /* HERO */
      .mem-hero {
        position: relative; overflow: hidden; border-radius: 28px;
        padding: 26px 22px 22px; margin-bottom: 18px;
        background: linear-gradient(135deg, rgba(255,126,182,.18), rgba(155,140,255,.22) 50%, rgba(126,215,255,.18));
        border: 1px solid rgba(255,255,255,.6);
        box-shadow: 0 14px 40px rgba(143,116,255,.18);
      }
      .mem-hero__glow {
        position: absolute; top: -40%; right: -10%;
        width: 320px; height: 320px; border-radius: 50%;
        background: radial-gradient(circle, rgba(255,126,182,.4), transparent 60%);
        filter: blur(20px); pointer-events: none;
      }
      .mem-hero__eyebrow {
        font-size: .75rem; letter-spacing: .6px; text-transform: uppercase;
        font-weight: 700; color: #7763ff; margin-bottom: 4px;
      }
      .mem-hero__title {
        font-size: 2.4rem; font-weight: 800; letter-spacing: -0.02em; margin: 0;
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .mem-hero__sub { color: #4f3d80; max-width: 38ch; margin: 6px 0 16px; font-size: .9375rem; }
      .mem-hero__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-width: 380px; }
      .mem-stat {
        background: rgba(255,255,255,.78); border: 1px solid rgba(255,255,255,.7);
        border-radius: 14px; padding: 10px 8px; text-align: center;
      }
      .mem-stat .num {
        font-size: 1.25rem; font-weight: 800; color: #1a1235;
      }
      .mem-stat .lbl { font-size: .6875rem; color: #6b5b9b; text-transform: uppercase; letter-spacing: .4px; margin-top: 2px; }

      /* SECTION HEADERS */
      .mem-section-h {
        font-size: .8125rem; letter-spacing: .5px; text-transform: uppercase;
        color: #7763ff; font-weight: 700; margin: 14px 4px 8px;
      }

      /* ON THIS DAY strip */
      .mem-on-this-day { margin-bottom: 14px; }
      .mem-otd-strip {
        display: flex; gap: 10px; overflow-x: auto; padding: 4px 4px 8px;
        scroll-snap-type: x mandatory; scrollbar-width: none;
      }
      .mem-otd-strip::-webkit-scrollbar { display: none; }
      .mem-otd-card {
        flex: 0 0 200px; scroll-snap-align: start;
        background: #fff; border: 1px solid rgba(255,255,255,.7);
        border-radius: 16px; overflow: hidden; cursor: pointer;
        box-shadow: 0 6px 18px rgba(143,116,255,.15);
        transition: transform .25s, box-shadow .25s;
      }
      .mem-otd-card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(143,116,255,.22); }
      .mem-otd-card__media {
        aspect-ratio: 1; background: linear-gradient(135deg,#ffd2e7,#d8c9ff);
        display: grid; place-items: center; font-size: 38px; color: #fff;
      }
      .mem-otd-card__media img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .mem-otd-card__body { padding: 10px 12px; }
      .mem-otd-card__title { font-weight: 700; font-size: .875rem; color: #1a1235;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mem-otd-card__date { font-size: .75rem; color: #6b5b9b; margin-top: 2px; }

      /* RECAP */
      .mem-recap {
        position: relative; overflow: hidden;
        background: linear-gradient(135deg, rgba(255,126,182,.15), rgba(155,140,255,.18));
        border: 1px solid rgba(155,140,255,.35); border-radius: 22px;
        padding: 16px 18px; margin-bottom: 14px;
        box-shadow: 0 12px 36px rgba(143,116,255,.18);
      }
      .mem-recap__head { display: flex; align-items: center; gap: 10px; }
      .mem-recap__head h3 { font-size: 1rem; font-weight: 800; margin: 0; color: #1a1235; }
      .mem-recap__badge {
        padding: 3px 10px; border-radius: 999px;
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        color: #fff; font-size: .6875rem; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
      }
      .mem-recap__body { color: #4f3d80; font-size: .9375rem; line-height: 1.5; margin: 6px 0 0; }

      /* TOOLBAR */
      .mem-toolbar {
        display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .mem-search {
        flex: 1 1 260px; min-width: 200px;
        display: flex; align-items: center; gap: 8px;
        background: rgba(255,255,255,.85); border: 1px solid rgba(155,140,255,.28);
        border-radius: 14px; padding: 0 12px; height: 42px;
      }
      .mem-search__icon { opacity: .6; font-size: 14px; }
      .mem-search input {
        flex: 1; background: transparent; border: 0; outline: 0;
        font-family: inherit; font-size: .9375rem; color: #1a1235; height: 100%;
      }
      .mem-search__clear {
        width: 26px; height: 26px; border-radius: 50%;
        background: rgba(255,255,255,.8); border: 1px solid rgba(155,140,255,.25);
        color: #6b5b9b; font-size: 12px;
      }
      .mem-view-toggle {
        display: inline-flex; background: rgba(255,255,255,.8);
        border: 1px solid rgba(155,140,255,.25); border-radius: 14px; padding: 3px;
      }
      .mem-view-btn {
        padding: 8px 14px; border-radius: 11px; font-size: .8125rem; font-weight: 600;
        background: transparent; color: #6b5b9b; cursor: pointer; font-family: inherit;
        transition: background .2s, color .2s;
      }
      .mem-view-btn.active {
        background: linear-gradient(135deg,#ff7eb6,#9b8cff); color: #fff;
        box-shadow: 0 4px 12px rgba(255,126,182,.3);
      }

      /* SOURCE FILTER CHIPS */
      .mem-source-chips {
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-top: 6px;
      }
      .mem-chip {
        padding: 4px 12px; border-radius: 999px;
        background: rgba(255,255,255,.85);
        border: 1px solid rgba(155,140,255,.2);
        color: #4f3d80; font-weight: 600; font-size: .75rem;
        font-family: inherit; cursor: pointer;
        transition: all .15s var(--ease-out, cubic-bezier(.22,1,.36,1));
      }
      .mem-chip:hover { transform: translateY(-1px); border-color: #9b8cff; }
      .mem-chip.is-active {
        background: linear-gradient(135deg, rgba(255,126,182,.18), rgba(155,140,255,.18));
        border-color: rgba(155,140,255,.5);
        color: #1a1235;
      }

      /* TIMELINE */
      .mem-month-h {
        font-size: 1rem; font-weight: 800; color: #4f3d80;
        margin: 22px 4px 10px; display: flex; align-items: center; gap: 10px;
      }
      .mem-month-h::after {
        content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(155,140,255,.35), transparent);
      }
      .mem-card {
        position: relative; overflow: hidden;
        background: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.7);
        border-radius: 22px; margin-bottom: 14px;
        box-shadow: 0 10px 32px rgba(143,116,255,.16);
        cursor: pointer;
        transition: transform .35s cubic-bezier(.22,1,.36,1), box-shadow .35s;
      }
      .mem-card:hover { transform: translateY(-2px); box-shadow: 0 18px 44px rgba(143,116,255,.24); }
      .mem-card__media {
        position: relative; aspect-ratio: 16/10; overflow: hidden;
        background: linear-gradient(135deg,#ffd2e7,#d8c9ff);
      }
      .mem-card__media img, .mem-card__media video {
        width: 100%; height: 100%; object-fit: cover; display: block;
        transition: transform .8s cubic-bezier(.22,1,.36,1);
      }
      .mem-card:hover .mem-card__media img { transform: scale(1.04); }
      .mem-card__body { padding: 14px 18px 16px; }
      .mem-card__title { font-size: 1.0625rem; font-weight: 800; color: #1a1235; }
      .mem-card__desc {
        font-size: .9375rem; color: #4f3d80; margin-top: 6px;
        line-height: 1.45; white-space: pre-line;
      }
      .mem-card__meta {
        display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px;
        font-size: .75rem; color: #6b5b9b;
      }
      .mem-card__meta span { display: inline-flex; align-items: center; gap: 4px; }
      .mem-card__del {
        position: absolute; top: 10px; right: 10px;
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(0,0,0,.45); color: #fff; border: 0;
        font-size: 13px; cursor: pointer; opacity: 0;
        transition: opacity .2s;
      }
      .mem-card:hover .mem-card__del,
      .mem-card:focus-within .mem-card__del { opacity: 1; }

      .mem-card__fav {
        position: absolute; top: 10px; left: 10px;
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(0,0,0,.45); color: rgba(255,255,255,.85);
        border: 0; font-size: 17px; line-height: 1;
        cursor: pointer; opacity: 0;
        transition: opacity .2s, transform .15s, color .15s, background .15s;
      }
      .mem-card:hover .mem-card__fav,
      .mem-card:focus-within .mem-card__fav,
      .mem-card__fav.is-fav { opacity: 1; }
      .mem-card__fav:hover { transform: scale(1.08); }
      .mem-card__fav.is-fav {
        background: linear-gradient(135deg, #ffd47a, #ff8a00);
        color: #fff;
        box-shadow: 0 4px 12px rgba(255,138,0,.45);
      }

      /* PHOTOS GRID */
      .mem-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
      }
      @media (min-width: 720px) { .mem-grid { gap: 6px; } }
      .mem-tile {
        position: relative; aspect-ratio: 1; overflow: hidden; cursor: pointer;
        background: linear-gradient(135deg,#ffd2e7,#d8c9ff);
        border-radius: 8px;
      }
      .mem-tile img { width: 100%; height: 100%; object-fit: cover; display: block;
        transition: transform .4s cubic-bezier(.22,1,.36,1); }
      .mem-tile:hover img { transform: scale(1.05); }
      .mem-tile__title-hint {
        position: absolute; inset: auto 0 0 0; padding: 8px 10px;
        background: linear-gradient(180deg, transparent, rgba(0,0,0,.6));
        color: #fff; font-size: .75rem; font-weight: 600;
        opacity: 0; transition: opacity .2s;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mem-tile:hover .mem-tile__title-hint { opacity: 1; }

      /* EMPTY STATES */
      .mem-empty {
        text-align: center; padding: 36px 20px;
        background: rgba(255,255,255,.85); border: 1px solid rgba(255,255,255,.7);
        border-radius: 20px; box-shadow: 0 10px 30px rgba(143,116,255,.12);
      }
      .mem-empty__icon { font-size: 42px; line-height: 1; }
      .mem-empty h3 { font-size: 1.0625rem; font-weight: 700; margin: 6px 0 8px; }
      .mem-empty p { color: #4f3d80; max-width: 36ch; margin: 0 auto 16px; font-size: .9375rem; }

      /* FAB */
      .mem-fab {
        position: fixed; right: 18px; bottom: 92px; z-index: 110;
        width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg,#ff7eb6,#9b8cff);
        color: #fff; border: 0; font-size: 28px; line-height: 1;
        cursor: pointer;
        box-shadow: 0 10px 30px rgba(255,126,182,.5), 0 4px 12px rgba(155,140,255,.3);
        transition: transform .25s cubic-bezier(.34,1.56,.64,1);
      }
      .mem-fab:hover { transform: scale(1.06); }
      .mem-fab:active { transform: scale(.94); }
      @media (min-width: 901px) {
        .mem-fab { bottom: 24px; right: 32px; }
      }

      /* LIGHTBOX */
      .mem-lightbox {
        position: fixed; inset: 0; z-index: 600;
        background: rgba(15, 8, 32, .8);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; animation: mlb-in .25s ease-out;
      }
      @keyframes mlb-in { from { opacity: 0; } to { opacity: 1; } }
      .mem-lightbox__panel {
        max-width: 720px; width: 100%; max-height: 90vh;
        background: #1a1235; border-radius: 24px; overflow: hidden;
        box-shadow: 0 40px 80px rgba(0,0,0,.6);
        display: flex; flex-direction: column;
      }
      .mem-lightbox__media { background: #000; aspect-ratio: 16/10; }
      .mem-lightbox__media img, .mem-lightbox__media video {
        width: 100%; height: 100%; object-fit: contain; display: block;
      }
      .mem-lightbox__body { padding: 18px 22px 24px; color: #f4ecff; overflow: auto; }
      .mem-lightbox__title { font-size: 1.25rem; font-weight: 800; margin: 0; }
      .mem-lightbox__desc { font-size: .9375rem; margin-top: 10px; line-height: 1.5; color: #d8c9ff; white-space: pre-line; }
      .mem-lightbox__meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; font-size: .8125rem; color: #c8baff; }
      .mem-lightbox__close {
        position: absolute; top: 22px; right: 22px;
        width: 38px; height: 38px; border-radius: 50%;
        background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3);
        color: #fff; font-size: 16px; cursor: pointer; z-index: 1;
      }
    </style>
  `;
}

function bind() {
  _container.querySelector("#memFab").addEventListener("click", openAddMemoryModal);
  const search = _container.querySelector("#memSearch");
  const clear  = _container.querySelector("#memSearchClear");
  search.addEventListener("input", () => {
    const v = (search.value || "").trim();
    clear.hidden = !v.length;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { _query = v.toLowerCase(); applyFilter(); }, 220);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { search.value = ""; clear.hidden = true; _query = ""; applyFilter(); }
  });
  clear.addEventListener("click", () => {
    search.value = ""; clear.hidden = true; _query = ""; applyFilter(); search.focus();
  });
  _container.querySelectorAll(".mem-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _container.querySelectorAll(".mem-view-btn").forEach((b) => b.classList.toggle("active", b === btn));
      _view = btn.dataset.view;
      paintBody();
    });
  });
  _container.querySelectorAll(".mem-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      _container.querySelectorAll(".mem-chip").forEach((c) => c.classList.toggle("is-active", c === chip));
      _sourceFilter = chip.dataset.source || "all";
      applyFilter();
    });
  });
}

// =========================================================================
// Hero stats
// =========================================================================
function paintHero(s) {
  const me = s.user;
  const partnerName = s.partner?.displayName?.split(" ")[0] || s.partner?.username || "your partner";
  const startTs = me?.togetherSince?.toMillis?.() ?? me?.matchedAt?.toMillis?.();
  const days = startTs ? Math.max(1, Math.floor((Date.now() - startTs) / 86_400_000)) : null;

  const sub = _container?.querySelector("#memHeroSub");
  if (sub) {
    sub.textContent = s.partnerId
      ? `Every photo and note here is just for you and ${partnerName}.`
      : `Pair up to start a private timeline together.`;
  }
  const daysEl = _container?.querySelector("#memDaysStat");
  if (daysEl) daysEl.textContent = days != null ? days.toString() : "—";

  const countEl = _container?.querySelector("#memCountStat");
  const monthEl = _container?.querySelector("#memMonthStat");
  if (countEl) countEl.textContent = _allMemories.length.toString();
  if (monthEl) {
    const now = new Date();
    const inThisMonth = _allMemories.filter((m) => {
      const d = mDate(m); if (!d) return false;
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    monthEl.textContent = inThisMonth.toString();
  }
}

// =========================================================================
// Filtering and rendering dispatch
// =========================================================================
function applyFilter() {
  let pool = _allMemories;
  if (_sourceFilter && _sourceFilter !== "all") {
    pool = pool.filter((m) => {
      const sk = m.sourceKind || "gallery";
      return sk === _sourceFilter;
    });
  }
  if (!_query) {
    _filteredMemories = pool;
  } else {
    const q = _query;
    _filteredMemories = pool.filter((m) => {
      const t = (m.title || "").toLowerCase();
      const d = (m.description || "").toLowerCase();
      return t.includes(q) || d.includes(q);
    });
  }
  paintBody();
  paintOnThisDay();
  paintRecap();
  paintHero(getState());
}

function paintBody() {
  const body = _container?.querySelector("#memBody");
  if (!body) return;
  if (!_filteredMemories.length) {
    body.innerHTML = _query
      ? renderEmpty("🔎", "No matches", `Nothing matches "${escapeHtml(_query)}". Try a different word.`)
      : renderEmpty("📸", "No memories yet", "Tap the + button to save your first moment together.");
    return;
  }
  if (_view === "photos")    return renderPhotosGrid(body);
  if (_view === "favorites") return renderFavorites(body);
  return renderTimeline(body);
}

// =========================================================================
// Timeline view (grouped by month)
// =========================================================================
function renderTimeline(host) {
  // Group by year-month (using date or createdAt)
  const groups = new Map();
  for (const m of _filteredMemories) {
    const d = mDate(m); if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(m);
  }
  const sortedKeys = [...groups.keys()].sort().reverse();
  host.innerHTML = sortedKeys.map((k) => {
    const g = groups.get(k);
    return `
      <h3 class="mem-month-h">${escapeHtml(g.label)}</h3>
      ${g.items.map(renderCardHTML).join("")}
    `;
  }).join("");
  wireCards(host);
}

function renderCardHTML(m) {
  const dateStr = formatDate(mDate(m));
  const isVideo = m.mediaType && /^video\//.test(m.mediaType);
  return `
    <article class="mem-card" data-id="${escapeAttr(m.id)}">
      ${m.mediaUrl ? `
        <div class="mem-card__media">
          ${isVideo
            ? `<video src="${escapeAttr(m.mediaUrl)}" preload="metadata" muted></video>`
            : `<img src="${escapeAttr(m.mediaUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`}
        </div>` : ""}
      <div class="mem-card__body">
        <div class="mem-card__title">${escapeHtml(m.title || "A moment together")}</div>
        ${m.description ? `<div class="mem-card__desc">${escapeHtml(m.description)}</div>` : ""}
        <div class="mem-card__meta">
          ${dateStr ? `<span>📅 ${escapeHtml(dateStr)}</span>` : ""}
          ${m.emotion ? `<span>${escapeHtml(m.emotion)}</span>` : ""}
        </div>
      </div>
      <button class="mem-card__del" data-act="delete" data-id="${escapeAttr(m.id)}" aria-label="Delete">🗑</button>
      <button class="mem-card__fav ${(m.favoriteByUids||[]).length ? 'is-fav':''}" data-act="favorite" data-id="${escapeAttr(m.id)}" aria-label="Favorite">${(m.favoriteByUids||[]).length ? '★' : '☆'}</button>
    </article>
  `;
}

function wireCards(host) {
  host.querySelectorAll(".mem-card").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="delete"]')) return;
      if (e.target.closest('[data-act="favorite"]')) return;
      const id = el.dataset.id;
      const m = _allMemories.find((x) => x.id === id);
      if (m) openLightbox(m);
    });
  });
  host.querySelectorAll('[data-act="favorite"]').forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const m = _allMemories.find((x) => x.id === id);
      if (!m) return;
      const myUid = getState().user?.uid;
      const isFav = (m.favoriteByUids || []).includes(myUid);
      const cid = getState().coupleId;
      // Optimistic UI flip
      b.classList.toggle("is-fav", !isFav);
      b.textContent = !isFav ? "★" : "☆";
      await safe(() => toggleFavoriteMemory(cid, id, isFav), "Couldn't update");
    });
  });
  host.querySelectorAll('[data-act="delete"]').forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const m = _allMemories.find((x) => x.id === id);
      if (!m) return;
      const s = getState();
      if (!s.coupleId) return;
      b.disabled = true;
      const ok = await safe(() => deleteMemory(s.coupleId, m), "Couldn't delete");
      if (ok !== null) toast("Memory removed");
    });
  });
}

// =========================================================================
// Photos grid
// =========================================================================
function renderPhotosGrid(host) {
  const photos = _filteredMemories.filter((m) => m.mediaUrl && (!m.mediaType || /^image\//.test(m.mediaType)));
  if (!photos.length) {
    host.innerHTML = renderEmpty("📷", "No photos yet", "Memories with photos show up here.");
    return;
  }
  host.innerHTML = `<div class="mem-grid">${
    photos.map((m) => `
      <button class="mem-tile" data-id="${escapeAttr(m.id)}" aria-label="${escapeAttr(m.title || "Memory")}">
        <img src="${escapeAttr(m.mediaUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="mem-tile__title-hint">${escapeHtml(m.title || "")}</div>
      </button>
    `).join("")
  }</div>`;
  host.querySelectorAll(".mem-tile").forEach((t) => {
    t.addEventListener("click", () => {
      const m = _allMemories.find((x) => x.id === t.dataset.id);
      if (m) openLightbox(m);
    });
  });
}

// =========================================================================
// On-this-day strip
// =========================================================================
function paintOnThisDay() {
  const now = new Date();
  const today = { m: now.getMonth(), d: now.getDate() };
  const matches = _allMemories.filter((m) => {
    const d = mDate(m); if (!d) return false;
    return d.getMonth() === today.m && d.getDate() === today.d
        && d.getFullYear() !== now.getFullYear();      // exclude items added today
  });
  const wrap = _container?.querySelector("#memOnThisDay");
  if (!wrap) return;
  if (!matches.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const strip = wrap.querySelector("#memOtdStrip");
  strip.innerHTML = matches.map((m) => {
    const d = mDate(m);
    const yearsAgo = now.getFullYear() - d.getFullYear();
    const yearsLabel = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
    const isImage = !m.mediaType || /^image\//.test(m.mediaType);
    return `
      <button class="mem-otd-card" data-id="${escapeAttr(m.id)}">
        <div class="mem-otd-card__media">
          ${m.mediaUrl
            ? (isImage
                ? `<img src="${escapeAttr(m.mediaUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
                : `📹`)
            : "💜"}
        </div>
        <div class="mem-otd-card__body">
          <div class="mem-otd-card__title">${escapeHtml(m.title || "A moment")}</div>
          <div class="mem-otd-card__date">${escapeHtml(yearsLabel)}</div>
        </div>
      </button>
    `;
  }).join("");
  strip.querySelectorAll(".mem-otd-card").forEach((c) => {
    c.addEventListener("click", () => {
      const m = _allMemories.find((x) => x.id === c.dataset.id);
      if (m) openLightbox(m);
    });
  });
}

// =========================================================================
// AI weekly recap (heuristic)
// =========================================================================
function paintRecap() {
  const body = _container?.querySelector("#memRecapBody");
  if (!body) return;
  const total = _allMemories.length;
  const now = Date.now();
  const weekAgo = now - 7 * 86_400_000;
  const thisWeek = _allMemories.filter((m) => {
    const t = m.createdAt?.toMillis?.() ?? +new Date(m.date || 0);
    return t && t >= weekAgo;
  });
  const photos = thisWeek.filter((m) => m.mediaUrl && (!m.mediaType || /^image\//.test(m.mediaType))).length;
  const videos = thisWeek.filter((m) => m.mediaType && /^video\//.test(m.mediaType)).length;

  const lines = [];
  if (thisWeek.length === 0)      lines.push("No new memories this week. A simple snapshot today would be a sweet anchor for next month's recap.");
  else if (thisWeek.length === 1) lines.push("One new memory this week. Small but real.");
  else                            lines.push(`${thisWeek.length} new memories this week.`);
  if (photos > 0) lines.push(`${photos} photo${photos === 1 ? "" : "s"}${videos > 0 ? `, ${videos} video${videos === 1 ? "" : "s"}` : ""}.`);
  if (total >= 50)      lines.push(`${total} memories saved together — that's a real archive forming.`);
  else if (total >= 10) lines.push(`${total} total memories so far.`);

  body.innerHTML = lines.map((l) => `<span>${escapeHtml(l)}</span>`).join("  ");
}

// =========================================================================
// Lightbox
// =========================================================================
function openLightbox(m) {
  const wrap = document.createElement("div");
  wrap.className = "mem-lightbox";
  const isImage = !m.mediaType || /^image\//.test(m.mediaType);
  const dateStr = formatDate(mDate(m));
  wrap.innerHTML = `
    <button class="mem-lightbox__close" aria-label="Close">✕</button>
    <div class="mem-lightbox__panel">
      ${m.mediaUrl ? `
        <div class="mem-lightbox__media">
          ${isImage
            ? `<img src="${escapeAttr(m.mediaUrl)}" alt="" referrerpolicy="no-referrer">`
            : `<video src="${escapeAttr(m.mediaUrl)}" controls preload="metadata"></video>`}
        </div>` : ""}
      <div class="mem-lightbox__body">
        <h3 class="mem-lightbox__title">${escapeHtml(m.title || "A moment together")}</h3>
        ${m.description ? `<p class="mem-lightbox__desc">${escapeHtml(m.description)}</p>` : ""}
        <div class="mem-lightbox__meta">
          ${dateStr ? `<span>📅 ${escapeHtml(dateStr)}</span>` : ""}
          ${m.emotion ? `<span>${escapeHtml(m.emotion)}</span>` : ""}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.querySelector(".mem-lightbox__close").addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
}

// =========================================================================
// Add memory modal — same flow as moments.js
// =========================================================================
function openAddMemoryModal() {
  const s = getState();
  if (!s.partnerId) return toastWarn("Connect with your partner first");

  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="Add memory">
      <div class="bond-modal__head">Add a memory 💜</div>
      <div class="bond-modal__body">
        <label class="bond-field"><span>Title</span>
          <input id="memTitle" type="text" maxlength="120" placeholder="What happened?"></label>
        <label class="bond-field"><span>Description (optional)</span>
          <textarea id="memDesc" rows="3" maxlength="500" placeholder="A line or two…"></textarea></label>
        <label class="bond-field"><span>Photo / video (optional)</span>
          <input id="memFile" type="file" accept="image/*,video/*"></label>
        <div class="mem-progress" id="memProgress" hidden>
          <div class="mem-progress__bar"><div class="mem-progress__fill" id="memProgressFill"></div></div>
          <div class="mem-progress__label" id="memProgressLabel">Uploading…</div>
        </div>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">Save memory</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector("#memTitle").focus();

  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const title = wrap.querySelector("#memTitle").value.trim();
    const desc  = wrap.querySelector("#memDesc").value.trim();
    const file  = wrap.querySelector("#memFile").files?.[0] || null;
    if (!title) { toastWarn("Add a title"); return; }
    if (file && file.size > 15 * 1024 * 1024) { toastError("Max 15 MB"); return; }
    wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const prog = wrap.querySelector("#memProgress");
    const fill = wrap.querySelector("#memProgressFill");
    const lbl  = wrap.querySelector("#memProgressLabel");
    if (file) prog.hidden = false;
    try {
      await addMemory({
        coupleId: getState().coupleId,
        title, description: desc, file,
        onProgress: (p) => {
          fill.style.width = `${Math.round(p * 100)}%`;
          lbl.textContent  = p < 0.99 ? `Uploading ${Math.round(p * 100)}%` : "Finishing…";
        }
      });
      toastSuccess("Memory saved 💜");
      close();
    } catch (e) {
      console.warn("[memories] addMemory failed", e);
      toastError(e?.message === "FILE_TOO_LARGE" ? "Max 15 MB" : "Couldn't save memory");
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  });
}

// =========================================================================
// Empty / unpaired
// =========================================================================
function renderEmpty(icon, title, sub) {
  return `
    <div class="mem-empty">
      <div class="mem-empty__icon">${escapeHtml(icon)}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(sub)}</p>
    </div>
  `;
}
function renderUnpaired() {
  const body = _container?.querySelector("#memBody");
  if (!body) return;
  body.innerHTML = `
    <div class="mem-empty">
      <div class="mem-empty__icon">💜</div>
      <h3>Pair up to start your timeline</h3>
      <p>Memories are for the two of you — connect with your partner first.</p>
      <button class="btn btn-primary" id="memCtaBond">Find your partner</button>
    </div>
  `;
  body.querySelector("#memCtaBond")?.addEventListener("click", () => window.loadPage?.("bond"));
}

// =========================================================================
// helpers
// =========================================================================
function mDate(m) {
  const d = m.createdAt?.toDate?.() || (m.date ? new Date(m.date) : null);
  return d && !isNaN(+d) ? d : null;
}
function formatDate(d) {
  if (!d) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }



// =====================================================================
// Favorites view — only memories favorited by either partner.
// =====================================================================
function renderFavorites(host) {
  const favs = (_filteredMemories || _allMemories).filter((m) =>
    Array.isArray(m.favoriteByUids) && m.favoriteByUids.length > 0
  );
  if (!favs.length) {
    host.innerHTML = renderEmpty("★", "No favorites yet",
      "Tap the ☆ on any memory card to keep it close.");
    return;
  }
  host.innerHTML = `<div class="mem-timeline">
    ${favs.map((m) => renderCard(m)).join("")}
  </div>`;
  wireCards(host);
}
