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
  sendPoll, votePoll,
  pinMessage, unpinMessage,
  editText, deleteMessage
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
let _replyingTo      = null;       // { id, text, sender, kind } when replying

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
      paintPinnedBar(meta?.pinnedMsgs || []);
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
            <div class="chat-listening" id="chatListening" hidden>
              <span class="chat-listening__dot"></span>
              <span class="chat-listening__icon">🎵</span>
              <span class="chat-listening__txt">listening</span>
            </div>
            <div class="chat-mood-widget" id="chatMoodWidget" hidden>
              <span class="chat-mood-pair" id="chatMoodPair" aria-hidden="true"></span>
              <span class="chat-mood-label" id="chatMoodLabel">Moods syncing…</span>
            </div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="chat-action" id="btnChatSearch" title="Search messages">🔍</button>
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

      <div class="chat-pinned" id="chatPinned" hidden></div>

      <div class="chat-search" id="chatSearch" hidden>
        <span class="chat-search__icon">🔍</span>
        <input class="chat-search__input" id="chatSearchInput" type="text" placeholder="Search messages…" autocomplete="off">
        <span class="chat-search__count" id="chatSearchCount"></span>
        <button class="chat-search__nav" id="chatSearchPrev" title="Previous match" aria-label="Previous match">↑</button>
        <button class="chat-search__nav" id="chatSearchNext" title="Next match" aria-label="Next match">↓</button>
        <button class="chat-search__close" id="chatSearchClose" aria-label="Close search">✕</button>
      </div>

      <div class="chat-stream" id="chatStream">${skeletonList(4, "msg")}</div>

      <div class="chat-typing" id="chatTyping"></div>

      <div class="chat-suggest" id="chatSuggest" hidden></div>

      <div class="chat-reply-preview" id="chatReplyPreview" hidden>
        <div class="chat-reply-preview__bar"></div>
        <div class="chat-reply-preview__body">
          <div class="chat-reply-preview__who" id="chatReplyWho">Replying to</div>
          <div class="chat-reply-preview__text" id="chatReplyText">…</div>
        </div>
        <button class="chat-reply-preview__close" id="chatReplyCancel" aria-label="Cancel reply">✕</button>
      </div>

      <footer class="chat-composer">
        <button class="composer-btn" id="btnEmoji"  title="Emoji">😊</button>
        <button class="composer-btn" id="btnPoll"   title="Send a poll">📊</button>
        <button class="composer-btn" id="btnImage"  title="Send a photo">📎</button>
        <input type="file" id="chatImageInput" accept="image/*" hidden>
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
  // Drive the now-listening pill regardless of online status
  paintListeningPill(partner?.activity);
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

function paintListeningPill(activity) {
  const pill = _container?.querySelector('#chatListening');
  if (!pill) return;
  const isListening = activity?.type === "listening";
  pill.hidden = !isListening;
  if (isListening) {
    const detail = String(activity.detail || "").trim();
    const txt = pill.querySelector('.chat-listening__txt');
    if (txt) txt.textContent = detail ? detail.slice(0, 60) : "listening together";
  }
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
      body = renderVoiceNote(m);
    } else if (m.image) {
      body = `<img class="chat-image" src="${m.image}" alt="">`;
    } else {
      body = escapeHtml(m.text || '');
    }
    const quote = m.replyTo ? renderReplyQuote(m.replyTo) : '';
    html += `
      <div class="chat-row ${mine ? 'mine' : 'theirs'}" data-id="${m.id}">
        <div class="chat-bubble">
          ${quote}
          <div class="chat-text">${body}</div>
          <div class="chat-meta">
            <span class="chat-time">${time}${m.editedAt ? ' · edited' : ''}</span>
            ${mine ? renderTicks(m, _myUid) : ''}
          </div>
          ${reactions}
        </div>
      </div>`;
  }
  stream.innerHTML = html;
  stream.scrollTop = stream.scrollHeight;

  // If chat search is active, re-apply highlights after re-render
  const searchInput = _container?.querySelector('#chatSearchInput');
  const searchSlot  = _container?.querySelector('#chatSearch');
  if (searchInput && searchSlot && !searchSlot.hidden && searchInput.value) {
    runSearch(searchInput.value);
  }

  // Double-tap = quick ❤️ shortcut. Long-press / right-click opens the picker.
  stream.querySelectorAll('.chat-row').forEach((row) => {
    row.addEventListener('dblclick', () => {
      const id = row.dataset.id;
      toggleReaction(_chatId, id, '❤️').catch(() => {});
    });
    attachLongPressPicker(row);
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

  // Voice notes — wire each waveform player
  stream.querySelectorAll('.chat-vn').forEach((node) => attachVoiceNoteHandlers(node));
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
    if (!themePop.hidden) closeSearch();
  };

  // Chat search toggle
  const searchBtn   = _container.querySelector('#btnChatSearch');
  const searchSlot  = _container.querySelector('#chatSearch');
  const searchInput = _container.querySelector('#chatSearchInput');
  const searchClose = _container.querySelector('#chatSearchClose');
  searchBtn.onclick = (e) => {
    e.stopPropagation();
    if (searchSlot.hidden) openSearch();
    else closeSearch();
  };
  searchClose.onclick = (e) => { e.preventDefault(); closeSearch(); };
  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape')      { e.preventDefault(); closeSearch(); }
    else if (e.key === 'Enter')  {
      e.preventDefault();
      gotoSearchMatch(e.shiftKey ? -1 : +1);
    }
  });
  _container.querySelector('#chatSearchPrev').onclick = () => gotoSearchMatch(-1);
  _container.querySelector('#chatSearchNext').onclick = () => gotoSearchMatch(+1);
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
    safe(() => sendText(_chatId, _partnerId, text, _replyingTo), "Couldn't send");
    input.value = '';
    setTyping(_chatId, false);
    clearReply();
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

  emoji.onclick = (e) => {
    e.stopPropagation();
    showEmojiGrid(emoji, input);
  };

  // Poll composer
  _container.querySelector('#btnPoll').onclick = () => openPollComposer();

  // Image attachments — button, paste, drag-and-drop
  const imgBtn   = _container.querySelector('#btnImage');
  const imgInput = _container.querySelector('#chatImageInput');
  imgBtn?.addEventListener('click', () => imgInput?.click());
  imgInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) uploadAndSendImage(f);
  });
  // Paste an image directly into the composer
  input.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          uploadAndSendImage(f);
          return;
        }
      }
    }
  });
  // Drag-and-drop anywhere on the chat page
  const page = _container.querySelector('.chat-page');
  if (page) {
    let dragDepth = 0;
    page.addEventListener('dragenter', (e) => {
      if (!hasImageFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      page.classList.add('is-dropping');
    });
    page.addEventListener('dragover', (e) => {
      if (hasImageFiles(e)) { e.preventDefault(); }
    });
    page.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) page.classList.remove('is-dropping');
    });
    page.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
      dragDepth = 0;
      page.classList.remove('is-dropping');
      if (!f) return;
      e.preventDefault();
      uploadAndSendImage(f);
    });
  }

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


// =====================================================================
// Long-press reaction picker — 6 emojis above the bubble.
// =====================================================================
const REACTION_PALETTE = ["❤️", "🥰", "😂", "😮", "😢", "🔥"];
const LONG_PRESS_MS = 420;

function attachLongPressPicker(row) {
  let timer = null;
  let suppressClick = false;

  const start = (e) => {
    if (e.target.closest(".chat-poll__choice")) return; // don't intercept poll votes
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      showReactionPicker(row);
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  row.addEventListener("touchstart", start, { passive: true });
  row.addEventListener("touchend",   cancel);
  row.addEventListener("touchcancel",cancel);
  row.addEventListener("touchmove",  cancel);

  row.addEventListener("mousedown",  (e) => { if (e.button === 0) start(e); });
  row.addEventListener("mouseup",    cancel);
  row.addEventListener("mouseleave", cancel);

  // Right-click also opens the picker (desktop convenience)
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showReactionPicker(row);
  });

  // Swallow the synthetic click that follows a long-press on touch
  row.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
}

function showReactionPicker(row) {
  // Remove any existing picker
  document.querySelectorAll(".chat-rxn-picker").forEach((el) => el.remove());

  const id = row?.dataset.id;
  if (!id) return;
  const msg = _lastMsgs.find((x) => x.id === id);
  const isMine = msg?.sender === _myUid;
  const bubble = row.querySelector(".chat-bubble");
  const rect = (bubble || row).getBoundingClientRect();

  const picker = document.createElement("div");
  picker.className = "chat-rxn-picker";
  picker.innerHTML = REACTION_PALETTE.map(e => `
    <button class="chat-rxn-picker__btn" data-e="${e}" type="button" aria-label="${e}">${e}</button>
  `).join("") + `
    <button class="chat-rxn-picker__btn chat-rxn-picker__btn--reply" data-act="reply" type="button" aria-label="Reply">↩</button>
    <button class="chat-rxn-picker__btn chat-rxn-picker__btn--pin"   data-act="pin"   type="button" aria-label="Pin">📌</button>
    ${isMine && msg?.kind !== "poll" && !msg?.audio && !msg?.image
      ? `<button class="chat-rxn-picker__btn chat-rxn-picker__btn--edit" data-act="edit" type="button" aria-label="Edit">✏️</button>`
      : ""
    }
    ${isMine
      ? `<button class="chat-rxn-picker__btn chat-rxn-picker__btn--del"  data-act="del"  type="button" aria-label="Delete">🗑</button>`
      : ""
    }
  `;
  document.body.appendChild(picker);

  // Position above the bubble (or below if there's no room above)
  const ph = picker.offsetHeight || 50;
  let top = rect.top + window.scrollY - ph - 10;
  if (top < window.scrollY + 8) top = rect.bottom + window.scrollY + 10;
  let left = rect.left + window.scrollX + (rect.width / 2) - (picker.offsetWidth / 2);
  left = Math.max(8, Math.min(window.innerWidth - picker.offsetWidth - 8, left));
  picker.style.top  = `${top}px`;
  picker.style.left = `${left}px`;

  // Animate in
  requestAnimationFrame(() => picker.classList.add("is-open"));

  // Tap an emoji → toggle reaction
  picker.querySelectorAll(".chat-rxn-picker__btn").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.dataset.act === "reply") {
        startReply(id);
      } else if (b.dataset.act === "pin") {
        togglePin(id);
      } else if (b.dataset.act === "edit") {
        openEditMessageModal(id);
      } else if (b.dataset.act === "del") {
        openDeleteMessageModal(id);
      } else {
        const emoji = b.dataset.e;
        toggleReaction(_chatId, id, emoji).catch(() => {});
      }
      picker.remove();
    });
  });

  // Close on outside click / scroll / escape
  const close = () => { try { picker.remove(); } catch {} cleanup(); };
  function cleanup() {
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("scroll", close, true);
    document.removeEventListener("keydown", onEsc, true);
  }
  function onOutside(ev) { if (!picker.contains(ev.target)) close(); }
  function onEsc(ev)     { if (ev.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("click", onOutside, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onEsc, true);
  }, 0);
}


// =====================================================================
// Emoji grid composer — 24 hearts/moods/scenes split into 3 rows.
// =====================================================================
const EMOJI_GRID = [
  // Hearts row
  "💜","💖","🥰","😘","😍","😻","🫶","💋",
  // Moods row
  "🥺","😭","🥹","🤗","😴","🌙","✨","🔥",
  // Vibes / scenes row
  "🌸","🌹","☕","🍷","🌧","🌅","🎵","🎬",
];

function showEmojiGrid(anchorBtn, input) {
  document.querySelectorAll(".chat-emoji-grid").forEach((el) => el.remove());

  const grid = document.createElement("div");
  grid.className = "chat-emoji-grid";
  grid.innerHTML = EMOJI_GRID.map(e => `
    <button class="chat-emoji-grid__btn" data-e="${e}" type="button" aria-label="${e}">${e}</button>
  `).join("");
  document.body.appendChild(grid);

  // Position above the anchor button, centered horizontally
  const r = anchorBtn.getBoundingClientRect();
  const gw = grid.offsetWidth;
  const gh = grid.offsetHeight;
  let top = r.top + window.scrollY - gh - 10;
  if (top < window.scrollY + 8) top = r.bottom + window.scrollY + 10;
  let left = r.left + window.scrollX + (r.width / 2) - (gw / 2);
  left = Math.max(8, Math.min(window.innerWidth - gw - 8, left));
  grid.style.top  = `${top}px`;
  grid.style.left = `${left}px`;

  requestAnimationFrame(() => grid.classList.add("is-open"));

  // Tap an emoji to insert at cursor (or append). Keeps grid open if Shift held
  // — quick way to type a string of emojis.
  grid.querySelectorAll(".chat-emoji-grid__btn").forEach((b) => {
    b.addEventListener("click", (ev) => {
      const e = b.dataset.e;
      insertAtCursor(input, e);
      input.focus();
      if (!ev.shiftKey) close();
    });
  });

  // Outside click / scroll / Escape
  function close() { try { grid.remove(); } catch {} cleanup(); }
  function cleanup() {
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("scroll", close, true);
    document.removeEventListener("keydown", onEsc, true);
  }
  function onOutside(ev) {
    if (grid.contains(ev.target) || anchorBtn.contains(ev.target)) return;
    close();
  }
  function onEsc(ev) { if (ev.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("click", onOutside, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onEsc, true);
  }, 0);
}

function insertAtCursor(input, text) {
  if (typeof input.selectionStart === "number") {
    const start = input.selectionStart;
    const end   = input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + text.length;
  } else {
    input.value += text;
  }
}


// =====================================================================
// Voice notes — custom waveform player.
// Deterministic faux-waveform derived from the message id so each note
// looks unique but stable across re-renders. A single hidden HTMLAudioElement
// is created lazily per node; no native <audio controls> chrome.
// =====================================================================
const VN_BAR_COUNT = 32;
let _vnActive = null;       // currently playing audio element
let _vnRafs   = new WeakMap();

function renderVoiceNote(m) {
  const id  = m.id || "x";
  const url = String(m.audio || "");
  const bars = generateFauxBars(id, VN_BAR_COUNT);
  return `
    <div class="chat-vn" data-src="${escapeAttr(url)}">
      <button class="chat-vn__play" data-act="toggle" type="button" aria-label="Play voice note">▶</button>
      <div class="chat-vn__bars">
        ${bars.map(h => `<span class="chat-vn__bar" style="height:${h}%"></span>`).join("")}
      </div>
      <span class="chat-vn__time">0:00</span>
    </div>
  `;
}

function generateFauxBars(seedStr, count) {
  // Lightweight LCG seeded by id — deterministic, enough variation for a
  // bar chart that doesn't all look the same height.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bars = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h, 1103515245) + 12345; h = h >>> 0;
    const v = (h % 1000) / 1000;
    // Bell-ish curve: lower at edges, taller in middle so it reads "voice"
    const t = i / (count - 1);
    const env = 1 - Math.abs(t - 0.5) * 1.5;
    const height = 18 + v * 70 * Math.max(.35, env);
    bars.push(Math.max(8, Math.min(95, height)));
  }
  return bars;
}

function attachVoiceNoteHandlers(node) {
  const playBtn = node.querySelector('.chat-vn__play');
  const timeEl  = node.querySelector('.chat-vn__time');
  const barsEl  = node.querySelector('.chat-vn__bars');
  const src     = node.dataset.src;
  let audio = null;

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(src);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      timeEl.textContent = fmtTime(audio.duration || 0);
    });
    audio.addEventListener("ended", () => {
      playBtn.textContent = "▶";
      node.classList.remove("is-playing");
      timeEl.textContent = fmtTime(audio.duration || 0);
      stopRaf();
      if (_vnActive === audio) _vnActive = null;
    });
    return audio;
  }

  function startRaf() {
    let last = 0;
    function tick() {
      if (!audio || audio.paused) return;
      const now = performance.now();
      if (now - last > 100) {
        last = now;
        const cur = audio.currentTime || 0;
        const dur = audio.duration || 0;
        timeEl.textContent = fmtTime(cur);
        const pct = dur > 0 ? cur / dur : 0;
        const bars = barsEl.querySelectorAll('.chat-vn__bar');
        const upTo = Math.floor(bars.length * pct);
        bars.forEach((b, i) => b.classList.toggle('is-played', i < upTo));
      }
      const id = requestAnimationFrame(tick);
      _vnRafs.set(node, id);
    }
    const id = requestAnimationFrame(tick);
    _vnRafs.set(node, id);
  }
  function stopRaf() {
    const id = _vnRafs.get(node);
    if (id) { cancelAnimationFrame(id); _vnRafs.delete(node); }
  }

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ensureAudio();
    // Pause any other voice note currently playing
    if (_vnActive && _vnActive !== audio) {
      try { _vnActive.pause(); } catch {}
    }
    if (audio.paused) {
      audio.play().then(() => {
        _vnActive = audio;
        playBtn.textContent = "⏸";
        node.classList.add("is-playing");
        startRaf();
      }).catch(() => {});
    } else {
      audio.pause();
      playBtn.textContent = "▶";
      node.classList.remove("is-playing");
      stopRaf();
    }
  });

  // Tap anywhere on the bars to seek
  barsEl.addEventListener("click", (e) => {
    e.stopPropagation();
    ensureAudio();
    const rect = barsEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = pct * audio.duration;
  });
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


// =====================================================================
// Reply-to message — long-press picker offers Reply, composer shows
// a quote preview, sender writes replyTo into the message doc.
// =====================================================================
function startReply(msgId) {
  const msg = _lastMsgs.find((x) => x.id === msgId);
  if (!msg) return;
  _replyingTo = {
    id:     msgId,
    text:   String(msg.text || (msg.kind === "poll" ? `📊 ${msg.question || "Poll"}` : msg.audio ? "🎙 Voice note" : msg.image ? "📷 Photo" : "")).slice(0, 240),
    sender: String(msg.sender || ""),
    kind:   String(msg.kind || (msg.audio ? "audio" : msg.image ? "image" : "text")),
  };
  paintReplyPreview();
  const input = _container?.querySelector('#composerInput');
  if (input) input.focus();
}
function clearReply() {
  _replyingTo = null;
  paintReplyPreview();
}
function paintReplyPreview() {
  const slot = _container?.querySelector('#chatReplyPreview');
  if (!slot) return;
  if (!_replyingTo) { slot.hidden = true; return; }
  slot.hidden = false;
  const whoEl  = _container.querySelector('#chatReplyWho');
  const textEl = _container.querySelector('#chatReplyText');
  const isMine = _replyingTo.sender === _myUid;
  if (whoEl)  whoEl.textContent  = `Replying to ${isMine ? "yourself" : _partnerName}`;
  if (textEl) textEl.textContent = _replyingTo.text || "(media)";
  const cancel = _container.querySelector('#chatReplyCancel');
  if (cancel) cancel.onclick = (e) => { e.preventDefault(); clearReply(); };
}

function renderReplyQuote(rt) {
  const isMine = rt.sender === _myUid;
  return `
    <div class="chat-quote" data-jump="${escapeAttr(rt.id || '')}">
      <span class="chat-quote__bar"></span>
      <span class="chat-quote__body">
        <span class="chat-quote__who">${isMine ? "You" : escapeHtml(_partnerName || "Them")}</span>
        <span class="chat-quote__text">${escapeHtml(rt.text || (rt.kind === "audio" ? "🎙 Voice note" : rt.kind === "image" ? "📷 Photo" : ""))}</span>
      </span>
    </div>
  `;
}

// Click on a quote inside a bubble to scroll the original message into view.
document.addEventListener("click", (e) => {
  const q = e.target.closest?.(".chat-quote");
  if (!q) return;
  const id = q.dataset.jump;
  if (!id) return;
  const stream = _container?.querySelector('#chatStream');
  const target = stream?.querySelector(`.chat-row[data-id="${CSS.escape(id)}"]`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-flash");
    setTimeout(() => target.classList.remove("is-flash"), 900);
  }
}, true);


// =====================================================================
// Pinned messages — bar at the top of the chat that surfaces up to 3
// pinned snapshots. Tap a pinned row to scroll to the original message.
// =====================================================================
let _pinnedSnapshots = [];

async function togglePin(msgId) {
  const msg = _lastMsgs.find((x) => x.id === msgId);
  if (!msg) return;
  // Already pinned? Find a matching snapshot and unpin it.
  const existing = _pinnedSnapshots.find((p) => p.id === msgId);
  if (existing) {
    await safe(() => unpinMessage(_chatId, existing), "Couldn't unpin");
    toast("Unpinned");
    return;
  }
  if (_pinnedSnapshots.length >= 5) {
    toastWarn("Already 5 messages pinned. Unpin one first.");
    return;
  }
  const snapshot = {
    id:     msgId,
    text:   String(msg.text || (msg.kind === "poll" ? `📊 ${msg.question || "Poll"}` : msg.audio ? "🎙 Voice note" : msg.image ? "📷 Photo" : "")).slice(0, 240),
    sender: String(msg.sender || ""),
    kind:   String(msg.kind || (msg.audio ? "audio" : msg.image ? "image" : "text")),
  };
  await safe(() => pinMessage(_chatId, snapshot), "Couldn't pin");
  toastSuccess("Pinned 📌");
}

function paintPinnedBar(pinnedMsgs) {
  _pinnedSnapshots = Array.isArray(pinnedMsgs) ? pinnedMsgs.slice(-3) : [];
  const host = _container?.querySelector('#chatPinned');
  if (!host) return;
  if (!_pinnedSnapshots.length) { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;
  host.innerHTML = `
    <div class="chat-pinned__head">
      <span class="chat-pinned__icon">📌</span>
      <span class="chat-pinned__title">Pinned · ${_pinnedSnapshots.length}</span>
    </div>
    ${_pinnedSnapshots.map((p) => {
      const isMine = p.sender === _myUid;
      const previewTxt = p.text || (p.kind === "audio" ? "🎙 Voice note" : p.kind === "image" ? "📷 Photo" : "(media)");
      return `<button class="chat-pinned__row" data-jump="${escapeAttr(p.id)}" type="button">
        <span class="chat-pinned__bar"></span>
        <span class="chat-pinned__body">
          <span class="chat-pinned__who">${isMine ? "You" : escapeHtml(_partnerName || "Them")}</span>
          <span class="chat-pinned__text">${escapeHtml(previewTxt)}</span>
        </span>
        <span class="chat-pinned__unpin" data-unpin="${escapeAttr(p.id)}" title="Unpin" aria-label="Unpin">✕</span>
      </button>`;
    }).join("")}
  `;
  // Wire jump + unpin
  host.querySelectorAll('.chat-pinned__row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const unpinTarget = e.target.closest('[data-unpin]');
      if (unpinTarget) {
        e.stopPropagation();
        const id = unpinTarget.dataset.unpin;
        const snap = _pinnedSnapshots.find((p) => p.id === id);
        if (snap) safe(() => unpinMessage(_chatId, snap), "Couldn't unpin");
        return;
      }
      const id = row.dataset.jump;
      const stream = _container?.querySelector('#chatStream');
      const target = stream?.querySelector(`.chat-row[data-id="${CSS.escape(id)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("is-flash");
        setTimeout(() => target.classList.remove("is-flash"), 900);
      }
    });
  });
}


// =====================================================================
// In-chat search — filters _lastMsgs against the query, highlights the
// matching bubbles, lets you cycle through with ↑/↓ or Enter/Shift+Enter.
// =====================================================================
let _searchMatches = [];   // ordered array of message ids
let _searchPos     = -1;

function openSearch() {
  const slot  = _container?.querySelector('#chatSearch');
  const input = _container?.querySelector('#chatSearchInput');
  if (!slot || !input) return;
  slot.hidden = false;
  input.value = "";
  runSearch("");
  setTimeout(() => input.focus(), 30);
}
function closeSearch() {
  const slot = _container?.querySelector('#chatSearch');
  if (!slot) return;
  slot.hidden = true;
  clearSearchHighlights();
  _searchMatches = []; _searchPos = -1;
}

function runSearch(qRaw) {
  const q = String(qRaw || "").trim().toLowerCase();
  const stream = _container?.querySelector('#chatStream');
  const countEl = _container?.querySelector('#chatSearchCount');
  if (!stream) return;
  clearSearchHighlights();
  if (!q) {
    _searchMatches = []; _searchPos = -1;
    if (countEl) countEl.textContent = "";
    return;
  }
  // Match against rendered messages by id; scan _lastMsgs for searchable text
  const ids = [];
  for (const m of _lastMsgs) {
    const hay = matchableText(m).toLowerCase();
    if (hay.includes(q)) ids.push(m.id);
  }
  _searchMatches = ids;
  _searchPos = ids.length ? 0 : -1;

  // Highlight all matching rows
  for (const id of ids) {
    const row = stream.querySelector(`.chat-row[data-id="${CSS.escape(id)}"]`);
    if (row) row.classList.add("is-search-match");
  }
  if (countEl) countEl.textContent = ids.length ? `${_searchPos + 1} / ${ids.length}` : "0 / 0";
  if (_searchPos >= 0) scrollToMatch(_searchPos);
}

function matchableText(m) {
  if (!m) return "";
  if (m.kind === "poll") {
    return [m.question || "", ...(m.choices || [])].join(" ");
  }
  if (m.replyTo?.text) return `${m.text || ""} ${m.replyTo.text}`;
  return m.text || "";
}

function gotoSearchMatch(dir) {
  if (!_searchMatches.length) return;
  _searchPos = (_searchPos + dir + _searchMatches.length) % _searchMatches.length;
  const countEl = _container?.querySelector('#chatSearchCount');
  if (countEl) countEl.textContent = `${_searchPos + 1} / ${_searchMatches.length}`;
  scrollToMatch(_searchPos);
}

function scrollToMatch(pos) {
  const id = _searchMatches[pos];
  const stream = _container?.querySelector('#chatStream');
  const target = stream?.querySelector(`.chat-row[data-id="${CSS.escape(id)}"]`);
  if (!target) return;
  // Clear previous "current" mark, set new one
  stream.querySelectorAll(".chat-row.is-search-current").forEach((r) =>
    r.classList.remove("is-search-current"));
  target.classList.add("is-search-current");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearSearchHighlights() {
  const stream = _container?.querySelector('#chatStream');
  if (!stream) return;
  stream.querySelectorAll(".chat-row.is-search-match")
        .forEach((r) => r.classList.remove("is-search-match"));
  stream.querySelectorAll(".chat-row.is-search-current")
        .forEach((r) => r.classList.remove("is-search-current"));
}


// =====================================================================
// Edit / delete a message — only your own.
// =====================================================================
function openEditMessageModal(msgId) {
  const msg = _lastMsgs.find((x) => x.id === msgId);
  if (!msg) return;
  if (msg.sender !== _myUid) return;
  const cur = String(msg.text || "");

  const wrap = document.createElement("div");
  wrap.className = "tc-modal";
  wrap.innerHTML = `
    <div class="tc-modal__panel" role="dialog" aria-modal="true" aria-label="Edit message">
      <div class="tc-modal__head">Edit message</div>
      <div class="tc-modal__body">
        <textarea id="editMsgInput" rows="4" maxlength="2000" placeholder="Edit your message…"></textarea>
        <p class="tc-fineprint">Edits show an "edited" tag next to the time.</p>
      </div>
      <div class="tc-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const ta = wrap.querySelector("#editMsgInput");
  ta.value = cur; ta.focus(); ta.setSelectionRange(cur.length, cur.length);

  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const v = ta.value.trim();
    if (!v) { toastWarn("Type something"); return; }
    if (v === cur) { close(); return; }
    const okBtn = wrap.querySelector('[data-act="ok"]');
    okBtn.disabled = true;
    await safe(() => editText(_chatId, msgId, v), "Couldn't update");
    close();
  });
}

function openDeleteMessageModal(msgId) {
  const msg = _lastMsgs.find((x) => x.id === msgId);
  if (!msg) return;
  if (msg.sender !== _myUid) return;

  const wrap = document.createElement("div");
  wrap.className = "tc-modal";
  wrap.innerHTML = `
    <div class="tc-modal__panel" role="dialog" aria-modal="true" aria-label="Delete message">
      <div class="tc-modal__head">Delete this message?</div>
      <div class="tc-modal__body">
        <p>It will disappear for both of you. There's no undo.</p>
      </div>
      <div class="tc-modal__actions">
        <button class="btn btn-ghost"  data-act="cancel">Cancel</button>
        <button class="btn btn-danger" data-act="ok">Delete</button>
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
    await safe(() => deleteMessage(_chatId, msgId), "Couldn't delete");
    toast("Message deleted");
    close();
  });
}


// =====================================================================
// Image attachments — button / paste / drag-drop. Uploads to storage,
// falls back to base64 for tiny pastes, then writes a chat message
// with image: url.
// =====================================================================
function hasImageFiles(e) {
  const items = e.dataTransfer?.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type?.startsWith('image/')) return true;
  }
  return false;
}

async function uploadAndSendImage(file) {
  if (!_chatId || !_partnerId || !_myUid || !file) return;
  if (!file.type.startsWith('image/')) { toastWarn("That isn't an image"); return; }
  if (file.size > 8 * 1024 * 1024)     { toastWarn("Image too big — under 8 MB please"); return; }

  toast("Uploading photo…");
  let url = null;
  try {
    if (storage) {
      const { ref, uploadBytes, getDownloadURL } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
      const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().slice(0, 5);
      const path = `chatImages/${_chatId}/${Date.now()}_${_myUid}.${ext}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file, { contentType: file.type || 'image/jpeg' });
      url = await getDownloadURL(fileRef);
    }
  } catch (e) {
    console.warn('[chat] image upload failed, trying base64 fallback', e);
  }
  if (!url) {
    if (file.size > 256 * 1024) { toastError("Couldn't upload photo"); return; }
    url = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload  = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  const { collection, doc, writeBatch, serverTimestamp, increment } =
    await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  const batch = writeBatch(db);
  const msgRef  = doc(collection(db, 'chats', _chatId, 'messages'));
  const chatRef = doc(db, 'chats', _chatId);
  batch.set(msgRef, {
    image: url, sender: _myUid, time: serverTimestamp(),
    status: 'sent', deliveredAt: null, seenAt: null, reactions: {}
  });
  batch.update(chatRef, {
    lastMessage:        '📷 Photo',
    lastMessageTime:    serverTimestamp(),
    lastMessageSender:  _myUid,
    [`unread.${_partnerId}`]: increment(1),
    [`unread.${_myUid}`]:     0,
    [`typing.${_myUid}`]:     false,
  });
  await batch.commit();
}
