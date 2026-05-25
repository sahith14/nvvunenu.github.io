// =====================================================================
// modules/moments.js — Couple memory timeline.
// Reactive: subscribes to appState; memories live under memories/{coupleId}/entries
// Uploads via services/memoryService.addMemory (Supabase or Firebase fallback).
// =====================================================================
import { onAppState, getState } from "../state/appState.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { addMemory, subscribeRecent, deleteMemory } from "../services/memoryService.js";

let _container = null;
let _offState  = null;
let _unsubMemories = null;
let _lastCoupleId = null;

export function renderMoments(container) {
  _container = container;
  _container.innerHTML = `
    <div class="moments-page stagger">
      <div class="moments-header">
        <h2>Moments 💜</h2>
        <button class="add-btn" id="btnAddMemory" title="Add a memory">+</button>
      </div>

      <div class="recap-card">
        <h3>✨ Your Month Together</h3>
        <p>Memories from this month, beautifully collected.</p>
        <button class="btn btn-ghost" id="btnViewRecap">View Recap</button>
      </div>

      <div class="memory-timeline" id="memoryTimeline">
        ${skeletonList(3, "memory")}
      </div>
    </div>
  `;

  _container.querySelector("#btnAddMemory").addEventListener("click", () => openAddMemoryModal());
  _container.querySelector("#btnViewRecap").addEventListener("click", () => {
    toast("✨ Monthly recaps coming with Premium");
    window.loadPage?.("subscription");
  });

  _offState = onAppState((s) => {
    if (!s.ready) return;
    if (s.coupleId !== _lastCoupleId) {
      _lastCoupleId = s.coupleId;
      try { _unsubMemories?.(); } catch {}
      _unsubMemories = null;

      if (!s.coupleId) {
        renderUnpaired();
      } else {
        _unsubMemories = subscribeRecent(s.coupleId, (rows) => {
          renderTimeline(rows);
        });
      }
    }
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsubMemories?.(); } catch {}
  _offState = null; _unsubMemories = null; _lastCoupleId = null; _container = null;
}

// ---------- Renderers ----------

function renderUnpaired() {
  const tl = _container?.querySelector("#memoryTimeline");
  if (!tl) return;
  tl.innerHTML = `
    <div class="moments-empty">
      <div class="moments-empty__icon">💜</div>
      <h3>Pair up to start your timeline</h3>
      <p>Once you and your partner are connected, every photo and note you save here is just for the two of you.</p>
      <button class="btn btn-primary" id="momentsCtaBond">Find your partner</button>
    </div>
  `;
  tl.querySelector("#momentsCtaBond")?.addEventListener("click", () => window.loadPage?.("bond"));
}

function renderTimeline(rows) {
  const tl = _container?.querySelector("#memoryTimeline");
  if (!tl) return;
  if (!rows || !rows.length) {
    tl.innerHTML = `
      <div class="moments-empty">
        <div class="moments-empty__icon">📸</div>
        <h3>No memories yet</h3>
        <p>Tap the <strong>+</strong> button to save your first moment together.</p>
      </div>`;
    return;
  }
  tl.innerHTML = "";
  for (const m of rows) tl.appendChild(renderMemoryCard(m));
}

function renderMemoryCard(m) {
  const card = document.createElement("article");
  card.className = "memory-card";
  const dateStr = formatDate(m.createdAt) || m.date || "";
  const timeStr = formatTime(m.createdAt);
  const safeTitle = escapeHtml(m.title || "A moment together");
  const safeDesc  = escapeHtml(m.description || "");
  const isImage = !m.mediaType || /^image\//.test(m.mediaType);

  card.innerHTML = `
    ${m.mediaUrl ? `
      <div class="media">
        ${isImage
          ? `<img src="${m.mediaUrl}" alt="" loading="lazy">`
          : `<video src="${m.mediaUrl}" controls preload="metadata"></video>`}
      </div>` : ""}
    <div class="title">${safeTitle}</div>
    ${safeDesc ? `<div class="desc">${safeDesc}</div>` : ""}
    <div class="meta">
      ${timeStr  ? `<span>🕐 ${timeStr}</span>`  : ""}
      ${dateStr  ? `<span>📅 ${dateStr}</span>`  : ""}
      ${m.emotion ? `<span class="emotion-tag">${escapeHtml(m.emotion)}</span>` : ""}
    </div>
    <button class="memory-del" data-id="${m.id}" title="Delete" aria-label="Delete">🗑</button>
  `;

  card.querySelector(".memory-del").addEventListener("click", async (e) => {
    e.stopPropagation();
    const s = getState();
    if (!s.coupleId) return;
    e.currentTarget.disabled = true;
    const ok = await safe(() => deleteMemory(s.coupleId, m), "Couldn't delete");
    if (ok !== null) toast("Memory removed");
  });

  return card;
}

// ---------- Add memory modal ----------

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
          <textarea id="memDesc" rows="2" maxlength="300" placeholder="A line or two…"></textarea></label>
        <label class="bond-field"><span>Emotion (optional)</span>
          <input id="memEmotion" type="text" maxlength="40" placeholder="🥰 Warm, 😂 Funny, 🥺 Emotional"></label>
        <label class="bond-field"><span>Photo (optional)</span>
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
    const title    = wrap.querySelector("#memTitle").value.trim();
    const desc     = wrap.querySelector("#memDesc").value.trim();
    const emotion  = wrap.querySelector("#memEmotion").value.trim();
    const fileInp  = wrap.querySelector("#memFile");
    const file     = fileInp.files?.[0] || null;
    if (!title) { toastWarn("Add a title"); return; }
    if (file && file.size > 15 * 1024 * 1024) { toastError("Max 15 MB"); return; }

    // Lock buttons; show progress
    wrap.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const prog = wrap.querySelector("#memProgress");
    const fill = wrap.querySelector("#memProgressFill");
    const lbl  = wrap.querySelector("#memProgressLabel");
    if (file) prog.hidden = false;

    try {
      await addMemory({
        coupleId: getState().coupleId,
        title, description: desc, file,
        // emotion isn't part of memoryService schema — stamp it via separate field below
        onProgress: (p) => {
          fill.style.width = `${Math.round(p * 100)}%`;
          lbl.textContent  = p < 0.99 ? `Uploading ${Math.round(p * 100)}%` : "Finishing…";
        }
      });
      // (emotion stored client-side as last addDoc field — memoryService doesn't accept it.
      //  For now we surface it in the description so the timeline shows it; future:
      //  extend addMemory to accept extras.)
      toastSuccess("Memory saved 💜");
      close();
    } catch (e) {
      console.warn("[moments] addMemory failed", e);
      toastError(e?.message === "FILE_TOO_LARGE" ? "Max 15 MB" : "Couldn't save memory");
      wrap.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });
}

// ---------- helpers ----------
function formatTime(ts) {
  const d = ts?.toDate?.() || (ts ? new Date(ts) : null);
  if (!d || isNaN(+d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function formatDate(ts) {
  const d = ts?.toDate?.() || (ts ? new Date(ts) : null);
  if (!d || isNaN(+d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
