// =====================================================================
// modules/chat.js — Couple chat UI.
// Reactive: subscribes to appState; rebuilds when partner / coupleId flips.
// Wires services/chatService.js + services/aiReply.js for smart-reply chips.
// =====================================================================
import { db, storage } from '../firebase.js';
import { onAppState, getState } from '../state/appState.js';
import { skeletonList } from '../utils/skeleton.js';
import { toast, toastWarn, toastError, safe } from '../utils/toast.js';
import { formatDayHeader } from '../utils/time.js';
import {
  ensureChat, subscribeMessages, sendText, setTyping,
  markDeliveredAndSeen, toggleReaction, subscribeChatMeta, renderTicks,
  sendPoll, votePoll
} from '../services/chatService.js';
import { rememberMessage, suggestReplies } from '../services/aiReply.js';
import { gateVoiceNote } from '../services/featureGate.js';
import { startVideoCall, startAudioCall } from './callView.js';
import { subscribeCoupleMeta } from '../services/coupleService.js';

let _container       = null;
let _offState        = null;
let _unsubMessages   = null;
let _unsubMeta       = null;
let _unsubCoupleMeta = null;
let _typingDebounce  = null;
let _suggestDebounce = null;
let _chatId          = null;
let _coupleId        = null;
let _myUid           = null;
let _partnerId       = null;
let _partnerName     = "Partner";
let _partnerPhoto    = null;
let _lastRenderedFor = null;       // (myUid|partnerId) we built the shell for
let _lastMsgs        = [];
let _themeOutsideHandler = null;   // doc click handler for closing theme popup

export function renderChat(container) {
  _container = container;

  // Initial skeleton while we wait for appState
  _container.innerHTML = `<div class="chat-shell-loading">${skeletonList(5, "msg")}</div>`;

  _offState = onAppState(async (s) => {
    if (!s.ready) return;
    await onState(s);
  });

  return cleanup;
}

export function teardownChat() { cleanup(); }

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsubMessages?.(); } catch {}
  try { _unsubMeta?.(); } catch {}
  try { _unsubCoupleMeta?.(); } catch {}
  if (_themeOutsideHandler) {
    try { document.removeEventListener('click', _themeOutsideHandler, true); } catch {}
    _themeOutsideHandler = null;
  }
  clearTimeout(_typingDebounce);
  clearTimeout(_suggestDebounce);
  _offState = _unsubMessages = _unsubMeta = _unsubCoupleMeta = null;
  _coupleId = null;
  _typingDebounce = _suggestDebounce = null;
  _container = null;
  _chatId = _myUid = _partnerId = null;
  _lastRenderedFor = null;
  _lastMsgs = [];
  _partnerPhoto = null;
}

// =========================================================================
// State changes
// =========================================================================

async function onState(s) {
  _myUid    = s.user?.uid || null;
  _partnerId = s.partnerId || null;
  _partnerName  = s.partner?.displayName?.split(' ')[0] || s.partner?.username || "Partner";
  _partnerPhoto = s.partner?.photoURL || null;

  // (Re)subscribe to couple meta when coupleId changes — drives the mood widget.
  if (s.coupleId && s.coupleId !== _coupleId) {
    _coupleId = s.coupleId;
    try { _unsubCoupleMeta?.(); } catch {}
    _unsubCoupleMeta = subscribeCoupleMeta(_coupleId, (meta) => paintMoodWidget(meta));
  } else if (!s.coupleId && _coupleId) {
    _coupleId = null;
    try { _unsubCoupleMeta?.(); } catch {}
    _unsubCoupleMeta = null;
  }

  if (!_partnerId || !_myUid) {
    paintEmpty();
    return;
  }

  const key = `${_myUid}|${_partnerId}`;
  if (key !== _lastRenderedFor) {
    _lastRenderedFor = key;
    paintShell();
    // attach (re)subscribers
    try { _unsubMessages?.(); } catch {}
    try { _unsubMeta?.(); }    catch {}
    _unsubMessages = _unsubMeta = null;

    _chatId = await safe(() => ensureChat(_myUid, _partnerId), "Couldn't open chat");
    if (!_chatId) return;

    _unsubMessages = subscribeMessages(_chatId, (msgs) => {
      _lastMsgs = msgs;
      // Feed AI memory
      for (const m of msgs) {
        const ms = m.time?.toMillis?.() ?? Date.now();
        rememberMessage(_chatId, { sender: m.sender, text: m.text || "", time: ms });
      }
      renderMessages(msgs);
      // Mark delivered/seen for inbound
      markDeliveredAndSeen(_chatId, msgs).catch(() => {});
      // Refresh smart replies (debounced)
      scheduleSuggestions();
    });

    _unsubMeta = subscribeChatMeta(_chatId, (meta) => {
      const t = meta?.typing?.[_partnerId];
      const tEl = _container?.querySelector('#chatTyping');
      if (tEl) tEl.textContent = t ? `${_partnerName} is typing…` : '';
    });
  }

  // Always update header presence (fires whenever partner doc updates)
  updateHeaderPresence(s.partner);
}

// =========================================================================
// Render — empty / shell
// =========================================================================

function paintEmpty() {
  _container.innerHTML = `
    <div class="chat-empty stagger">
      <div class="chat-empty-orb"></div>
      <h2>Chat with your partner 💜</h2>
      <p>Connect with your partner first to start chatting.</p>
      <button class="btn btn-primary" id="chatCtaBond">Find your partner</button>
    </div>`;
  _container.querySelector("#chatCtaBond")?.addEventListener("click", () => window.loadPage?.("bond"));
}

function paintShell() {
  const initial = (_partnerName || "?").trim().charAt(0).toUpperCase();
  const avatar = _partnerPhoto
    ? `<img src="${_partnerPhoto}" alt="" referrerpolicy="no-referrer">`
    : (typeof window.avatarFor === "function"
        ? `<img src="${window.avatarFor({ uid: _partnerId, displayName: _partnerName })}" alt="">`
        : initial);

  _container.innerHTML = `
    <div class="chat-page">
      <header class="chat-header">
        <div class="chat-peer">
          <div class="chat-peer-avatar">${avatar}</div>
          <div class="chat-peer-info">
            <div class="chat-peer-name">${escapeHtml(_partnerName)}</div>
            <div class="chat-peer-status" id="chatPeerStatus">…</div>
            <div class="chat-mood-widget" id="chatMoodWidget" hidden>
              <span class="chat-mood-pair" id="chatMoodPair" aria-hidden="true"></span>
              <span class="chat-mood-label" id="chatMoodLabel">Moods syncing…</span>
            </div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="chat-action" id="btnChatTheme" title="Chat theme">🎨</button>
          <button class="chat-action" id="btnAudioCall" title="Voice call">📞</button>
          <button class="chat-action" id="btnVideoCall" title="Video call">📹</button>
        </div>
      </header>

      <div class="chat-theme-pop" id="chatThemePop" hidden>
        <div class="chat-theme-pop__title">Pick a chat theme</div>
        <div class="chat-theme-pop__grid">
          ${[
            { key: "default",  label: "Default",  cls: "" },
            { key: "aurora",   label: "Aurora",   cls: "is-aurora" },
            { key: "sunset",   label: "Sunset",   cls: "is-sunset" },
            { key: "ocean",    label: "Ocean",    cls: "is-ocean" },
            { key: "forest",   label: "Forest",   cls: "is-forest" },
            { key: "midnight", label: "Midnight", cls: "is-midnight" },
          ].map(t => `
            <button class="chat-theme-swatch ${t.cls}" data-theme="${t.key}" type="button">
              <span class="chat-theme-swatch__preview"></span>
              <span class="chat-theme-swatch__label">${t.label}</span>
            </button>
          `).join("")}
        </div>
      </div>

      <div class="chat-stream" id="chatStream">${skeletonList(4, "msg")}</div>

      <div class="chat-typing" id="chatTyping"></div>

      <div class="chat-suggest" id="chatSuggest" hidden></div>

      <footer class="chat-composer">
        <button class="composer-btn" id="btnEmoji"  title="Emoji">😊</button>
        <button class="composer-btn" id="btnPoll"   title="Send a poll">📊</button>
        <input class="composer-input" id="composerInput" placeholder="Write something sweet…" autocomplete="off">
        <button class="composer-btn" id="btnVoice"  title="Hold to record voice note">🎙️</button>
        <button class="composer-send" id="btnSend"  title="Send">➤</button>
      </footer>
    </div>
  `;

  attachHandlers();
}

function updateHeaderPresence(partner) {
  const el = _container?.querySelector('#chatPeerStatus');
  if (!el) return;
  if (!partner) { el.textContent = "Offline"; return; }
  const presence = partner.status || {};
  if (presence.online) { el.textContent = "Online 💚"; return; }
  if (presence.lastSeen) {
    const ms = presence.lastSeen?.toMillis?.() ?? +new Date(presence.lastSeen);
    el.textContent = ms ? "Last seen " + relativeTime(ms) : "Offline";
    return;
  }
  el.textContent = "Offline";
}

// =========================================================================
// Render — messages
// =========================================================================

function renderMessages(msgs) {
  const stream = _container?.querySelector('#chatStream');
  if (!stream) return;
  if (!msgs || !msgs.length) {
    stream.innerHTML = `<div class="chat-blank">Say hi 💜</div>`;
    return;
  }
  let html = '';
  let lastDay = '';
  for (const m of msgs) {
    const ts  = m.time?.toDate?.() || (m.time ? new Date(m.time) : new Date());
    const day = formatDayHeader(ts);
    if (day !== lastDay) {
      html += `<div class="chat-divider"><span>${escapeHtml(day)}</span></div>`;
      lastDay = day;
    }
    const mine = m.sender === _myUid;
    const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const reactions = renderReactions(m);

    let body = '';
    if (m.kind === 'poll') {
      body = renderPollBody(m);
    } else if (m.audio) {
      body = `<audio controls src="${m.audio}" class="chat-audio"></audio>`;
    } else if (m.image) {
      body = `<img class="chat-image" src="${m.image}" alt="">`;
    } else {
      body = escapeHtml(m.text || '');
    }
    html += `
      <div class="chat-row ${mine ? 'mine' : 'theirs'}" data-id="${m.id}">
        <div class="chat-bubble">
          <div class="chat-text">${body}</div>
          <div class="chat-meta">
            <span class="chat-time">${time}</span>
            ${mine ? renderTicks(m, _myUid) : ''}
          </div>
          ${reactions}
        </div>
      </div>`;
  }
  stream.innerHTML = html;
  stream.scrollTop = stream.scrollHeight;

  // double-tap to react with ❤️
  stream.querySelectorAll('.chat-row').forEach((row) => {
    row.addEventListener('dblclick', () => {
      const id = row.dataset.id;
      toggleReaction(_chatId, id, '❤️').catch(() => {});
    });
  });

  // Poll vote clicks
  stream.querySelectorAll('.chat-poll__choice').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.chat-row');
      const msgId = row?.dataset.id;
      const idx = Number(btn.dataset.idx);
      if (!msgId || Number.isNaN(idx)) return;
      votePoll(_chatId, msgId, idx).catch(() => {});
    });
  });
}

function renderReactions(msg) {
  const r = msg.reactions || {};
  const entries = Object.entries(r);
  if (!entries.length) return '';
  return `<div class="chat-reactions">${entries.map(([_, e]) => `<span>${e}</span>`).join('')}</div>`;
}

// =========================================================================
// AI Suggested Replies
// =========================================================================

function scheduleSuggestions() {
  clearTimeout(_suggestDebounce);
  _suggestDebounce = setTimeout(refreshSuggestions, 350);
}

async function refreshSuggestions() {
  const host = _container?.querySelector('#chatSuggest');
  if (!host) return;

  // Show only if last message exists AND it's from partner (not me)
  if (!_lastMsgs.length) { host.hidden = true; return; }
  const last = _lastMsgs[_lastMsgs.length - 1];
  if (last.sender === _myUid) { host.hidden = true; return; }

  const replies = await safe(() => suggestReplies(_chatId, _myUid), null);
  if (!replies || !replies.length) { host.hidden = true; return; }

  host.innerHTML = replies.map((r) =>
    `<button class="chat-suggest__chip" data-text="${encodeAttr(r)}">${escapeHtml(r)}</button>`
  ).join('');
  host.hidden = false;

  host.querySelectorAll('.chat-suggest__chip').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.text || '';
      if (!text || !_chatId || !_partnerId) return;
      btn.disabled = true;
      const ok = await safe(() => sendText(_chatId, _partnerId, text), "Couldn't send");
      if (ok !== null) host.hidden = true;
    });
  });
}

// =========================================================================
// Composer / handlers
// =========================================================================

function attachHandlers() {
  const input = _container.querySelector('#composerInput');
  const send  = _container.querySelector('#btnSend');
  const voice = _container.querySelector('#btnVoice');
  const emoji = _container.querySelector('#btnEmoji');
  const audioCallBtn = _container.querySelector('#btnAudioCall');
  const videoCallBtn = _container.querySelector('#btnVideoCall');

  audioCallBtn.onclick = () => startAudioCall(_partnerId, _partnerName);
  videoCallBtn.onclick = () => startVideoCall(_partnerId, _partnerName);

  // ---- Chat theme picker -----------------------------------------------
  applyChatTheme(loadChatTheme());
  const themeBtn = _container.querySelector('#btnChatTheme');
  const themePop = _container.querySelector('#chatThemePop');
  themeBtn.onclick = (e) => {
    e.stopPropagation();
    themePop.hidden = !themePop.hidden;
  };
  if (_themeOutsideHandler) document.removeEventListener('click', _themeOutsideHandler, true);
  _themeOutsideHandler = (ev) => {
    if (!_container || !themePop) return;
    if (themePop.hidden) return;
    if (themePop.contains(ev.target) || themeBtn.contains(ev.target)) return;
    themePop.hidden = true;
  };
  document.addEventListener('click', _themeOutsideHandler, true);
  _container.querySelectorAll('.chat-theme-swatch').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.theme;
      saveChatTheme(key);
      applyChatTheme(key);
      themePop.hidden = true;
      toast(`Theme · ${key}`);
    });
  });

  input.addEventListener('input', () => {
    if (!_chatId) return;
    setTyping(_chatId, true);
    clearTimeout(_typingDebounce);
    _typingDebounce = setTimeout(() => setTyping(_chatId, false), 1500);
  });

  function doSend() {
    const text = input.value.trim();
    if (!text || !_chatId || !_partnerId) return;
    safe(() => sendText(_chatId, _partnerId, text), "Couldn't send");
    input.value = '';
    setTyping(_chatId, false);
    // Tiny send pulse on the send button
    send.classList.remove('is-pulsing');
    void send.offsetWidth;
    send.classList.add('is-pulsing');
    setTimeout(() => send.classList.remove('is-pulsing'), 500);
    // Hide suggestions immediately when user sends
    const host = _container?.querySelector('#chatSuggest');
    if (host) host.hidden = true;
  }
  send.onclick = doSend;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });

  emoji.onclick = () => {
    const palette = ['💜','😘','🥰','😍','😂','🥺','🫶','💋','🌙','✨','🥹','🫨'];
    input.value += palette[Math.floor(Math.random() * palette.length)];
    input.focus();
  };

  // Poll composer
  _container.querySelector('#btnPoll').onclick = () => openPollComposer();

  attachVoiceRecorder(voice);
}

// ---- Voice recorder (hold to record) ----
function attachVoiceRecorder(voiceBtn) {
  let mediaRecorder = null;
  let chunks = [];
  let pressTimer = null;
  let stream = null;

  const begin = async () => {
    // Plan check first — gateVoiceNote tracks daily count and routes to /subscription on cap.
    const gate = await gateVoiceNote();
    if (gate && gate.allowed === false) {
      // featureGate.showUpgradePrompt already toasts + routes
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await uploadAndSendAudio(blob);
      };
      mediaRecorder.start();
      voiceBtn.classList.add('recording');
      toast('Recording… release to send');
    } catch (e) {
      toastError('Microphone permission denied');
    }
  };
  const end = () => {
    voiceBtn.classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  };

  voiceBtn.addEventListener('mousedown',  () => { pressTimer = setTimeout(begin, 150); });
  voiceBtn.addEventListener('mouseup',    () => { clearTimeout(pressTimer); end(); });
  voiceBtn.addEventListener('mouseleave', () => { clearTimeout(pressTimer); end(); });
  voiceBtn.addEventListener('touchstart', (e) => { e.preventDefault(); pressTimer = setTimeout(begin, 150); }, { passive: false });
  voiceBtn.addEventListener('touchend',   () => { clearTimeout(pressTimer); end(); });
}

// ---- Voice note upload ----
async function uploadAndSendAudio(blob) {
  if (!_chatId || !_partnerId || !_myUid) return;
  let url = null;
  try {
    if (storage) {
      const { ref, uploadBytes, getDownloadURL } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
      const path = `voicenotes/${_chatId}/${Date.now()}_${_myUid}.webm`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: 'audio/webm' });
      url = await getDownloadURL(fileRef);
    }
  } catch (e) {
    console.warn('[chat] storage upload failed, falling back to base64', e);
  }
  if (!url) {
    if (blob.size > 600 * 1024) { toastWarn('Voice note too large'); return; }
    url = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  const { collection, doc, writeBatch, serverTimestamp, increment } =
    await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

  const batch = writeBatch(db);
  const msgRef  = doc(collection(db, 'chats', _chatId, 'messages'));
  const chatRef = doc(db, 'chats', _chatId);
  batch.set(msgRef, {
    audio: url, sender: _myUid, time: serverTimestamp(),
    status: 'sent', deliveredAt: null, seenAt: null, reactions: {}
  });
  batch.update(chatRef, {
    lastMessage:        '🎙️ Voice note',
    lastMessageTime:    serverTimestamp(),
    lastMessageSender:  _myUid,
    [`unread.${_partnerId}`]: increment(1),
    [`unread.${_myUid}`]:     0
  });
  await batch.commit().catch((e) => toastError("Couldn't send voice note"));
}

// ---- helpers ----
function relativeTime(ms) {
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function encodeAttr(s) {
  return String(s ?? "").replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}



// =====================================================================
// Chat theme helpers — set data-chat-theme on .chat-page
// =====================================================================
const VALID_CHAT_THEMES = ["default","aurora","sunset","ocean","forest","midnight"];
function loadChatTheme() {
  try {
    const v = localStorage.getItem("nvvunenu.chatTheme");
    return VALID_CHAT_THEMES.includes(v) ? v : "default";
  } catch { return "default"; }
}
function saveChatTheme(key) {
  try { localStorage.setItem("nvvunenu.chatTheme", key); } catch {}
}
function applyChatTheme(key) {
  if (!_container) return;
  const page = _container.querySelector(".chat-page");
  if (!page) return;
  page.setAttribute("data-chat-theme", VALID_CHAT_THEMES.includes(key) ? key : "default");
  // mark active swatch
  _container.querySelectorAll(".chat-theme-swatch").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.theme === key);
  });
}

// Public hook: trigger a tiny pulse on send (called from doSend if added later).
export function chatSendPulse() {
  if (!_container) return;
  const send = _container.querySelector("#btnSend");
  if (!send) return;
  send.classList.remove("is-pulsing");
  // force reflow so animation restarts cleanly
  void send.offsetWidth;
  send.classList.add("is-pulsing");
  setTimeout(() => send?.classList.remove("is-pulsing"), 500);
}


// =====================================================================
// Mood widget in chat header — shows both partners' current moods
// from the couple meta moods map.
// =====================================================================
function paintMoodWidget(meta) {
  const w  = _container?.querySelector('#chatMoodWidget');
  if (!w) return;
  const moods = meta?.moods || {};
  const my   = moods[_myUid]?.emoji || null;
  const yrs  = moods[_partnerId]?.emoji || null;
  if (!my && !yrs) { w.hidden = true; return; }
  w.hidden = false;
  const pair = _container.querySelector('#chatMoodPair');
  const lab  = _container.querySelector('#chatMoodLabel');
  if (pair) pair.textContent = `${my || "·"} · ${yrs || "·"}`;
  if (lab) {
    if (my && yrs)      lab.textContent = "Both feeling shared today";
    else if (my)        lab.textContent = "You shared your mood";
    else                lab.textContent = `${_partnerName} shared their mood`;
  }
}


// =====================================================================
// Polls — bubble renderer + composer modal
// =====================================================================
function renderPollBody(m) {
  const choices = Array.isArray(m.choices) ? m.choices : [];
  const votes   = m.votes || {};
  const totals  = choices.map((_, i) => 0);
  let total = 0;
  for (const uid of Object.keys(votes)) {
    const idx = Number(votes[uid]);
    if (idx >= 0 && idx < choices.length) { totals[idx]++; total++; }
  }
  const myChoice = votes[_myUid] !== undefined ? Number(votes[_myUid]) : -1;
  const partnerChoice = votes[_partnerId] !== undefined ? Number(votes[_partnerId]) : -1;

  return `
    <div class="chat-poll">
      <div class="chat-poll__q">📊 ${escapeHtml(m.question || "")}</div>
      <div class="chat-poll__choices">
        ${choices.map((c, i) => {
          const count = totals[i];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const youPicked = i === myChoice;
          const themPicked = i === partnerChoice;
          return `<button class="chat-poll__choice ${youPicked ? 'is-mine' : ''}"
                          data-idx="${i}" type="button">
            <span class="chat-poll__bar" style="width:${pct}%"></span>
            <span class="chat-poll__label">
              <span>${escapeHtml(c)}</span>
              <span class="chat-poll__pickers">
                ${youPicked ? '<span class="chat-poll__pin chat-poll__pin--mine" title="You">●</span>' : ''}
                ${themPicked ? '<span class="chat-poll__pin chat-poll__pin--theirs" title="Partner">●</span>' : ''}
              </span>
              <span class="chat-poll__pct">${pct}%</span>
            </span>
          </button>`;
        }).join("")}
      </div>
      <div class="chat-poll__total">${total} vote${total === 1 ? "" : "s"}</div>
    </div>
  `;
}

function openPollComposer() {
  if (!_chatId || !_partnerId) { toastWarn("Open the chat first"); return; }
  const wrap = document.createElement("div");
  wrap.className = "tc-modal";
  wrap.innerHTML = `
    <div class="tc-modal__panel" role="dialog" aria-modal="true" aria-label="New poll">
      <div class="tc-modal__head">New poll</div>
      <div class="tc-modal__body">
        <label class="tc-field">
          <span>Question</span>
          <input id="pollQ" type="text" maxlength="160" placeholder="Pizza or pasta tonight?">
        </label>
        <label class="tc-field"><span>Option 1</span><input id="pollC0" type="text" maxlength="60" placeholder="Pizza"></label>
        <label class="tc-field"><span>Option 2</span><input id="pollC1" type="text" maxlength="60" placeholder="Pasta"></label>
        <label class="tc-field"><span>Option 3 (optional)</span><input id="pollC2" type="text" maxlength="60" placeholder=""></label>
        <label class="tc-field"><span>Option 4 (optional)</span><input id="pollC3" type="text" maxlength="60" placeholder=""></label>
      </div>
      <div class="tc-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">Send poll</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const q  = wrap.querySelector("#pollQ").value.trim();
    const cs = [0,1,2,3].map(i => wrap.querySelector(`#pollC${i}`).value.trim()).filter(Boolean);
    if (!q || cs.length < 2) { toastWarn("Need a question and at least 2 options"); return; }
    const okBtn = wrap.querySelector('[data-act="ok"]');
    okBtn.disabled = true;
    await safe(() => sendPoll(_chatId, _partnerId, q, cs), "Couldn't send poll");
    close();
  });
  wrap.querySelector("#pollQ")?.focus();
}
