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
  markDeliveredAndSeen, toggleReaction, subscribeChatMeta, renderTicks
} from '../services/chatService.js';
import { rememberMessage, suggestReplies } from '../services/aiReply.js';
import { gateVoiceNote } from '../services/featureGate.js';
import { startVideoCall, startAudioCall } from './callView.js';

let _container       = null;
let _offState        = null;
let _unsubMessages   = null;
let _unsubMeta       = null;
let _typingDebounce  = null;
let _suggestDebounce = null;
let _chatId          = null;
let _myUid           = null;
let _partnerId       = null;
let _partnerName     = "Partner";
let _partnerPhoto    = null;
let _lastRenderedFor = null;       // (myUid|partnerId) we built the shell for
let _lastMsgs        = [];

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
  clearTimeout(_typingDebounce);
  clearTimeout(_suggestDebounce);
  _offState = _unsubMessages = _unsubMeta = null;
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
          </div>
        </div>
        <div class="chat-actions">
          <button class="chat-action" id="btnAudioCall" title="Voice call">📞</button>
          <button class="chat-action" id="btnVideoCall" title="Video call">📹</button>
        </div>
      </header>

      <div class="chat-stream" id="chatStream">${skeletonList(4, "msg")}</div>

      <div class="chat-typing" id="chatTyping"></div>

      <div class="chat-suggest" id="chatSuggest" hidden></div>

      <footer class="chat-composer">
        <button class="composer-btn" id="btnEmoji"  title="Emoji">😊</button>
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
    if (m.audio) {
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
