// NUVVU NENU — Space Page (Private Relationship Room)
import { db, auth } from '../firebase.js';
import { doc, getDoc, setDoc, onSnapshot, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { startVideoCall, startAudioCall } from './callView.js';
import { getPartnerId } from '../utils/coupleId.js';

let touchTimeout = null;
let breathingInterval = null;

export function renderSpace(container) {
  container.innerHTML = `
    <div class="space-page stagger">
      <!-- Live Room -->
      <div class="live-room" id="liveRoom">
        <div class="breathing-orb"></div>
        <div class="room-avatars">
          <div class="room-avatar you">🫧</div>
          <div class="room-avatar partner">💜</div>
        </div>
        <div class="room-status" id="roomStatus">Your private space together</div>
      </div>

      <!-- Activities -->
      <div class="space-activities">
        <button class="activity-card primary" onclick="startCallFromSpace('video')">
          <span class="icon">📹</span>
          <span class="name">Video Call</span>
          <span class="desc">Face to face</span>
        </button>
        <button class="activity-card primary" onclick="startCallFromSpace('audio')">
          <span class="icon">📞</span>
          <span class="name">Voice Call</span>
          <span class="desc">Just hear them</span>
        </button>
        <button class="activity-card" onclick="startSleepMode()">
          <span class="icon">🌙</span>
          <span class="name">Sleep Together</span>
          <span class="desc">Ambient comfort mode</span>
        </button>
        <button class="activity-card" onclick="startWatchTogether()">
          <span class="icon">🎬</span>
          <span class="name">Watch Together</span>
          <span class="desc">Synced viewing</span>
        </button>
        <button class="activity-card" onclick="startBreathingSync()">
          <span class="icon">🫁</span>
          <span class="name">Breathing Sync</span>
          <span class="desc">Calm together</span>
        </button>
        <button class="activity-card" onclick="openGames()">
          <span class="icon">🎮</span>
          <span class="name">Couple Games</span>
          <span class="desc">Play together</span>
        </button>
      </div>

      <!-- Digital Touch -->
      <div class="touch-zone" id="touchZone">
        <div class="hint">Hold to send your touch</div>
        <div class="fingerprint">👆</div>
      </div>

      <!-- Sleep Mode (hidden by default) -->
      <div class="sleep-mode hidden" id="sleepMode">
        <div class="moon">🌙</div>
        <h3>Sleep Together Mode</h3>
        <p>Ambient comfort • Breathing glow • Goodnight</p>
        <button class="btn btn-ghost" onclick="exitSleepMode()" style="margin-top:16px">Wake up ☀️</button>
      </div>

      <!-- Games (hidden by default) -->
      <div class="games-grid hidden" id="gamesGrid">
        <button class="game-card" onclick="playGame('truth')"><span class="icon">🎯</span><span class="name">Truth Game</span></button>
        <button class="game-card" onclick="playGame('compatibility')"><span class="icon">💕</span><span class="name">Compatibility</span></button>
        <button class="game-card" onclick="playGame('memory')"><span class="icon">🧠</span><span class="name">Memory Quiz</span></button>
        <button class="game-card" onclick="playGame('guess')"><span class="icon">🤔</span><span class="name">Guess My Answer</span></button>
        <button class="game-card" onclick="playGame('tarot')"><span class="icon">🔮</span><span class="name">Love Tarot</span></button>
        <button class="game-card" onclick="playGame('date')"><span class="icon">🎲</span><span class="name">Date Roulette</span></button>
      </div>
    </div>
  `;

  setupTouch();
  updatePresence();
}

// Touch system
function setupTouch() {
  const zone = document.getElementById('touchZone');
  if (!zone) return;

  zone.addEventListener('touchstart', e => { e.preventDefault(); startTouch(); });
  zone.addEventListener('mousedown', startTouch);
  zone.addEventListener('touchend', endTouch);
  zone.addEventListener('mouseup', endTouch);
  zone.addEventListener('mouseleave', endTouch);
}

function startTouch() {
  const zone = document.getElementById('touchZone');
  zone.classList.add('active');
  touchTimeout = setTimeout(() => {
    sendTouch();
  }, 800);
}

function endTouch() {
  const zone = document.getElementById('touchZone');
  zone.classList.remove('active');
  if (touchTimeout) { clearTimeout(touchTimeout); touchTimeout = null; }
}

function sendTouch() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  window.showToast('Touch sent 💜');
  getDoc(doc(db, 'users', uid)).then(snap => {
    const partnerId = getPartnerId(snap.data());
    if (!snap.exists() || !partnerId) return;
    setDoc(doc(db, 'touches', partnerId), {
      from: uid, timestamp: new Date(), type: 'hold'
    });
  }).catch(() => {});
}

// Update presence in room
function updatePresence() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  updateDoc(doc(db, 'users', uid), {
    inSpace: true, lastSpaceVisit: serverTimestamp()
  }).catch(() => {});
}

// Sleep mode
window.startSleepMode = function() {
  const sleepEl = document.getElementById('sleepMode');
  const activities = document.querySelector('.space-activities');
  const touch = document.getElementById('touchZone');
  if (sleepEl) sleepEl.classList.remove('hidden');
  if (activities) activities.classList.add('hidden');
  if (touch) touch.classList.add('hidden');
  document.body.style.background = '#060810';
  window.showToast('🌙 Sleep mode active');
};

window.exitSleepMode = function() {
  const sleepEl = document.getElementById('sleepMode');
  const activities = document.querySelector('.space-activities');
  const touch = document.getElementById('touchZone');
  if (sleepEl) sleepEl.classList.add('hidden');
  if (activities) activities.classList.remove('hidden');
  if (touch) touch.classList.remove('hidden');
  document.body.style.background = '';
};

// Breathing sync
window.startBreathingSync = function() {
  window.showToast('🫁 Breathe in… and out…');
  const room = document.getElementById('liveRoom');
  if (!room) return;
  room.innerHTML = `
    <div class="breathing-orb" style="width:150px;height:150px;filter:blur(15px);animation:breathe 5s cubic-bezier(.22,1,.36,1) infinite"></div>
    <div style="position:relative;z-index:1;text-align:center">
      <p style="font-size:1.25rem;font-weight:600;color:var(--violet)" id="breathText">Breathe in…</p>
      <p style="font-size:.8rem;color:var(--muted);margin-top:8px">Syncing with your partner</p>
    </div>
  `;
  let inhale = true;
  breathingInterval = setInterval(() => {
    const el = document.getElementById('breathText');
    if (el) el.textContent = inhale ? 'Breathe out…' : 'Breathe in…';
    inhale = !inhale;
  }, 4000);
};

// Watch together
window.startWatchTogether = function() {
  window.showToast('🎬 Share a link to watch together');
  const url = prompt('Paste a video link to watch together:');
  if (!url) return;
  const uid = auth.currentUser?.uid;
  getDoc(doc(db, 'users', uid)).then(snap => {
    const partnerId = getPartnerId(snap.data());
    if (!snap.exists() || !partnerId) return;
    const coupleId = [uid, partnerId].sort().join('_');
    setDoc(doc(db, 'watchSessions', coupleId), {
      url, startedBy: uid, timestamp: new Date(), playing: true
    });
    window.showToast('Session started! Partner will be notified 🎬');
  }).catch(() => {});
};

// Games
window.openGames = function() {
  const grid = document.getElementById('gamesGrid');
  grid.classList.toggle('hidden');
};

window.playGame = function(type) {
  const games = {
    truth: ['What\'s one thing you\'ve never told me?', 'What\'s your favorite memory of us?', 'What do you love most about me?', 'What scares you about our future?', 'When did you first know you loved me?'],
    compatibility: ['Favorite date night?', 'Dream vacation together?', 'How many kids?', 'City or countryside?', 'Morning person or night owl?'],
    memory: ['Where was our first date?', 'What was I wearing when we met?', 'What\'s my comfort food?', 'What song reminds you of me?'],
    guess: ['What would I choose: beach or mountains?', 'What\'s my biggest fear?', 'What makes me happiest?'],
    tarot: ['💜 The Lovers — Deep connection ahead', '⭐ The Star — Hope and renewal in your bond', '🌙 The Moon — Trust your intuition together', '☀️ The Sun — Joy and warmth surround you', '🎡 Wheel of Fortune — Exciting changes coming'],
    date: ['Cook dinner together 🍳', 'Stargazing night 🌟', 'Movie marathon 🎬', 'Write letters to each other 💌', 'Take a walk and talk 🚶', 'Play 20 questions 🎯']
  };
  const options = games[type] || [];
  const pick = options[Math.floor(Math.random() * options.length)];
  if (type === 'tarot') {
    window.showToast(pick);
  } else {
    alert(`🎮 ${pick}`);
  }
};

// Video / audio call from Space page
window.startCallFromSpace = async function(callType = 'video') {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const snap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  const partnerId = getPartnerId(snap?.data());
  if (!partnerId) {
    window.showToast('Link your partner first 💜');
    window.loadPage?.('profile');
    return;
  }
  const pSnap = await getDoc(doc(db, 'users', partnerId)).catch(() => null);
  const name  = pSnap?.data()?.displayName?.split(' ')[0] || 'Partner';
  if (callType === 'video') startVideoCall(partnerId, name);
  else startAudioCall(partnerId, name);
};
