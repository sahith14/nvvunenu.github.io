// modules/timeCapsule.js — Time-capsule letters.
// Write a letter to your partner, set an unlock date, the letter is
// hidden in plain sight until that date. On unlock day it surfaces.
//
// Storage: bonds/{coupleId}/timecapsule/{id}
//   { from, to, title, body, createdAt, unlockAt(Timestamp), opened (bool) }
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState, getState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";

let _container = null;
let _offState  = null;
let _unsub     = null;
let _state     = null;
let _items     = [];

export function renderTimeCapsule(container) {
  _container = container;
  _container.innerHTML = `<div class="tc-loading">${skeletonList(3, "card")}</div>`;

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
  _state = null; _items = []; _container = null;
}

function attachSubscription(coupleId) {
  const q = query(collection(db, "bonds", coupleId, "timecapsule"), orderBy("unlockAt", "asc"));
  _unsub = onSnapshot(q, (snap) => {
    _items = [];
    snap.forEach((d) => _items.push({ id: d.id, ...d.data() }));
    paint();
  });
}

// =====================================================================
// Render
// =====================================================================
function paint() {
  if (!_container || !_state) return;
  const myUid = _state.user?.uid;
  const partnerName = _state.partner?.displayName?.split(" ")[0] || _state.partner?.username || "your partner";

  const now = Date.now();
  const unlocked = [];
  const locked   = [];
  for (const it of _items) {
    const ts = it.unlockAt?.toMillis?.() || it.unlockAt?.seconds * 1000 || 0;
    if (ts <= now) unlocked.push({ ...it, unlockMs: ts });
    else           locked.push({ ...it, unlockMs: ts });
  }
  // Sort unlocked: most-recently-unlocked first
  unlocked.sort((a, b) => b.unlockMs - a.unlockMs);

  _container.innerHTML = `
    <div class="tc-page stagger">
      <header class="tc-hero">
        <div class="tc-hero__icon">📜</div>
        <h2 class="tc-hero__title">Time Capsule Letters</h2>
        <p class="tc-hero__sub">Write something to ${escapeHtml(partnerName)}. Lock it until a date. It opens on its own — sealed wax, slow love.</p>
        <button class="btn btn-primary tc-hero__btn" id="tcWriteBtn">+ Write a new letter</button>
      </header>

      <section class="tc-section">
        <h3 class="tc-h">
          <span class="tc-h__chip is-open">Open</span>
          <span class="tc-h__count">${unlocked.length}</span>
        </h3>
        <div class="tc-list">
          ${unlocked.length === 0
            ? `<div class="tc-empty">No letters have unlocked yet — when one does, it'll appear here glowing.</div>`
            : unlocked.map((it) => unlockedCard(it, myUid)).join("")
          }
        </div>
      </section>

      <section class="tc-section">
        <h3 class="tc-h">
          <span class="tc-h__chip is-locked">Sealed</span>
          <span class="tc-h__count">${locked.length}</span>
        </h3>
        <div class="tc-list">
          ${locked.length === 0
            ? `<div class="tc-empty">Nothing sealed yet. Tap "Write a new letter" to start one.</div>`
            : locked.map((it) => lockedCard(it, myUid)).join("")
          }
        </div>
      </section>

      <p class="tc-hint">Letters are visible to both of you. The body is hidden until the unlock date — even from the writer.</p>
    </div>
  `;

  bind(myUid);
}

function lockedCard(it, myUid) {
  const ts = it.unlockMs;
  const days = Math.max(0, Math.ceil((ts - Date.now()) / 86400000));
  const author = it.from === myUid ? "You" : "Your partner";
  const dateStr = new Date(ts).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  return `
    <article class="tc-card tc-card--locked" data-id="${escapeHtml(it.id)}">
      <div class="tc-card__seal">📜</div>
      <div class="tc-card__body">
        <div class="tc-card__title">${escapeHtml(it.title || "Untitled letter")}</div>
        <div class="tc-card__meta">From ${escapeHtml(author)} · unlocks <strong>${escapeHtml(dateStr)}</strong></div>
        <div class="tc-card__count">${days} day${days === 1 ? "" : "s"} left</div>
      </div>
      ${it.from === myUid ? `<button class="tc-card__del" data-act="del" title="Discard">✕</button>` : ""}
    </article>`;
}

function unlockedCard(it, myUid) {
  const ts = it.unlockMs;
  const author = it.from === myUid ? "You" : "Your partner";
  const dateStr = new Date(ts).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  return `
    <article class="tc-card tc-card--open ${it.opened ? "is-read" : "is-fresh"}" data-id="${escapeHtml(it.id)}">
      <div class="tc-card__seal">💌</div>
      <div class="tc-card__body">
        <div class="tc-card__title">${escapeHtml(it.title || "Untitled letter")}</div>
        <div class="tc-card__meta">From ${escapeHtml(author)} · unlocked ${escapeHtml(dateStr)}</div>
        <div class="tc-card__preview">${escapeHtml((it.body || "").slice(0, 110))}${(it.body || "").length > 110 ? "…" : ""}</div>
      </div>
      <button class="tc-card__open" data-act="open">Open</button>
    </article>`;
}

function renderUnpaired() {
  return `
    <div class="tc-unpaired">
      <div class="tc-unpaired__icon">📜</div>
      <h3>Pair up to start a time capsule</h3>
      <p>Both of you need to be connected so we can hold the letters safely on either side.</p>
      <button class="btn btn-primary" onclick="window.loadPage?.('bond')">Connect partner</button>
    </div>
  `;
}

// =====================================================================
// Bind events
// =====================================================================
function bind(myUid) {
  _container.querySelector("#tcWriteBtn")?.addEventListener("click", () => openComposer(myUid));
  _container.querySelectorAll(".tc-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-act="del"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete(id);
    });
    card.querySelector('[data-act="open"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      const it = _items.find((x) => x.id === id);
      if (it) openLetter(it, myUid);
    });
    // Tapping a sealed card shows a teaser; tapping unlocked card opens.
    card.addEventListener("click", () => {
      const it = _items.find((x) => x.id === id);
      if (!it) return;
      const isLocked = (it.unlockAt?.toMillis?.() || it.unlockAt?.seconds * 1000 || 0) > Date.now();
      if (isLocked) toast(`Sealed until ${new Date(it.unlockAt.toMillis()).toLocaleDateString()}`);
      else openLetter(it, myUid);
    });
  });
}

// =====================================================================
// Compose
// =====================================================================
function openComposer(myUid) {
  const s = _state;
  const partnerId = s.partnerId;
  if (!partnerId) { toastWarn("Connect with your partner first"); return; }

  const tomorrow = new Date(Date.now() + 86400000);
  const min = todayInputValue();
  const def = oneMonthFromNow();

  openModal({
    title: "Write a new letter",
    body: `
      <label class="tc-field">
        <span>Title (optional)</span>
        <input id="tcTitle" type="text" maxlength="80" placeholder="A note for our anniversary" autocomplete="off">
      </label>
      <label class="tc-field">
        <span>Letter</span>
        <textarea id="tcBody" rows="7" maxlength="2000" placeholder="Be honest. Be soft. Be you."></textarea>
      </label>
      <label class="tc-field">
        <span>Unlock date</span>
        <input id="tcDate" type="date" min="${min}" value="${def}">
      </label>
      <p class="tc-fineprint">After saving, the body is hidden from both of you until ${escapeHtml("the unlock date")}.</p>
    `,
    primary: "Seal it 📜",
    onSubmit: async (modalEl) => {
      const title = modalEl.querySelector("#tcTitle").value.trim();
      const body  = modalEl.querySelector("#tcBody").value.trim();
      const date  = modalEl.querySelector("#tcDate").value;
      if (!body) { toastWarn("Write something first"); return false; }
      if (!date) { toastWarn("Pick an unlock date"); return false; }
      const unlockMs = new Date(date + "T00:00:00").getTime();
      if (!Number.isFinite(unlockMs) || unlockMs < Date.now()) {
        toastWarn("Pick a future date"); return false;
      }
      const ok = await safe(() => addDoc(
        collection(db, "bonds", s.coupleId, "timecapsule"),
        {
          from: myUid,
          to:   partnerId,
          title: title || null,
          body,
          unlockAt: Timestamp.fromMillis(unlockMs),
          createdAt: serverTimestamp(),
          opened: false
        }
      ), "Couldn't save letter");
      if (ok !== false) toastSuccess("Letter sealed 📜");
    }
  });
}

// =====================================================================
// Open letter (full read)
// =====================================================================
function openLetter(it, myUid) {
  const author = it.from === myUid ? "You" : (_state.partner?.displayName?.split(" ")[0] || "Your partner");
  const ts = it.unlockMs ?? (it.unlockAt?.toMillis?.() || 0);
  const dateStr = new Date(ts).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  openModal({
    title: it.title || "Letter",
    body: `
      <div class="tc-letter">
        <div class="tc-letter__from">From ${escapeHtml(author)} · sealed for ${escapeHtml(dateStr)}</div>
        <div class="tc-letter__body">${escapeHtml(it.body || "").replace(/\n/g, "<br>")}</div>
      </div>
    `,
    primary: "Close",
    onSubmit: () => true,
  });
  // Mark as opened the first time we view it
  if (!it.opened) {
    safe(() => updateDoc(
      doc(db, "bonds", _state.coupleId, "timecapsule", it.id),
      { opened: true, openedAt: serverTimestamp() }
    ), null);
  }
}

// =====================================================================
// Discard (only the author can delete a sealed letter)
// =====================================================================
function onDelete(id) {
  openModal({
    title: "Discard this letter?",
    body: `<p>This will remove the sealed letter for both of you. There's no undo.</p>`,
    primary: "Discard",
    danger: true,
    onSubmit: async () => {
      const ok = await safe(() =>
        deleteDoc(doc(db, "bonds", _state.coupleId, "timecapsule", id)),
        "Couldn't discard"
      );
      if (ok !== false) toast("Letter discarded");
    }
  });
}

// =====================================================================
// Local helpers
// =====================================================================
function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function oneMonthFromNow() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// =====================================================================
// Reusable modal — object-shape (title, body, primary, danger, onSubmit)
// =====================================================================
function openModal({ title, body, primary, danger, onSubmit }) {
  const wrap = document.createElement("div");
  wrap.className = "tc-modal";
  wrap.innerHTML = `
    <div class="tc-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="tc-modal__head">${escapeHtml(title)}</div>
      <div class="tc-modal__body">${body}</div>
      <div class="tc-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${escapeHtml(primary)}</button>
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
    const handled = await Promise.resolve(onSubmit ? onSubmit(wrap) : true);
    okBtn.disabled = false;
    if (handled !== false) close();
  });
  const firstInput = wrap.querySelector("input, textarea");
  if (firstInput) firstInput.focus();
}
