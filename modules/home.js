// NUVVU NENU — Home Page
import { db, auth } from '../firebase.js';
import { doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getPartnerId } from '../utils/coupleId.js';

export function renderHome(container) {
  const user = window.currentUser;
  const name = user.displayName?.split(' ')[0] || 'You';

  container.innerHTML = `
    <div class="home-page stagger">
      <!-- Greeting -->
      <div class="home-hero">
        <h1 class="home-greeting">${window.getGreeting()}, ${name} 💜<span id="partnerActivity"></span></h1>
      </div>

      <!-- Partner presence -->
      <div class="presence-card" id="presenceCard">
        <div class="presence-avatar">💜<div class="orb presence-orb online"></div></div>
        <div class="presence-info">
          <div class="presence-name" id="partnerName">Your partner</div>
          <div class="presence-status" id="partnerStatus">Invite your partner to connect</div>
          <div class="presence-last" id="partnerLast"></div>
        </div>
      </div>

      <!-- Daily check-in -->
      <div class="checkin-section">
        <h3>Today's Check-in</h3>
        <div class="checkin-card" id="checkinCard" onclick="openCheckin()">
          <div class="checkin-mood" id="myMood">🙂</div>
          <div class="checkin-details">
            <div class="label">How are you feeling?</div>
            <div class="value" id="myNeed">Tap to check in</div>
            <div class="love-battery"><div class="fill" id="batteryFill" style="width:50%"></div></div>
          </div>
        </div>
      </div>

      <!-- Today together -->
      <div class="today-stats" id="todayStats">
        <div class="stat-card"><div class="num" id="streakDays">0</div><div class="label">Day streak</div></div>
        <div class="stat-card"><div class="num" id="lastCall">—</div><div class="label">Last call</div></div>
        <div class="stat-card"><div class="num" id="sharedPhotos">0</div><div class="label">Shared this week</div></div>
        <div class="stat-card"><div class="num" id="totalDays">0</div><div class="label">Days together</div></div>
      </div>

      <!-- Quick actions -->
      <div class="quick-actions">
        <button class="quick-action" onclick="sendKiss()"><span class="icon">💋</span><span class="label">Send Kiss</span></button>
        <button class="quick-action" onclick="loadPage('space')"><span class="icon">🌙</span><span class="label">Sleep Call</span></button>
        <button class="quick-action" onclick="loadPage('moments')"><span class="icon">📸</span><span class="label">Add Memory</span></button>
        <button class="quick-action" onclick="sendNote()"><span class="icon">💌</span><span class="label">Surprise Note</span></button>
        <button class="quick-action" onclick="loadPage('space')"><span class="icon">🎮</span><span class="label">Play Game</span></button>
        <button class="quick-action" onclick="loadPage('bond')"><span class="icon">💫</span><span class="label">Our Bond</span></button>
      </div>
    </div>
  `;

  loadPartnerPresence();
  loadCheckin();
  loadStats();
}

// Partner presence listener
function loadPartnerPresence() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const coupleRef = doc(db, 'users', uid);
  getDoc(coupleRef).then(snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    const partnerId = getPartnerId(data);
    if (!partnerId) return;
    onSnapshot(doc(db, 'users', partnerId), pSnap => {
      if (!pSnap.exists()) return;
      const p = pSnap.data();
      const nameEl = document.getElementById('partnerName');
      const statusEl = document.getElementById('partnerStatus');
      const actEl = document.getElementById('partnerActivity');
      if (nameEl) nameEl.textContent = p.displayName || 'Partner';
      if (statusEl) statusEl.textContent = p.presenceStatus || 'Online';
      if (actEl && p.lastAction) actEl.textContent = p.lastAction;
    });
  }).catch(() => {});
}

// Load check-in data
function loadCheckin() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  getDoc(doc(db, 'checkins', uid)).then(snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    const moodEl = document.getElementById('myMood');
    const needEl = document.getElementById('myNeed');
    const battEl = document.getElementById('batteryFill');
    if (moodEl && d.mood) moodEl.textContent = d.mood;
    if (needEl && d.need) needEl.textContent = `Need: ${d.need}`;
    if (battEl && d.battery) battEl.style.width = `${d.battery}%`;
  }).catch(() => {});
}

// Load relationship stats
function loadStats() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  getDoc(doc(db, 'users', uid)).then(snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    const streakEl = document.getElementById('streakDays');
    const daysEl = document.getElementById('totalDays');
    if (streakEl && d.streak) streakEl.textContent = d.streak;
    if (daysEl && d.togetherSince) {
      const days = Math.floor((Date.now() - d.togetherSince.toMillis()) / 86400000);
      daysEl.textContent = days;
    }
  }).catch(() => {});
}

// Quick actions
window.sendKiss = function() {
  window.showToast('💋 Kiss sent!');
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  getDoc(doc(db, 'users', uid)).then(snap => {
    const partnerId = getPartnerId(snap.data());
    if (!snap.exists() || !partnerId) return;
    setDoc(doc(db, 'notifications', partnerId), {
      type: 'kiss', from: uid, timestamp: new Date(), read: false
    }, { merge: true });
  }).catch(() => {});
};

window.sendNote = function() {
  const note = prompt('Write a surprise note 💜');
  if (!note) return;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  getDoc(doc(db, 'users', uid)).then(snap => {
    const partnerId = getPartnerId(snap.data());
    if (!snap.exists() || !partnerId) return;
    setDoc(doc(db, 'surprises', `${uid}_${Date.now()}`), {
      from: uid, to: partnerId, note, timestamp: new Date(), opened: false
    });
    window.showToast('💌 Note sent!');
  }).catch(() => {});
};

window.openCheckin = function() {
  const moods = ['😊 Happy', '🙂 Calm', '😔 Low', '😤 Stressed', '🥰 Loving', '😴 Tired'];
  const needs = ['Attention', 'Space', 'Comfort', 'Fun', 'Talk', 'Cuddles'];
  const mood = prompt(`How are you feeling?\n${moods.join('\n')}`);
  const need = prompt(`What do you need today?\n${needs.join(', ')}`);
  const battery = prompt('Love battery (0-100)?');
  if (!mood) return;
  const uid = auth.currentUser?.uid;
  setDoc(doc(db, 'checkins', uid), {
    mood: mood.split(' ')[0], need: need || '', battery: parseInt(battery) || 50, timestamp: new Date()
  }).then(() => {
    window.showToast('Check-in saved 💜');
    loadCheckin();
  });
};
