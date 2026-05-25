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
  doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, orderBy, limit, getDocs,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { computePulse, PULSE_LABELS } from "../services/bondPulseService.js";

let _container = null;
let _offState  = null;
let _searchDebounce = null;
let _lastRenderedKey = null;
let _unsubQotw      = null;
let _unsubKindness  = null;

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
  try { _unsubQotw?.(); } catch {}
  try { _unsubKindness?.(); } catch {}
  _offState = null;
  _unsubQotw = null;
  _unsubKindness = null;
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

  // Any prior view's live subscriptions should be torn down on transition.
  try { _unsubQotw?.(); } catch {}
  try { _unsubKindness?.(); } catch {}
  _unsubQotw = null;
  _unsubKindness = null;

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
        <div class="pulse-breakdown" id="pulseBreakdown"></div>
      </div>

      <div class="bd-timeline">
        <h3>Anniversary timeline</h3>
        <div class="bd-timeline__strip" id="bdTimelineStrip"></div>
      </div>

      <div class="bd-qotw" id="bdQotw">
        <div class="bd-qotw__head">
          <span class="bd-qotw__chip">Question of the week</span>
          <span class="bd-qotw__week" id="bdQotwWeek"></span>
        </div>
        <p class="bd-qotw__q" id="bdQotwPrompt">…</p>
        <div class="bd-qotw__answers" id="bdQotwAnswers">
          <div class="bd-qotw__row">
            <span class="bd-qotw__who">You</span>
            <span class="bd-qotw__a" id="bdQotwMine">Tap to answer</span>
          </div>
          <div class="bd-qotw__row">
            <span class="bd-qotw__who" id="bdQotwPartnerLabel">${escape(partnerName)}</span>
            <span class="bd-qotw__a" id="bdQotwTheirs">Hidden until you both answer</span>
          </div>
        </div>
        <button class="btn btn-primary bd-qotw__btn" id="bdQotwBtn">Answer this week</button>
      </div>

      <div class="bd-kindness">
        <div class="bd-kindness__head">
          <span class="bd-kindness__icon">💛</span>
          <h3>Kindness streak</h3>
        </div>
        <div class="bd-kindness__stats">
          <div class="bd-kindness__stat">
            <div class="bd-kindness__num" id="bdKindStreak">0</div>
            <div class="bd-kindness__lbl">day streak</div>
          </div>
          <div class="bd-kindness__stat">
            <div class="bd-kindness__num" id="bdKindTotal">0</div>
            <div class="bd-kindness__lbl">acts logged</div>
          </div>
        </div>
        <div class="bd-kindness__recent" id="bdKindRecent"></div>
        <button class="btn btn-primary bd-kindness__btn" id="bdKindBtn">+ Log a kind act</button>
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
  paintAnniversaryTimeline(me);
  loadQotw(coupleId, me.uid, partnerName, s.partnerId);
  loadKindness(coupleId, me.uid);

  // Goal / Countdown forms
  _container.querySelector("#btnAddGoal").addEventListener("click", () => openGoalForm(coupleId, me.uid));
  _container.querySelector("#btnAddCountdown").addEventListener("click", () => openCountdownForm(coupleId, me.uid));
  _container.querySelector("#btnRecovery").addEventListener("click", () => sendOliveBranch(me.uid, s.partnerId));
}

async function loadPairedData(coupleId) {
  if (!coupleId) return;
  // Pulse — compute from real activity over last 14 days.
  const me = getState().user || {};
  const partnerId = getState().partnerId;
  const pulseEl = _container.querySelector("#pulseScore");
  if (pulseEl) pulseEl.textContent = "…";

  // Fetch everything else in parallel
  const [bond, pulseResult] = await Promise.all([
    safe(() => getDoc(doc(db, "bonds", coupleId)).then((s) => s.exists() ? s.data() : null),
         "Couldn't load bond data"),
    safe(() => computePulse(coupleId, me.uid, partnerId), null)
  ]);

  if (pulseEl) pulseEl.textContent = `${pulseResult?.score ?? bond?.pulse ?? 75}%`;
  paintPulseBreakdown(pulseResult);
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



// =====================================================================
// Anniversary timeline — milestone badges + days elapsed
// =====================================================================
const ANNIV_MILESTONES = [
  { days: 30,    label: "1 month",   icon: "🌱" },
  { days: 100,   label: "100 days",  icon: "💯" },
  { days: 180,   label: "6 months",  icon: "🌸" },
  { days: 365,   label: "1 year",    icon: "💜" },
  { days: 730,   label: "2 years",   icon: "✨" },
  { days: 1095,  label: "3 years",   icon: "🌟" },
  { days: 1825,  label: "5 years",   icon: "💎" },
  { days: 3650,  label: "10 years",  icon: "👑" },
];
function paintAnniversaryTimeline(me) {
  const strip = _container?.querySelector("#bdTimelineStrip");
  if (!strip) return;
  const startedAt = me.matchedAt?.toMillis?.() || me.matchedAt?.seconds * 1000 || null;
  const days = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 86400000)) : 0;
  strip.innerHTML = ANNIV_MILESTONES.map((m) => {
    const earned = days >= m.days;
    return `<div class="bd-tl__step ${earned ? "is-earned" : ""}" title="${escape(m.label)}">
      <div class="bd-tl__icon">${m.icon}</div>
      <div class="bd-tl__lbl">${escape(m.label)}</div>
      <div class="bd-tl__sub">${earned ? "earned" : `${m.days - days}d`}</div>
    </div>`;
  }).join("");
}

// =====================================================================
// Question of the Week — weekly rotating prompt; both partners answer.
// =====================================================================
const QOTW_BANK = [
  "What was the most ordinary moment that felt extraordinary together?",
  "If we made a small ritual we'd never break, what should it be?",
  "What's something kind I do that I might not realise matters to you?",
  "When did you most feel chosen by me?",
  "If we had a free Saturday, no plan, no phones — what's the dream?",
  "What's a small thing about us I should never let go of?",
  "Which inside joke do you want us to keep alive forever?",
  "Where do you feel most at home with me?",
  "What's a dream you've kept quiet that I should know about?",
  "What's a fear I can carry beside you?",
  "What's a lyric or line that reminds you of us?",
  "What's the kindest thing you'd want me to do for you on a hard day?",
  "What part of yourself has grown since we met?",
  "What's something you'd love to learn together?",
  "When did you last feel proud of us as a team?",
  "What's a memory you'd live in for an afternoon if you could?",
  "What's one comfort food you want me to know how to make for you?",
  "If we could only keep five photos, which would you save?",
  "What's a tiny luxury you'd love more of?",
  "What's a place you'd love us to visit before the year ends?",
  "How can I show up for you better this week?",
  "What's a tradition from your family you'd love to keep with us?",
  "What's something I do that makes you feel fully seen?",
  "If we could replay one day exactly as it was, which?",
  "What does forever feel like, in one sentence?",
  "What promise to ourselves do we want to keep this season?",
];
function isoWeekKey(d = new Date()) {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function pickWeeklyQuestion(weekKey) {
  // Stable mapping from weekKey to bank index
  let h = 0; for (let i = 0; i < weekKey.length; i++) h = (h * 31 + weekKey.charCodeAt(i)) | 0;
  return QOTW_BANK[Math.abs(h) % QOTW_BANK.length];
}

function loadQotw(coupleId, myUid, partnerName, partnerId) {
  if (!coupleId) return;
  const week = isoWeekKey();
  const ref  = doc(db, "bonds", coupleId, "qotw", week);
  const promptText = pickWeeklyQuestion(week);

  // Pre-paint static fields immediately so the user isn't staring at "…"
  const weekLbl = _container?.querySelector("#bdQotwWeek");
  const promptEl = _container?.querySelector("#bdQotwPrompt");
  if (weekLbl)  weekLbl.textContent  = week;
  if (promptEl) promptEl.textContent = promptText;

  // Subscribe so partner answers stream in
  _unsubQotw = onSnapshot(ref, (snap) => {
    const data = snap.data() || {};
    const answers = data.answers || {};
    const mine = answers[myUid] || "";
    const theirs = partnerId ? (answers[partnerId] || "") : "";
    const myEl  = _container?.querySelector("#bdQotwMine");
    const trEl  = _container?.querySelector("#bdQotwTheirs");
    const btn   = _container?.querySelector("#bdQotwBtn");
    if (myEl) myEl.textContent = mine || "Tap to answer";
    if (trEl) {
      if (mine && theirs)        trEl.textContent = theirs;
      else if (theirs && !mine)  trEl.textContent = "Hidden until you answer too";
      else if (!theirs)          trEl.textContent = `${partnerName} hasn't answered yet`;
    }
    if (btn) btn.textContent = mine ? "Edit your answer" : "Answer this week";
  });

  // Wire button
  const btn = _container?.querySelector("#bdQotwBtn");
  if (btn) {
    btn.onclick = () => openQotwModal(coupleId, myUid, week, promptText);
  }
}

function openQotwModal(coupleId, myUid, week, promptText) {
  const me = getState().user || {};
  const cur = ""; // we'll re-fetch on save; modal starts empty unless we want to pre-fill
  openModal(
    "Question of the week",
    `<p class="bond-qotw-prompt">${escape(promptText)}</p>
     <textarea id="qotwAnswer" class="bd-qotw__input" rows="4" maxlength="600"
       placeholder="Be honest. Be soft. Be you."></textarea>`,
    "Save answer",
    async (modalEl) => {
      const val = modalEl.querySelector("#qotwAnswer").value.trim();
      if (!val) { toastWarn("Type something first"); return false; }
      const ok = await safe(() => setDoc(
        doc(db, "bonds", coupleId, "qotw", week),
        {
          question: promptText,
          answers: { [myUid]: val },
          updatedAt: serverTimestamp()
        },
        { merge: true }
      ), "Couldn't save your answer");
      if (ok !== false) toastSuccess("Saved 💜");
    }
  );
}

// =====================================================================
// Kindness streak — log acts; counter + last-7-day streak
// =====================================================================
function loadKindness(coupleId, myUid) {
  if (!coupleId) return;
  const col = collection(db, "bonds", coupleId, "kindness");
  const q = query(col, orderBy("at", "desc"), limit(50));
  _unsubKindness = onSnapshot(q, (snap) => {
    const acts = [];
    snap.forEach((d) => acts.push({ id: d.id, ...d.data() }));
    paintKindness(acts, myUid);
  });

  const btn = _container?.querySelector("#bdKindBtn");
  if (btn) btn.onclick = () => openKindnessModal(coupleId, myUid);
}

function paintKindness(acts, myUid) {
  const total = acts.length;
  const streak = computeKindnessStreak(acts);
  const recent = acts.slice(0, 4);
  const totalEl  = _container?.querySelector("#bdKindTotal");
  const streakEl = _container?.querySelector("#bdKindStreak");
  const recentEl = _container?.querySelector("#bdKindRecent");
  if (totalEl)  totalEl.textContent = String(total);
  if (streakEl) streakEl.textContent = String(streak);
  if (recentEl) {
    if (!recent.length) {
      recentEl.innerHTML = `<p class="bd-kindness__empty">Log a kind act to start your streak.</p>`;
    } else {
      recentEl.innerHTML = recent.map((a) => {
        const when = a.at?.toDate?.() || (a.at ? new Date(a.at) : null);
        const ago = when ? friendlyAgo(when) : "just now";
        const mine = a.by === myUid;
        return `<div class="bd-kindness__row ${mine ? "is-mine" : ""}">
          <span class="bd-kindness__bullet">💛</span>
          <span class="bd-kindness__txt">${escape(a.note || "Kind act")}</span>
          <span class="bd-kindness__ago">${escape(ago)}</span>
        </div>`;
      }).join("");
    }
  }
}

function computeKindnessStreak(acts) {
  if (!acts.length) return 0;
  const days = new Set();
  for (const a of acts) {
    const when = a.at?.toDate?.() || (a.at ? new Date(a.at) : null);
    if (when) days.add(toDayKey(when));
  }
  let streak = 0;
  let cursor = new Date();
  while (days.has(toDayKey(cursor))) {
    streak++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
}
function toDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function friendlyAgo(d) {
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function openKindnessModal(coupleId, myUid) {
  openModal(
    "Log a kind act",
    `<label class="bond-field"><span>What did you do?</span>
      <input id="kindNote" type="text" maxlength="120" placeholder="Made them tea. Texted to check in." autocomplete="off">
     </label>`,
    "Add",
    async (modalEl) => {
      const note = modalEl.querySelector("#kindNote").value.trim();
      if (!note) { toastWarn("Type a quick note"); return false; }
      const ok = await safe(() => addDoc(collection(db, "bonds", coupleId, "kindness"), {
        by: myUid, note, at: serverTimestamp()
      }), "Couldn't save");
      if (ok !== false) toastSuccess("Kind act logged 💛");
    }
  );
}


// =====================================================================
// Pulse breakdown — chips showing where the score came from.
// =====================================================================
function paintPulseBreakdown(result) {
  const host = _container?.querySelector("#pulseBreakdown");
  if (!host) return;
  if (!result || !result.breakdown) {
    host.innerHTML = "";
    return;
  }
  const raw = result.raw || {};
  const rawForKey = (k) => ({
    messages: raw.msgCount,
    kindness: raw.kindnessCount,
    dates:    raw.datesDoneCount,
    moods:    raw.moodSharesCount,
    letters:  raw.lettersCount,
    qotw:     raw.qotwCount,
    calls:    0,
  }[k] ?? 0);

  // Order by contribution
  const entries = Object.entries(result.breakdown)
    .sort((a, b) => b[1] - a[1]);

  host.innerHTML = entries.map(([key, points]) => {
    const meta = PULSE_LABELS[key] || { label: key, icon: "·" };
    const n = rawForKey(key);
    return `<div class="pulse-chip ${points > 0 ? "is-active" : ""}" title="${escape(meta.label)}: ${n} in 14 days">
      <span class="pulse-chip__icon">${meta.icon}</span>
      <span class="pulse-chip__label">${escape(meta.label)}</span>
      <span class="pulse-chip__num">${n}</span>
    </div>`;
  }).join("");
}
