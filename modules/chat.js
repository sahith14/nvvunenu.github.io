// =====================================================================
// modules/chat.js — Real-time couple chat UI.
// Uses services/chatService.js (already built: batched writes, ticks,
// reactions, typing, paginated history).
// Adds: voice notes via MediaRecorder + Firebase Storage URL stored in msg.
// =====================================================================
import { db, auth, storage } from '../firebase.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  ensureChat, subscribeMessages, sendText, setTyping,
  markDeliveredAndSeen, toggleReaction, subscribeChatMeta, renderTicks
} from '../services/chatService.js';
import { startVideoCall, startAudioCall } from './callView.js';

let unsubMessages = null;
let unsubMeta     = null;
let chatId        = null;
let partnerId     = null;
let myUid         = null;
let currentMsgs   = [];

export async function renderChat(container) {
  myUid = auth.currentUser?.uid;
  if (!myUid) return;

  // resolve partner
  const meSnap = await getDoc(doc(db, 'users', myUid)).catch(() => null);
  partnerId = meSnap?.data()?.partnerID || meSnap?.data()?.partnerId || null;

  if (!partnerId) {
    container.innerHTML = `
      <div class="chat-empty stagger">
        <div class="chat-empty-orb"></div>
        <h2>Chat with your partner 💜</h2>
        <p>Link your partner first using their invite code.</p>
        <button class="btn btn-primary" onclick="loadPage('profile')">Go to Profile</button>
      </div>`;
    return;
  }

  const partnerSnap = await getDoc(doc(db, 'users', partnerId)).catch(() => null);
  const partnerName = partnerSnap?.data()?.displayName?.split(' ')[0] || 'Partner';
  const partnerPhoto = partnerSnap?.data()?.photoURL;
  chatId = await ensureChat(myUid, partnerId);

  container.innerHTML = `
    <div class="chat-page">
      <header class="chat-header">
        <div class="chat-peer">
          <div class="chat-peer-avatar">${partnerPhoto ? `<img src="${partnerPhoto}" alt="">` : '💜'}</div>
          <div class="chat-peer-info">
            <div class="chat-peer-name">${partnerName}</div>
            <div class="chat-peer-status" id="chatPeerStatus">…</div>
          </div>
        </div>
        <div class="chat-actions">
          <button class="chat-action" id="btnAudioCall" title="Voice call">📞</button>
          <button class="chat-action" id="btnVideoCall" title="Video call">📹</button>
        </div>
      </header>

      <div class="chat-stream" id="chatStream"></div>

      <div class="chat-typing" id="chatTyping"></div>

      <footer class="chat-composer">
        <button class="composer-btn" id="btnEmoji"  title="Emoji">😊</button>
        <input class="composer-input" id="composerInput" placeholder="Write something sweet…" autocomplete="off">
        <button class="composer-btn" id="btnVoice"  title="Hold to record voice note">🎙️</button>
        <button class="composer-send" id="btnSend"  title="Send">➤</button>
      </footer>
    </div>
  `;

  attachChatHandlers(partnerName);

  // subscribe
  unsubMessages = subscribeMessages(chatId, (msgs) => {
    currentMsgs = msgs;
    renderMessages(msgs);
    markDeliveredAndSeen(chatId, msgs).catch(() => {});
  });

  unsubMeta = subscribeChatMeta(chatId, (meta) => {
    const typing = meta.typing?.[partnerId];
    const tEl = document.getElementById('chatTyping');
    if (tEl) tEl.textContent = typing ? `${partnerName} is typing…` : '';
    const status = document.getElementById('chatPeerStatus');
    if (status) status.textContent = (partnerSnap?.data()?.status?.online) ? 'Online 💚' : 'Offline';
  });
}

export function teardownChat() {
  unsubMessages?.(); unsubMessages = null;
  unsubMeta?.();     unsubMeta     = null;
}

// =========================================================================
// RENDER
// =========================================================================
function renderMessages(msgs) {
  const stream = document.getElementById('chatStream');
  if (!stream) return;
  if (!msgs.length) {
    stream.innerHTML = `<div class="chat-blank">Say hi 💜</div>`;
    return;
  }
  let html = '';
  let lastDay = '';
  for (const m of msgs) {
    const ts  = m.time?.toDate?.() || new Date();
    const day = ts.toDateString();
    if (day !== lastDay) {
      html += `<div class="chat-divider"><span>${formatDay(ts)}</span></div>`;
      lastDay = day;
    }
    const mine = m.sender === myUid;
    const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const reactions = renderReactions(m);
    let body;
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
            ${mine ? renderTicks(m, myUid) : ''}
          </div>
          ${reactions}
        </div>
      </div>`;
  }
  stream.innerHTML = html;
  stream.scrollTop = stream.scrollHeight;

  // double-tap to react
  stream.querySelectorAll('.chat-row').forEach((row) => {
    row.addEventListener('dblclick', () => {
      const id = row.dataset.id;
      toggleReaction(chatId, id, '❤️').catch(() => {});
    });
  });
}

function renderReactions(msg) {
  const r = msg.reactions || {};
  const entries = Object.entries(r);
  if (!entries.length) return '';
  return `<div class="chat-reactions">${entries.map(([_, e]) => `<span>${e}</span>`).join('')}</div>`;
}

function formatDay(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);
  const target = new Date(d); target.setHours(0,0,0,0);
  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === yest.getTime())  return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// =========================================================================
// HANDLERS
// =========================================================================
function attachChatHandlers(partnerName) {
  const input = document.getElementById('composerInput');
  const send  = document.getElementById('btnSend');
  const voice = document.getElementById('btnVoice');
  const emoji = document.getElementById('btnEmoji');
  const audioCallBtn = document.getElementById('btnAudioCall');
  const videoCallBtn = document.getElementById('btnVideoCall');

  audioCallBtn.onclick = () => startAudioCall(partnerId, partnerName);
  videoCallBtn.onclick = () => startVideoCall(partnerId, partnerName);

  // typing
  let typingTimer = null;
  input.addEventListener('input', () => {
    setTyping(chatId, true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(chatId, false), 1500);
  });

  function doSend() {
    const text = input.value.trim();
    if (!text) return;
    sendText(chatId, partnerId, text).catch(() => {});
    input.value = '';
    setTyping(chatId, false);
  }

  send.onclick = doSend;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });

  // emoji palette
  emoji.onclick = () => {
    const palette = ['💜','😘','🥰','😍','😂','🥺','🫶','💋','🌙','✨','🥹','🫨'];
    const pick = palette[Math.floor(Math.random() * palette.length)];
    input.value += pick;
    input.focus();
  };

  // voice note (hold to record)
  let mediaRecorder = null;
  let chunks = [];
  let pressTimer = null;

  const beginRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await uploadAndSendAudio(blob);
      };
      mediaRecorder.start();
      voice.classList.add('recording');
      window.showToast?.('Recording… release to send');
    } catch (e) {
      window.showToast?.('Mic permission denied');
    }
  };

  const endRecord = () => {
    voice.classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  };

  voice.addEventListener('mousedown', () => { pressTimer = setTimeout(beginRecord, 150); });
  voice.addEventListener('mouseup',   () => { clearTimeout(pressTimer); endRecord(); });
  voice.addEventListener('mouseleave',() => { clearTimeout(pressTimer); endRecord(); });
  voice.addEventListener('touchstart',(e) => { e.preventDefault(); pressTimer = setTimeout(beginRecord, 150); }, { passive: false });
  voice.addEventListener('touchend',  () => { clearTimeout(pressTimer); endRecord(); });
}

// =========================================================================
// VOICE NOTE UPLOAD (Firebase Storage if available, else inline base64)
// =========================================================================
async function uploadAndSendAudio(blob) {
  let url = null;
  try {
    if (storage) {
      const { ref, uploadBytes, getDownloadURL } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
      const path = `voicenotes/${chatId}/${Date.now()}_${myUid}.webm`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: 'audio/webm' });
      url = await getDownloadURL(fileRef);
    }
  } catch (e) {
    console.warn('[chat] storage upload failed, falling back to base64', e);
  }

  if (!url) {
    // fallback: base64 inline (small notes only)
    if (blob.size > 600 * 1024) {
      window.showToast?.('Voice note too large');
      return;
    }
    url = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blob);
    });
  }

  // store as message with `audio` field
  const { collection, doc, addDoc, updateDoc, writeBatch, serverTimestamp, increment } =
    await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

  const batch = writeBatch(db);
  const msgRef  = doc(collection(db, 'chats', chatId, 'messages'));
  const chatRef = doc(db, 'chats', chatId);
  batch.set(msgRef, {
    audio: url,
    sender: myUid,
    time: serverTimestamp(),
    status: 'sent',
    deliveredAt: null, seenAt: null, reactions: {}
  });
  batch.update(chatRef, {
    lastMessage:        '🎙️ Voice note',
    lastMessageTime:    serverTimestamp(),
    lastMessageSender:  myUid,
    [`unread.${partnerId}`]: increment(1),
    [`unread.${myUid}`]:     0
  });
  await batch.commit();
}
