import {
  getFirestore, collection, query, where, getDocs,
  addDoc, orderBy, onSnapshot, doc, getDoc, updateDoc, serverTimestamp, arrayUnion, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { db, auth } from "../firebase.js";

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

export function render() {
  loadDMList();

  return `
    <div class="ig-dm">

      <div class="ig-dm-list">
        <input id="dmSearchInput"
               class="dm-search"
               placeholder="Search"
               oninput="filterDMs()">

        <div id="dmList" class="dm-list"></div>
      </div>

      <div id="chatWindow" class="ig-chat hidden">

        <!-- EMPTY STATE -->
        <div id="chatEmptyState" class="ig-chat-empty">
          <div class="empty-icon">💬</div>
          <h3>Your messages</h3>
          <p>Select a chat to start a conversation</p>
        </div>

        <!-- CHAT HEADER -->
        <div id="chatHeader" class="ig-chat-header"></div>

        <div id="typingIndicator" class="typing-indicator hidden"></div>

        <!-- MESSAGES -->
        <div id="chatMessages" class="ig-chat-messages"></div>

        <!-- INPUT -->
        <div class="ig-chat-input">
          <input id="msgInput"
                 placeholder="Message..."
                 oninput="handleTyping()"
                 onkeydown="sendMessageOnEnter(event)">
          <button onclick="sendMessage()">➤</button>
        </div>
      </div>

      <!-- CALL OVERLAY -->
      <div id="callOverlay" class="call-overlay hidden">
        <div class="call-card">
          <img id="callAvatar" class="call-avatar" src="">
          <h3 id="callName">Calling...</h3>
          <p id="callStatus" class="call-status-text">Connecting...</p>
          <p id="callTimer" class="call-timer hidden">00:00</p>
          <div class="call-actions">
            <button class="call-action-btn mute-btn" onclick="toggleCallMute()" id="muteBtn"><i class="fas fa-microphone"></i></button>
            <button class="call-action-btn end-btn" onclick="endCall()"><i class="fas fa-phone-slash"></i></button>
            <button class="call-action-btn speaker-btn" onclick="toggleSpeaker()" id="speakerBtn"><i class="fas fa-volume-up"></i></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// LOAD DM LIST
// --------------------------------------------------------

async function loadDMList() {
  if (!auth.currentUser) return;
  
  let uid = auth.currentUser.uid;

  const q = query(
    collection(db, "chats"),
    where("members", "array-contains", uid),
    orderBy("lastMessageTime", "desc")
  );


  const snap = await getDocs(q);

  let dmListBox = document.getElementById("dmList");
  if (!dmListBox) return;

  let html = "";

  html = "";

  for (const docSnap of snap.docs) {
    const chat = docSnap.data();
    const unreadCount = chat.unread?.[auth.currentUser.uid] || 0;
    const otherUser = chat.members.find(m => m !== uid);

    // 🔑 FETCH REAL USER
    const userSnap = await getDoc(doc(db, "users", otherUser));
    const userData = userSnap.data();
    const isOnline = userData?.status?.online;

    const displayName =
      userData?.username ||
      userData?.email?.split("@")[0] ||
      "Unknown";

    const isOtherTyping = chat.typing?.[otherUser];
    const lastText = isOtherTyping
      ? "<em>Typing…</em>"
      : (chat.lastMessage || "");
    
    html += `
      <div class="dm-item glass"
           onclick="openChat('${docSnap.id}', '${otherUser}')">

        <div class="dm-avatar-wrap">
          <img class="dm-avatar"
               src="${userData?.photoURL || 'https://i.pravatar.cc/100?u=' + otherUser}">
          ${isOnline ? `<span class="online-dot"></span>` : ""}
        </div>

        <div class="dm-info">
          <p class="dm-user">${displayName}</p>
          <p class="dm-last">${lastText}</p>
        </div>

        ${unreadCount > 0 ? `
          <span class="dm-unread">${unreadCount}</span>
        ` : ""}
      </div>
    `;
  }
  dmListBox.innerHTML = html || `<p class='empty'>No messages yet</p>`;
}

window.filterDMs = function () {
  const input = document.getElementById("dmSearchInput");
  if (!input) return;

  const text = input.value.toLowerCase().trim();
  const items = document.querySelectorAll(".dm-item");

  items.forEach(item => {
    const userEl = item.querySelector(".dm-user");
    if (!userEl) return;

    const name = userEl.textContent.toLowerCase();
    item.style.display = name.includes(text) ? "flex" : "none";
  });
};

function renderSeen(msg) {
  // only show ticks for messages I sent
  if (msg.sender !== auth.currentUser.uid) return "";

  const otherUID = window.currentOther;

  if (msg.seenBy?.includes(otherUID)) {
    return `<span class="tick seen">✔✔</span>`;
  }

  if (msg.deliveredTo?.includes(otherUID)) {
    return `<span class="tick delivered">✔✔</span>`;
  }

  return `<span class="tick sent">✔</span>`;
}

// --------------------------------------------------------
// OPEN CHAT WINDOW
// --------------------------------------------------------

window.openChat = async function(chatId, otherUID) {
  const root = document.querySelector(".ig-dm");
  const chatWindow = document.getElementById("chatWindow");
  const emptyState = document.getElementById("chatEmptyState");

  if (!chatWindow || !root) return;

  // 🔑 THIS IS THE MISSING LINE (SLIDE IN)
  root.classList.add("chat-open");

  // show chat panel
  chatWindow.classList.remove("hidden");

  // hide empty state
  if (emptyState) emptyState.style.display = "none";

  const otherRef = doc(db, "users", otherUID);
  const otherSnap = await getDoc(otherRef);
  const other = otherSnap.data();

  document.getElementById("chatHeader").innerHTML = `
    <button class="dm-back" onclick="closeChat()">←</button>
    <img class="dm-avatar" src="${other.photoURL || 'https://i.pravatar.cc/100?u=' + otherUID}">
    <div class="dm-user-info">
      <p class="dm-username">${other.username}</p>
      <p id="userStatus" class="dm-status">Loading...</p>
    </div>
    <div class="chat-header-actions">
      <button class="call-btn" onclick="startVoiceCall()" title="Voice Call"><i class="fas fa-phone"></i></button>
      <button class="call-btn video" onclick="startVideoCall()" title="Video Call"><i class="fas fa-video"></i></button>
    </div>
  `;

  // reset unread count for me
  await updateDoc(doc(db, "chats", chatId), {
    [`unread.${auth.currentUser.uid}`]: 0
  });

  loadMessages(chatId);
  listenForTyping(chatId);
  listenUserStatus(otherUID);

  window.currentChat = chatId;
  window.currentOther = otherUID;
};

// --------------------------------------------------------
// LOAD MESSAGES REALTIME
// --------------------------------------------------------

let unsubscribeMessages;

function loadMessages(chatId) {
  unsubscribeMessages?.();

  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("time")
  );

  unsubscribeMessages = onSnapshot(q, (snap) => {
    let box = document.getElementById("chatMessages");
    let html = "";

    snap.forEach(docu => {
      const msg = docu.data();
        
      // MARK AS DELIVERED
      if (
        msg.sender !== auth.currentUser.uid &&
        !msg.deliveredTo?.includes(auth.currentUser.uid)
      ) {
        updateDoc(docu.ref, {
          deliveredTo: arrayUnion(auth.currentUser.uid)
        });
      }
      
      // MARK AS SEEN
      if (
        msg.sender !== auth.currentUser.uid &&
        !msg.seenBy?.includes(auth.currentUser.uid)
      ) {
        updateDoc(docu.ref, {
          seenBy: arrayUnion(auth.currentUser.uid)
        });
      }

      html += `
        <div class="msg ${msg.sender === auth.currentUser.uid ? 'me' : 'them'}">
          <p>${msg.text}</p>
          <span class="msg-time">
            ${msg.time?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          ${renderSeen(msg)}
        </div>
      `;
    });

    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  });
}

function renderReactions(reactions = {}) {
  return Object.values(reactions)
    .map(e => `<span class="reaction">${e}</span>`)
    .join("");
}

let longPressTimer;

window.handleLongPress = function (e, msgId) {
  longPressTimer = setTimeout(() => {
    openReactionPicker(e, msgId);
  }, 500);
};

window.openReactionPicker = function (e, msgId) {
  e.preventDefault();
  showReactionPopup(e.clientX, e.clientY, msgId);
};

function showReactionPopup(x, y, msgId) {
  removeReactionPopup();

  const popup = document.createElement("div");
  popup.id = "reactionPopup";
  popup.innerHTML = `
    <span onclick="react('${msgId}','❤️')">❤️</span>
    <span onclick="react('${msgId}','🔥')">🔥</span>
    <span onclick="react('${msgId}','😂')">😂</span>
    <span onclick="react('${msgId}','😮')">😮</span>
  `;

  popup.style.left = x + "px";
  popup.style.top = y + "px";

  document.body.appendChild(popup);
}

function removeReactionPopup() {
  document.getElementById("reactionPopup")?.remove();
}

document.addEventListener("click", removeReactionPopup);

window.react = async function (msgId, emoji) {
  const uid = auth.currentUser.uid;
  const ref = doc(db, "chats", window.currentChat, "messages", msgId);
  const snap = await getDoc(ref);

  const reactions = snap.data().reactions || {};

  if (reactions[uid] === emoji) {
    delete reactions[uid]; // toggle off
  } else {
    reactions[uid] = emoji;
  }

  await updateDoc(ref, { reactions });
};

// --------------------------------------------------------
// SEND MESSAGE
// --------------------------------------------------------

window.sendMessageOnEnter = (e) => {
  if (e.key === "Enter") sendMessage();
};

window.sendMessage = async function() {
  let input = document.getElementById("msgInput");

  const text = input.value.trim();
  if (!text) return;

  let chatId = window.currentChat;
  const otherUID = window.currentOther;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    text,
    sender: auth.currentUser.uid,  
    time: serverTimestamp(),

    // delivery states  
    deliveredTo: [auth.currentUser.uid],
    seenBy: [auth.currentUser.uid]  
  });

  // update last message
  const chatRef = doc(db, "chats", chatId);

  await updateDoc(chatRef, {
    lastMessage: text,
    lastMessageTime: serverTimestamp(),
    lastMessageSender: auth.currentUser.uid,
    [`unread.${otherUID}`]: increment(1),
    [`unread.${auth.currentUser.uid}`]: 0
  });
  
  input.value = "";
};

let typingTimeout;

window.handleTyping = function () {
  if (!window.currentChat) return;

  const chatRef = doc(db, "chats", window.currentChat);
  const uid = auth.currentUser.uid;

  updateDoc(chatRef, {
    [`typing.${uid}`]: true
  });

  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(() => {
    updateDoc(chatRef, {
      [`typing.${uid}`]: false
    });
  }, 1500);
};

function listenForTyping(chatId) {
  const chatRef = doc(db, "chats", chatId);
  const indicator = document.getElementById("typingIndicator");
  if (!indicator) return;

  onSnapshot(chatRef, snap => {
    const data = snap.data();
    if (!data?.typing) return;

    const otherUID = window.currentOther;

    if (data.typing[otherUID]) {
      indicator.classList.remove("hidden");
    } else {
      indicator.classList.add("hidden");
    }
  });
}

window.closeChat = function () {
  const root = document.querySelector(".ig-dm");
  const chat = document.getElementById("chatWindow");
  const emptyState = document.getElementById("chatEmptyState");

  if (!root || !chat) return;

  root.classList.remove("chat-open");
  chat.classList.add("hidden");

  if (emptyState) emptyState.style.display = "flex";
};

function listenUserStatus(otherUID) {
  const statusEl = document.getElementById("userStatus");
  if (!statusEl) return;

  const ref = doc(db, "users", otherUID);

  onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      statusEl.textContent = "";
      return;
    }

    const data = snap.data();

    // 🔑 HANDLE MISSING STATUS
    if (!data.status) {
      statusEl.textContent = "Offline";
      return;
    }

    if (data.status.online) {
      statusEl.textContent = "Online";
    } else if (data.status.lastSeen) {
      statusEl.textContent = "Last seen " + formatTimeAgo(data.status.lastSeen.toDate());
    } else {
      statusEl.textContent = "Offline";
    }
  });
}

function formatTimeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// --------------------------------------------------------
// VOICE & VIDEO CALL SYSTEM
// --------------------------------------------------------

let callPC = null;
let callStream = null;
let callTimerInterval = null;
let callSeconds = 0;
let isMuted = false;

window.startVoiceCall = async function() {
  const otherUID = window.currentOther;
  if (!otherUID) return;

  const otherSnap = await getDoc(doc(db, "users", otherUID));
  const other = otherSnap.data();

  // Show call overlay
  const overlay = document.getElementById('callOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.getElementById('callAvatar').src = other?.photoURL || 'https://i.pravatar.cc/100?u=' + otherUID;
  document.getElementById('callName').textContent = other?.username || 'Partner';
  document.getElementById('callStatus').textContent = 'Calling...';
  document.getElementById('callTimer').classList.add('hidden');

  try {
    callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    callPC = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
    });

    callStream.getTracks().forEach(t => callPC.addTrack(t, callStream));

    callPC.ontrack = (ev) => {
      const audio = new Audio();
      audio.srcObject = ev.streams[0];
      audio.play();
      document.getElementById('callStatus').textContent = 'Connected';
      startCallTimer();
    };

    const chatId = window.currentChat;
    callPC.onicecandidate = (ev) => {
      if (ev.candidate) {
        addDoc(collection(db, "calls", chatId, "signaling"), {
          type: 'candidate', candidate: ev.candidate.toJSON(),
          from: auth.currentUser.uid, timestamp: serverTimestamp()
        });
      }
    };

    const offer = await callPC.createOffer();
    await callPC.setLocalDescription(offer);

    await addDoc(collection(db, "calls", chatId, "signaling"), {
      type: 'offer', offer: { type: offer.type, sdp: offer.sdp },
      from: auth.currentUser.uid, to: otherUID, timestamp: serverTimestamp()
    });

    // Listen for answer
    listenCallSignaling(chatId);

  } catch (err) {
    console.error('Call failed:', err);
    document.getElementById('callStatus').textContent = 'Call failed';
    setTimeout(() => endCall(), 2000);
  }
};

window.startVideoCall = function() {
  alert('Video calling coming soon! Use voice call for now.');
};

function listenCallSignaling(chatId) {
  const q = query(collection(db, "calls", chatId, "signaling"), orderBy("timestamp", "desc"));
  const unsub = onSnapshot(q, async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== 'added') continue;
      const msg = change.doc.data();
      if (msg.from === auth.currentUser.uid) continue;
      if (!callPC) continue;

      if (msg.type === 'answer' && callPC.signalingState === 'have-local-offer') {
        await callPC.setRemoteDescription(new RTCSessionDescription(msg.answer));
      }
      if (msg.type === 'candidate' && callPC.remoteDescription) {
        try { await callPC.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch(e) {}
      }
    }
  });
  window.__callUnsub = unsub;
}

function startCallTimer() {
  callSeconds = 0;
  const timerEl = document.getElementById('callTimer');
  if (timerEl) timerEl.classList.remove('hidden');
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

window.endCall = function() {
  if (callStream) { callStream.getTracks().forEach(t => t.stop()); callStream = null; }
  if (callPC) { callPC.close(); callPC = null; }
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  if (window.__callUnsub) { window.__callUnsub(); window.__callUnsub = null; }
  callSeconds = 0; isMuted = false;
  document.getElementById('callOverlay')?.classList.add('hidden');
};

window.toggleCallMute = function() {
  if (!callStream) return;
  isMuted = !isMuted;
  callStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  const btn = document.getElementById('muteBtn');
  if (btn) btn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
};

window.toggleSpeaker = function() {
  // Browser doesn't have a direct speaker toggle API, just visual feedback
  const btn = document.getElementById('speakerBtn');
  if (btn) btn.classList.toggle('active');
};
