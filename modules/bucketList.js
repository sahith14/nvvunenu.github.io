// modules/bucketList.js — Shared bucket list of dreams to do together.
// Storage:
//   bonds/{coupleId}/bucket/{itemId}
//     { text, icon, addedBy, addedAt, doneAt, doneCaption }
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, doc, addDoc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAppState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";

let _container = null;
let _offState  = null;
let _unsub     = null;
let _state     = null;
let _items     = [];

// Pre-loaded suggestions to inspire
const STARTER_SUGGESTIONS = [
  { icon: "✈️", text: "Take a trip just the two of us" },
  { icon: "🏔",  text: "Watch a sunrise from a mountain" },
  { icon: "🌊", text: "Swim in the ocean at midnight" },
  { icon: "🎭", text: "See a play together" },
  { icon: "🍝", text: "Cook every cuisine on a list" },
  { icon: "📚", text: "Read the same book at the same time" },
  { icon: "🎵", text: "Go to a concert of a band we both love" },
  { icon: "🚂", text: "Take a long train journey" },
  { icon: "🏠", text: "Build a home together" },
  { icon: "🌸", text: "See cherry blossoms in spring" },
];

// =====================================================================
// Render
// =====================================================================
export function renderBucketList(container) {
  _container = container;
  _container.innerHTML = `<div class="bk-loading">${skeletonList(3, "card")}</div>`;

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
  const q = query(collection(db, "bonds", coupleId, "bucket"), orderBy("addedAt", "desc"));
  _unsub = onSnapshot(q, (snap) => {
    _items = [];
    snap.forEach((d) => _items.push({ id: d.id, ...d.data() }));
    paint();
  });
}

function paint() {
  if (!_container || !_state) return;
  const myUid = _state.user?.uid;

  const todo = _items.filter((it) => !it.doneAt);
  const done = _items.filter((it) =>  it.doneAt);

  _container.innerHTML = `
    <div class="bk-page stagger">
      <header class="bk-hero">
        <div class="bk-hero__icon">🪄</div>
        <h2 class="bk-hero__title">Our bucket list</h2>
        <p class="bk-hero__sub">Everything we want to do together. Add a dream, mark it done, write a tiny note about how it felt.</p>
        <div class="bk-hero__stats">
          <div class="bk-hero__stat">
            <div class="bk-hero__num">${_items.length}</div>
            <div class="bk-hero__lbl">total dreams</div>
          </div>
          <div class="bk-hero__stat">
            <div class="bk-hero__num">${done.length}</div>
            <div class="bk-hero__lbl">checked off</div>
          </div>
        </div>
        <button class="btn btn-primary bk-hero__btn" id="bkAddBtn">+ Add a dream</button>
      </header>

      <section class="bk-section">
        <h3 class="bk-h">
          <span>To do</span>
          <span class="bk-h__count">${todo.length}</span>
        </h3>
        <div class="bk-list">
          ${todo.length === 0
            ? renderTodoEmpty()
            : todo.map((it) => itemCard(it, myUid, false)).join("")
          }
        </div>
      </section>

      ${done.length ? `
        <section class="bk-section">
          <h3 class="bk-h">
            <span>Done</span>
            <span class="bk-h__count">${done.length}</span>
          </h3>
          <div class="bk-list">
            ${done.map((it) => itemCard(it, myUid, true)).join("")}
          </div>
        </section>
      ` : ""}

      <p class="bk-hint">Either of you can add or check off items. Mark something done to write a tiny memory of how it felt.</p>
    </div>
  `;

  bind();
}

function itemCard(it, myUid, isDone) {
  const author = it.addedBy === myUid ? "You added" : "They added";
  const doneStr = it.doneAt
    ? `Done ${friendlyDate(it.doneAt?.toDate?.() || new Date(it.doneAt))}`
    : "";
  return `
    <article class="bk-card ${isDone ? "is-done" : ""}" data-id="${escapeHtml(it.id)}">
      <button class="bk-card__check" data-act="toggle" title="${isDone ? "Mark not-done" : "Mark done"}" aria-label="Toggle done">
        ${isDone ? "✓" : ""}
      </button>
      <div class="bk-card__body">
        <div class="bk-card__title">
          <span class="bk-card__icon">${it.icon || "✨"}</span>
          <span class="bk-card__text">${escapeHtml(it.text || "")}</span>
        </div>
        <div class="bk-card__meta">${escapeHtml(author)}${isDone ? ` · ${escapeHtml(doneStr)}` : ""}</div>
        ${it.doneCaption
          ? `<div class="bk-card__caption">"${escapeHtml(it.doneCaption)}"</div>`
          : ""
        }
      </div>
      <button class="bk-card__del" data-act="del" title="Remove" aria-label="Remove">✕</button>
    </article>`;
}

function renderTodoEmpty() {
  return `
    <div class="bk-empty">
      <p>No dreams yet — start with one of these:</p>
      <div class="bk-suggest">
        ${STARTER_SUGGESTIONS.map(s => `
          <button class="bk-suggest__btn" data-suggest="${escapeAttr(JSON.stringify(s))}">
            <span>${s.icon}</span>
            <span>${escapeHtml(s.text)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderUnpaired() {
  return `
    <div class="bk-unpaired">
      <div class="bk-unpaired__icon">🪄</div>
      <h3>Pair up to start your bucket list</h3>
      <p>Bucket lists work better with two — add dreams either of you wants to do together.</p>
      <button class="btn btn-primary" onclick="window.loadPage?.('bond')">Connect partner</button>
    </div>
  `;
}

// =====================================================================
// Bind
// =====================================================================
function bind() {
  _container.querySelector("#bkAddBtn")?.addEventListener("click", () => openAddModal());
  // Suggestion shortcuts
  _container.querySelectorAll('.bk-suggest__btn').forEach((b) => {
    b.addEventListener('click', () => {
      try {
        const s = JSON.parse(b.dataset.suggest);
        addItem(s.icon, s.text);
      } catch {}
    });
  });
  // Card actions
  _container.querySelectorAll('.bk-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('[data-act="toggle"]')?.addEventListener('click', (e) => {
      e.stopPropagation(); toggleDone(id);
    });
    card.querySelector('[data-act="del"]')?.addEventListener('click', (e) => {
      e.stopPropagation(); confirmDelete(id);
    });
  });
}

// =====================================================================
// Actions
// =====================================================================
async function addItem(icon, text) {
  if (!_state.coupleId || !_state.user?.uid) return;
  if (!text?.trim()) { toastWarn("Type something first"); return; }
  const ok = await safe(() => addDoc(collection(db, "bonds", _state.coupleId, "bucket"), {
    icon: icon || "✨",
    text: text.trim(),
    addedBy: _state.user.uid,
    addedAt: serverTimestamp(),
    doneAt: null,
  }), "Couldn't add");
  if (ok !== false) toastSuccess("Added 💜");
}

async function toggleDone(id) {
  const it = _items.find((x) => x.id === id);
  if (!it) return;
  const ref = doc(db, "bonds", _state.coupleId, "bucket", id);
  if (it.doneAt) {
    // Un-done — clear timestamps
    await safe(() => setDoc(ref, { doneAt: null, doneCaption: null }, { merge: true }), null);
    toast("Marked not-done");
  } else {
    // Done — show a small caption modal
    openCaptionModal(id, it);
  }
}

function openCaptionModal(id, it) {
  openModal({
    title: "How did it feel?",
    body: `
      <p class="bk-prompt">${escapeHtml(it.icon || "✨")} ${escapeHtml(it.text)}</p>
      <textarea id="bkCaption" rows="4" maxlength="280" placeholder="A line or two about the moment (optional)"></textarea>
    `,
    primary: "Mark done",
    onSubmit: async (modalEl) => {
      const caption = modalEl.querySelector("#bkCaption").value.trim();
      const ref = doc(db, "bonds", _state.coupleId, "bucket", id);
      await safe(() => setDoc(ref, {
        doneAt: serverTimestamp(),
        doneCaption: caption || null,
      }, { merge: true }), "Couldn't update");
      toastSuccess("Checked off ✨");
    }
  });
}

function confirmDelete(id) {
  openModal({
    title: "Remove this dream?",
    body: `<p>It will disappear for both of you. There's no undo.</p>`,
    primary: "Remove",
    danger: true,
    onSubmit: async () => {
      await safe(() => deleteDoc(doc(db, "bonds", _state.coupleId, "bucket", id)), "Couldn't remove");
      toast("Removed");
    }
  });
}

function openAddModal() {
  openModal({
    title: "Add a dream",
    body: `
      <label class="bk-field">
        <span>Emoji</span>
        <input id="bkIcon" type="text" maxlength="2" placeholder="✨" value="✨">
      </label>
      <label class="bk-field">
        <span>What do you want to do?</span>
        <input id="bkText" type="text" maxlength="120" placeholder="Hike under the northern lights">
      </label>
    `,
    primary: "Add",
    onSubmit: async (modalEl) => {
      const icon = modalEl.querySelector("#bkIcon").value.trim() || "✨";
      const text = modalEl.querySelector("#bkText").value.trim();
      if (!text) { toastWarn("Type something first"); return false; }
      await addItem(icon, text);
    }
  });
}

// =====================================================================
// Helpers
// =====================================================================
function friendlyDate(d) {
  try { return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Reusable object-shape modal (matches timeCapsule.js's local helper)
function openModal({ title, body, primary, danger, onSubmit }) {
  const wrap = document.createElement("div");
  wrap.className = "tc-modal";   // reuse the time-capsule modal style
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
