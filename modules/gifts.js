// =======================================================
// gifts.js — Virtual Gifts System
// =======================================================
import {
  doc, getDoc, addDoc, collection, query, orderBy, limit,
  getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

const GIFTS = [
  { id:'rose', emoji:'🌹', name:'Rose', msg:'A rose for my love' },
  { id:'heart', emoji:'💝', name:'Heart Box', msg:'My heart is yours' },
  { id:'ring', emoji:'💍', name:'Ring', msg:'Forever yours' },
  { id:'teddy', emoji:'🧸', name:'Teddy Bear', msg:'Hugs for you' },
  { id:'choc', emoji:'🍫', name:'Chocolate', msg:'Sweet like you' },
  { id:'star', emoji:'⭐', name:'Star', msg:'You light up my life' },
  { id:'kiss', emoji:'💋', name:'Kiss', msg:'Mwah!' },
  { id:'letter', emoji:'💌', name:'Love Letter', msg:'Words from my heart' },
  { id:'cake', emoji:'🎂', name:'Cake', msg:'Celebrating us' },
  { id:'moon', emoji:'🌙', name:'Moon', msg:'You are my moonlight' },
  { id:'sparkle', emoji:'✨', name:'Sparkle', msg:'You make life magical' },
  { id:'crown', emoji:'👑', name:'Crown', msg:'You are my queen/king' }
];

let unsubGifts = null;

export function render() {
  return `
    <div class="gifts-container">
      <div class="gifts-header glass-premium">
        <h2>🎁 Virtual Gifts</h2>
        <p class="gifts-sub">Send love, one gift at a time</p>
      </div>

      <div class="gifts-grid glass-premium">
        <h3>Choose a Gift</h3>
        <div class="gift-options">
          ${GIFTS.map(g => `
            <button class="gift-item" onclick="selectGift('${g.id}')">
              <span class="gift-emoji">${g.emoji}</span>
              <span class="gift-name">${g.name}</span>
            </button>
          `).join('')}
        </div>
        <textarea id="giftMessage" class="gift-msg-input" placeholder="Add a personal message..." maxlength="200"></textarea>
        <button class="send-gift-btn" onclick="sendGift()" id="sendGiftBtn" disabled>
          <i class="fas fa-gift"></i> Send Gift
        </button>
      </div>

      <div class="received-gifts glass-premium">
        <h3><i class="fas fa-inbox"></i> Received Gifts</h3>
        <div id="giftInbox" class="gift-inbox">
          <p class="empty-gifts">No gifts yet 💔</p>
        </div>
      </div>

      <div class="sent-gifts glass-premium">
        <h3><i class="fas fa-paper-plane"></i> Sent Gifts</h3>
        <div id="sentGifts" class="gift-list"></div>
      </div>
    </div>`;
}

export function init() {
  loadGifts();
  listenForGifts();
  return () => { unsubGifts?.(); };
}

window.selectGift = function(id) {
  window.__selectedGift = id;
  document.querySelectorAll('.gift-item').forEach(el => el.classList.remove('selected'));
  const btn = document.querySelector(`.gift-item[onclick*="'${id}'"]`);
  if (btn) btn.classList.add('selected');
  const sendBtn = document.getElementById('sendGiftBtn');
  if (sendBtn) sendBtn.disabled = false;
};

window.sendGift = async function() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const giftId = window.__selectedGift; if (!giftId) return;

  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  if (!pid) { alert('You need a partner to send gifts!'); return; }

  const gift = GIFTS.find(g => g.id === giftId);
  const msg = document.getElementById('giftMessage')?.value?.trim() || gift.msg;

  await addDoc(collection(db, "gifts"), {
    from: uid, to: pid, giftId: gift.id, emoji: gift.emoji,
    name: gift.name, message: msg, seen: false,
    timestamp: serverTimestamp()
  });

  // Reset
  window.__selectedGift = null;
  document.querySelectorAll('.gift-item').forEach(el => el.classList.remove('selected'));
  const msgEl = document.getElementById('giftMessage'); if (msgEl) msgEl.value = '';
  const sendBtn = document.getElementById('sendGiftBtn'); if (sendBtn) sendBtn.disabled = true;

  showGiftAnimation(gift.emoji);
  loadGifts();
};

function showGiftAnimation(emoji) {
  const anim = document.createElement('div');
  anim.className = 'gift-fly-anim';
  anim.textContent = emoji;
  document.body.appendChild(anim);
  setTimeout(() => anim.remove(), 2000);
}

async function loadGifts() {
  const uid = auth.currentUser?.uid; if (!uid) return;

  // Received
  const rq = query(collection(db, "gifts"), orderBy("timestamp", "desc"), limit(20));
  const rSnap = await getDocs(rq);
  const inbox = document.getElementById('giftInbox');
  const sent = document.getElementById('sentGifts');

  let recvHtml = '', sentHtml = '';
  rSnap.forEach(d => {
    const g = d.data();
    if (g.to === uid) {
      recvHtml += `
        <div class="gift-card glass-premium received">
          <span class="gift-card-emoji">${g.emoji}</span>
          <div class="gift-card-info">
            <strong>${g.name}</strong>
            <p>${g.message}</p>
            <span class="gift-time">${g.timestamp?.toDate?.()?.toLocaleDateString() || ''}</span>
          </div>
        </div>`;
    }
    if (g.from === uid) {
      sentHtml += `
        <div class="gift-card glass-premium sent-card">
          <span class="gift-card-emoji">${g.emoji}</span>
          <div class="gift-card-info">
            <strong>${g.name}</strong>
            <p>${g.message}</p>
            <span class="gift-time">${g.timestamp?.toDate?.()?.toLocaleDateString() || ''}</span>
          </div>
        </div>`;
    }
  });

  if (inbox) inbox.innerHTML = recvHtml || '<p class="empty-gifts">No gifts received yet</p>';
  if (sent) sent.innerHTML = sentHtml || '<p class="empty-gifts">No gifts sent yet</p>';
}

function listenForGifts() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const q = query(collection(db, "gifts"), orderBy("timestamp", "desc"), limit(1));
  unsubGifts = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const g = change.doc.data();
        if (g.to === uid && !g.seen) {
          showGiftNotification(g);
        }
      }
    });
  });
}

function showGiftNotification(gift) {
  const notif = document.createElement('div');
  notif.className = 'gift-notification';
  notif.innerHTML = `<span class="notif-emoji">${gift.emoji}</span><p>You received a ${gift.name}!</p><p class="notif-msg">"${gift.message}"</p>`;
  document.body.appendChild(notif);
  setTimeout(() => { notif.classList.add('fade-out'); setTimeout(() => notif.remove(), 500); }, 4000);
}
