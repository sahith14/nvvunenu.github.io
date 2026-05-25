// =====================================================================
// modules/bond.js — Couple pairing hub + relationship health.
// States:
//   loading           → skeletons (waiting for appState)
//   incoming-request  → "Accept / Reject" decision card
//   pending           → "Waiting for response" card
//   unpaired          → invite code, paste code, username search
//   paired            → relationship pulse, languages, goals, countdowns
// Reacts live: when appState flips partnerId, the page re-paints itself.
// =====================================================================
import { auth, db } from "../firebase.js";
import { onAppState, getState } from "../state/appState.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, toastSuccess, toastError, toastWarn, safe } from "../utils/toast.js";
import {
  lookupByInviteCode, searchUsersByUsername,
  sendRequest, acceptRequest, rejectRequest,
  pairWithInviteCode, unpair, getUser
} from "../services/partnerService.js";
import {
  doc, getDoc, addDoc, collection, query, orderBy, limit, getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let _container = null;
let _offState  = null;
let _searchDebounce = null;
let _lastRenderedKey = null;

export function renderBond(container) {
  _container = container;
  _container.innerHTML = `<div class="bond-loading">${skeletonList(3, "card")}</div>`;

  // Re-paint whenever appState changes shape (paired ↔ unpaired, request in/out, etc.)
  _offState = onAppState((s) => {
    if (!s.ready) return;
    paintForState(s);
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  _offState = null;
  clearTimeout(_searchDebounce);
  _searchDebounce = null;
  _container = null;
  _lastRenderedKey = null;
}

// ----- Paint dispatch -----
function paintForState(s) {
  const u = s.user || {};
  const partnerId = s.partnerId || null;
  const incoming  = u.partnerRequestFrom && !partnerId;
  const pending   = u.partnerRequestTo   && !partnerId && !incoming;

  let key;
  if (partnerId)      key = `paired:${partnerId}`;
  else if (incoming)  key = `incoming:${u.partnerRequestFrom}`;
  else if (pending)   key = `pending:${u.partnerRequestTo}`;
  else                key = "unpaired";

  // Avoid wiping mid-typing in search if the high-level state hasn't changed
  if (key === _lastRenderedKey) return;
  _lastRenderedKey = key;

  if (partnerId)     return paintPaired(s);
  if (incoming)      return paintIncoming(s);
  if (pending)       return paintPending(s);
  return paintUnpaired(s);
}

// =========================================================================
// UNPAIRED — invite code + search + paste code
// =========================================================================
function paintUnpaired(s) {
  const me = s.user || {};
  const myCode = me.uid || auth.currentUser?.uid || "";

  _container.innerHTML = `
    <div class="bond-page stagger">
      <header class="bond-hero">
        <div class="bond-hero__orb"></div>
        <h1>Find your person 💞</h1>
        <p>You're flying solo right now. Connect with your partner so you can chat, share moments, and play together.</p>
      </header>

      <section class="card bond-section">
        <h3 class="bond-h">Your invite code</h3>
        <p class="bond-sub">Share this code with your partner. They'll paste it on their Bond page to connect with you.</p>
        <div class="bond-code-row">
          <code class="bond-code" id="myInviteCode" title="Your invite code">${escape(myCode)}</code>
          <button class="btn btn-primary" id="btnCopyCode">Copy</button>
        </div>
      </section>

      <section class="card bond-section">
        <h3 class="bond-h">Have their code?</h3>
        <div class="bond-paste-row">
          <input id="pasteCodeInput" class="bond-input" type="text"
                 placeholder="Paste partner's invite code…" autocomplete="off" spellcheck="false">
          <button class="btn btn-primary" id="btnPairCode">Connect</button>
        </div>
        <p class="bond-tip">Tip: codes are long. Tap the field and paste with Ctrl/Cmd+V.</p>
      </section>

      <section class="card bond-section">
        <h3 class="bond-h">Or search by username</h3>
        <div class="bond-search-row">
          <span class="bond-search-icon">🔎</span>
          <input id="bondSearchInput" class="bond-input" type="search"
                 placeholder="@username" autocomplete="off" spellcheck="false">
        </div>
        <div id="bondSearchResults" class="bond-results" aria-live="polite"></div>
      </section>
    </div>
  `;

  // Wire actions
  _container.querySelector("#btnCopyCode").addEventListener("click", async () => {
    if (!myCode) return toastWarn("No code yet — try again in a moment.");
    try {
      await navigator.clipboard.writeText(myCode);
      toastSuccess("Invite code copied — share it with your partner");
    } catch {
      // Fallback: select the text
      const el = _container.querySelector("#myInviteCode");
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toastWarn("Couldn't copy automatically — selection set, press Ctrl/Cmd+C");
    }
  });

  _container.querySelector("#btnPairCode").addEventListener("click", async () => {
    const input = _container.querySelector("#pasteCodeInput");
    const code  = (input?.value || "").trim();
    if (!code) return toastWarn("Paste their invite code first");
    if (code === myCode) return toastWarn("That's your own code 😅");
    await tryPairByCode(code);
  });

  const search = _container.querySelector("#bondSearchInput");
  search.addEventListener("input", () => {
    const q = (search.value || "").trim().toLowerCase().replace(/^@/, "");
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => runSearch(q), 220);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { search.value = ""; runSearch(""); }
  });
}

async function runSearch(q) {
  const list = _container?.querySelector("#bondSearchResults");
  if (!list) return;
  if (!q || q.length < 2) {
    list.innerHTML = `<p class="bond-empty">Type at least 2 letters to find someone.</p>`;
    return;
  }
  list.innerHTML = skeletonList(3, "list");
  const results = await safe(() => searchUsersByUsername(q, { limit: 12 }), "Search failed");
  const myUid = getState().user?.uid;
  if (!results || !results.length) {
    list.innerHTML = `<p class="bond-empty">No one matches "<strong>${escape(q)}</strong>".</p>`;
    return;
  }
  list.innerHTML = "";
  for (const u of results) {
    if (u.uid === myUid) continue;
    list.appendChild(renderSearchRow(u));
  }
  if (!list.children.length) list.innerHTML = `<p class="bond-empty">Only you matched.</p>`;
}

function renderSearchRow(u) {
  const row = document.createElement("div");
  row.className = "bond-result-row";
  const initial = (u.displayName || u.username || "?").trim().charAt(0).toUpperCase();
  const avatarHtml = u.photoURL
    ? `<img class="bond-avatar" alt="" src="${u.photoURL}" referrerpolicy="no-referrer">`
    : `<div class="bond-avatar" aria-hidden="true">${initial}</div>`;
  row.innerHTML = `
    ${avatarHtml}
    <div class="bond-result-meta">
      <div class="bond-result-name">${escape(u.displayName || u.username || "Someone")}</div>
      <div class="bond-result-handle">@${escape(u.username || "user")}</div>
    </div>
    <button class="btn btn-primary" data-act="invite">💌 Invite</button>
  `;
  row.querySelector('[data-act="invite"]').addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await trySendRequest(u.uid, u.username || u.displayName || "user");
    e.currentTarget.disabled = false;
  });
  return row;
}

async function tryPairByCode(code) {
  const me = getState().user;
  if (!me?.uid) return toastError("Not signed in");
  // Validate first to give better feedback
  const target = await safe(() => lookupByInviteCode(code), "Couldn't look up code");
  if (!target) return toastError("Invite code not found");
  if (target.uid === me.uid) return toastWarn("That's your own code 😅");
  if (target.partnerID && target.partnerID !== me.uid) {
    return toastError("That person is already paired with someone else.");
  }
  // Direct pair (couple apps don't need a request flow when both share codes)
  const ok = await safe(() => pairWithInviteCode(me.uid, code), "Couldn't connect");
  if (ok !== null) {
    toastSuccess("You're connected 💞");
    // appState onSnapshot will flip partnerId; paintForState will re-render.
  }
}

async function trySendRequest(targetUid, targetLabel) {
  const me = getState().user;
  if (!me?.uid) return toastError("Not signed in");
  if (targetUid === me.uid) return toastWarn("That's you 😅");
  // Reject if target already paired
  const target = await safe(() => getUser(targetUid), "Couldn't load that user");
  if (target?.partnerID) return toastError("That person is already paired.");
  const ok = await safe(() => sendRequest(me.uid, targetUid), "Couldn't send request");
  if (ok !== null) toastSuccess(`Invite sent to @${targetLabel} 💌`);
}

// =========================================================================
// INCOMING REQUEST — Accept / Reject
// =========================================================================
async function paintIncoming(s) {
  const me = s.user || {};
  const fromUid = me.partnerRequestFrom;
  _container.innerHTML = `
    <div class="bond-page stagger">
      <header class="bond-hero">
        <div class="bond-hero__orb glow"></div>
        <h1>Someone wants to bond with you 💌</h1>
        <p>Take a moment. You can accept or politely decline.</p>
      </header>
      <section class="card bond-decision" id="decisionCard">
        <div class="bond-decision__avatar"><div class="bond-avatar lg" id="incAvatar">…</div></div>
        <div class="bond-decision__meta">
          <div class="bond-result-name" id="incName">…</div>
          <div class="bond-result-handle" id="incHandle">@…</div>
        </div>
        <div class="bond-decision__actions">
          <button class="btn btn-ghost"   id="btnReject">Decline</button>
          <button class="btn btn-primary" id="btnAccept">Accept 💞</button>
        </div>
      </section>
    </div>
  `;

  const fromUser = await safe(() => getUser(fromUid), "Couldn't load that user");
  const name   = fromUser?.displayName || fromUser?.username || "Someone";
  const handle = fromUser?.username ? `@${fromUser.username}` : "@user";
  const initial = name.trim().charAt(0).toUpperCase();
  const avEl = _container.querySelector("#incAvatar");
  if (avEl) {
    if (fromUser?.photoURL) {
      avEl.outerHTML = `<img id="incAvatar" class="bond-avatar lg" alt="" src="${fromUser.photoURL}" referrerpolicy="no-referrer">`;
    } else {
      avEl.textContent = initial;
    }
  }
  _container.querySelector("#incName").textContent   = name;
  _container.querySelector("#incHandle").textContent = handle;

  _container.querySelector("#btnAccept").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const ok = await safe(() => acceptRequest(s.user.uid, fromUid), "Couldn't accept");
    if (ok !== null) toastSuccess("You're connected 💞");
  });
  _container.querySelector("#btnReject").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const ok = await safe(() => rejectRequest(s.user.uid), "Couldn't decline");
    if (ok !== null) toast("Request declined.");
  });
}

// =========================================================================
// PENDING — request sent, waiting on the other side
// =========================================================================
async function paintPending(s) {
  const toUid = s.user.partnerRequestTo;
  _container.innerHTML = `
    <div class="bond-page stagger">
      <header class="bond-hero">
        <div class="bond-hero__orb"></div>
        <h1>Waiting for the other heart… 💞</h1>
        <p>Your invite has been sent. We'll let you know the moment they accept.</p>
      </header>
      <section class="card bond-decision">
        <div class="bond-decision__avatar"><div class="bond-avatar lg" id="pendAvatar">…</div></div>
        <div class="bond-decision__meta">
          <div class="bond-result-name" id="pendName">…</div>
          <div class="bond-result-handle" id="pendHandle">@…</div>
        </div>
        <div class="bond-decision__actions">
          <button class="btn btn-ghost"   id="btnCancelReq">Cancel invite</button>
        </div>
      </section>
    </div>
  `;

  const target = await safe(() => getUser(toUid), "Couldn't load that user");
  const name   = target?.displayName || target?.username || "Your partner";
  const handle = target?.username ? `@${target.username}` : "@user";
  const initial = name.trim().charAt(0).toUpperCase();
  const av = _container.querySelector("#pendAvatar");
  if (av) {
    if (target?.photoURL) av.outerHTML = `<img id="pendAvatar" class="bond-avatar lg" alt="" src="${target.photoURL}" referrerpolicy="no-referrer">`;
    else av.textContent = initial;
  }
  _container.querySelector("#pendName").textContent   = name;
  _container.querySelector("#pendHandle").textContent = handle;

  _container.querySelector("#btnCancelReq").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    // Reusing rejectRequest — semantically: clear my pending state on both sides.
    const ok = await safe(() => rejectRequest(s.user.uid), "Couldn't cancel");
    if (ok !== null) toast("Invite cancelled.");
  });
}

// =========================================================================
// PAIRED — relationship pulse, love languages, goals, countdowns, recovery
// =========================================================================
function paintPaired(s) {
  const me      = s.user || {};
  const partner = s.partner || {};
  const coupleId = s.coupleId;
  const partnerName = partner.displayName || partner.username || "your partner";

  _container.innerHTML = `
    <div class="bond-page stagger">
      <header class="paired-header card">
        <div class="bond-avatar lg" id="pairedAvatar" aria-hidden="true">${escape((partnerName || "?").charAt(0).toUpperCase())}</div>
        <div class="paired-meta">
          <div class="paired-title">You & <strong>${escape(partnerName)}</strong></div>
          <div class="paired-sub" id="pairedSince">Connected</div>
        </div>
        <button class="btn btn-ghost paired-unpair" id="btnUnpair" title="Disconnect">Unpair</button>
      </header>

      <div class="pulse-card">
        <div class="pulse-orb"></div>
        <div class="pulse-label">Relationship Pulse</div>
        <div class="pulse-score" id="pulseScore">—</div>
      </div>

      <div class="love-langs">
        <h3>Love Languages</h3>
        <div class="lang-item"><span class="emoji">💬</span><div class="info"><div class="name">Words of Affirmation</div><div class="lang-bar"><div class="fill words"   id="langWords"   style="width:60%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">⏰</span><div class="info"><div class="name">Quality Time</div>          <div class="lang-bar"><div class="fill time"    id="langTime"    style="width:80%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🎁</span><div class="info"><div class="name">Gifts</div>                 <div class="lang-bar"><div class="fill gifts"   id="langGifts"   style="width:40%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🤗</span><div class="info"><div class="name">Physical Touch</div>        <div class="lang-bar"><div class="fill touch"   id="langTouch"   style="width:70%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🛠️</span><div class="info"><div class="name">Acts of Service</div>       <div class="lang-bar"><div class="fill support" id="langSupport" style="width:55%"></div></div></div></div>
      </div>

      <div class="goals-section">
        <h3>Shared Goals</h3>
        <div id="goalsList"></div>
        <button class="btn btn-ghost" id="btnAddGoal" style="width:100%;margin-top:8px">+ Add Goal</button>
      </div>

      <div class="countdowns">
        <h3 style="font-size:var(--font-sm);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500;margin-bottom:8px">Coming Up</h3>
        <div id="countdownList"></div>
        <button class="btn btn-ghost" id="btnAddCountdown" style="width:100%;margin-top:8px">+ Add Event</button>
      </div>

      <div class="recovery-card" id="recoveryCard" style="display:none">
        <h3>💛 Reconnect</h3>
        <p>It's been quiet. Want to break the ice?</p>
        <button class="btn btn-primary" id="btnRecovery">Send an olive branch 🕊️</button>
      </div>
    </div>
  `;

  // Avatar
  if (partner.photoURL) {
    const a = _container.querySelector("#pairedAvatar");
    if (a) a.outerHTML = `<img id="pairedAvatar" class="bond-avatar lg" alt="" src="${partner.photoURL}" referrerpolicy="no-referrer">`;
  }
  // Connected since
  if (me.matchedAt?.toDate) {
    const since = me.matchedAt.toDate();
    _container.querySelector("#pairedSince").textContent = `Connected ${formatDateShort(since)}`;
  }

  // Unpair
  _container.querySelector("#btnUnpair").addEventListener("click", () => openUnpairConfirm(me.uid, partnerName));

  // Wire bond data load
  loadPairedData(coupleId);

  // Goal / Countdown forms
  _container.querySelector("#btnAddGoal").addEventListener("click", () => openGoalForm(coupleId, me.uid));
  _container.querySelector("#btnAddCountdown").addEventListener("click", () => openCountdownForm(coupleId, me.uid));
  _container.querySelector("#btnRecovery").addEventListener("click", () => sendOliveBranch(me.uid, s.partnerId));
}

async function loadPairedData(coupleId) {
  if (!coupleId) return;
  // Pulse + languages
  const bond = await safe(
    () => getDoc(doc(db, "bonds", coupleId)).then((s) => s.exists() ? s.data() : null),
    "Couldn't load bond data"
  );
  const pulseEl = _container.querySelector("#pulseScore");
  if (pulseEl) pulseEl.textContent = `${bond?.pulse ?? 75}%`;
  if (bond?.languages) {
    Object.entries(bond.languages).forEach(([key, val]) => {
      const el = _container.querySelector(`#lang${key.charAt(0).toUpperCase() + key.slice(1)}`);
      if (el && typeof val === "number") el.style.width = `${Math.max(0, Math.min(100, val))}%`;
    });
  }
  // Goals
  const goalsList = _container.querySelector("#goalsList");
  if (goalsList) {
    goalsList.innerHTML = "";
    const gs = await safe(
      () => getDocs(query(collection(db, "bonds", coupleId, "goals"), orderBy("timestamp", "desc"), limit(10))),
      "Couldn't load goals"
    );
    if (gs && !gs.empty) {
      gs.forEach((d) => {
        const g = d.data();
        goalsList.innerHTML += `
          <div class="goal-card">
            <span class="icon">🎯</span>
            <div class="info">
              <div class="title">${escape(g.title || "Goal")}</div>
              <div class="progress">${escape(g.progressLabel || "In progress")}</div>
            </div>
          </div>`;
      });
    } else {
      goalsList.innerHTML = `<div class="bond-empty">No shared goals yet — add one below.</div>`;
    }
  }
  // Countdowns
  const cdList = _container.querySelector("#countdownList");
  if (cdList) {
    cdList.innerHTML = "";
    const cs = await safe(
      () => getDocs(query(collection(db, "bonds", coupleId, "events"), orderBy("date"), limit(10))),
      "Couldn't load events"
    );
    if (cs && !cs.empty) {
      cs.forEach((d) => {
        const ev = d.data();
        const ts = ev.date?.toMillis ? ev.date.toMillis() : (ev.date ? +new Date(ev.date) : 0);
        if (!ts) return;
        const days = Math.ceil((ts - Date.now()) / 86400000);
        cdList.innerHTML += `
          <div class="countdown-card">
            <span class="event">${escape(ev.title || "Event")}</span>
            <span class="days">${days > 0 ? days + "d" : (days === 0 ? "Today!" : "Past")}</span>
          </div>`;
      });
    } else {
      cdList.innerHTML = `<div class="bond-empty">No upcoming events — add one below.</div>`;
    }
  }
}

// ----- Inline modal helpers -----
function openModal(title, bodyHtml, primaryLabel, onSubmit) {
  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="${escape(title)}">
      <div class="bond-modal__head">${escape(title)}</div>
      <div class="bond-modal__body">${bodyHtml}</div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">${escape(primaryLabel)}</button>
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
    const handled = await Promise.resolve(onSubmit(wrap));
    okBtn.disabled = false;
    if (handled !== false) close();
  });
  // Focus first input
  const firstInput = wrap.querySelector("input, textarea");
  if (firstInput) firstInput.focus();
  return close;
}

function openGoalForm(coupleId, uid) {
  openModal(
    "Add a shared goal",
    `<label class="bond-field"><span>Title</span>
       <input id="goalTitle" type="text" maxlength="120" placeholder="e.g. Save for our trip"></label>`,
    "Add",
    async (root) => {
      const title = root.querySelector("#goalTitle").value.trim();
      if (!title) { toastWarn("Add a title"); return false; }
      const ok = await safe(
        () => addDoc(collection(db, "bonds", coupleId, "goals"), {
          title, progressLabel: "In progress", createdBy: uid, timestamp: Timestamp.now()
        }),
        "Couldn't save goal"
      );
      if (ok !== null) { toastSuccess("Goal added 💫"); loadPairedData(coupleId); }
    }
  );
}

function openCountdownForm(coupleId, uid) {
  openModal(
    "Add a countdown",
    `<label class="bond-field"><span>Event</span>
       <input id="cdTitle" type="text" maxlength="80" placeholder="e.g. Anniversary"></label>
     <label class="bond-field"><span>Date</span>
       <input id="cdDate" type="date"></label>`,
    "Add",
    async (root) => {
      const title = root.querySelector("#cdTitle").value.trim();
      const date  = root.querySelector("#cdDate").value;
      if (!title) { toastWarn("Add a title"); return false; }
      if (!date)  { toastWarn("Pick a date");  return false; }
      const d = new Date(date);
      if (isNaN(+d)) { toastWarn("That date doesn't look right"); return false; }
      const ok = await safe(
        () => addDoc(collection(db, "bonds", coupleId, "events"), {
          title, date: Timestamp.fromDate(d), createdBy: uid
        }),
        "Couldn't save event"
      );
      if (ok !== null) { toastSuccess("Event added 📅"); loadPairedData(coupleId); }
    }
  );
}

function openUnpairConfirm(meUid, partnerName) {
  openModal(
    "Disconnect from your partner?",
    `<p class="bond-modal__p">This will unpair you from <strong>${escape(partnerName)}</strong>. Your messages and memories stay, but the couple link is removed. You can pair again anytime.</p>`,
    "Disconnect",
    async () => {
      const ok = await safe(() => unpair(meUid), "Couldn't unpair");
      if (ok !== null) toast("Unpaired.");
    }
  );
}

async function sendOliveBranch(meUid, partnerUid) {
  if (!partnerUid) return;
  const ok = await safe(
    () => addDoc(collection(db, "notifications"), {
      type: "olive_branch", from: meUid, to: partnerUid,
      message: "I want to reconnect 💜", createdAt: Timestamp.now()
    }),
    "Couldn't send"
  );
  if (ok !== null) toastSuccess("🕊️ Olive branch sent");
}

// ----- helpers -----
function formatDateShort(d) {
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return ""; }
}
function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
