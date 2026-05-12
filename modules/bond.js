// NUVVU NENU — Bond Page (Relationship Health)
import { db, auth } from '../firebase.js';
import { doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function renderBond(container) {
  container.innerHTML = `
    <div class="bond-page stagger">
      <!-- Relationship Pulse -->
      <div class="pulse-card">
        <div class="pulse-orb"></div>
        <div class="pulse-label">Relationship Pulse</div>
        <div class="pulse-score" id="pulseScore">—</div>
      </div>

      <!-- Love Languages -->
      <div class="love-langs">
        <h3>Love Languages</h3>
        <div class="lang-item"><span class="emoji">💬</span><div class="info"><div class="name">Words of Affirmation</div><div class="lang-bar"><div class="fill words" id="langWords" style="width:60%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">⏰</span><div class="info"><div class="name">Quality Time</div><div class="lang-bar"><div class="fill time" id="langTime" style="width:80%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🎁</span><div class="info"><div class="name">Gifts</div><div class="lang-bar"><div class="fill gifts" id="langGifts" style="width:40%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🤗</span><div class="info"><div class="name">Physical Touch</div><div class="lang-bar"><div class="fill touch" id="langTouch" style="width:70%"></div></div></div></div>
        <div class="lang-item"><span class="emoji">🛠️</span><div class="info"><div class="name">Acts of Service</div><div class="lang-bar"><div class="fill support" id="langSupport" style="width:55%"></div></div></div></div>
      </div>

      <!-- Shared Goals -->
      <div class="goals-section">
        <h3>Shared Goals</h3>
        <div id="goalsList">
          <div class="goal-card"><span class="icon">✈️</span><div class="info"><div class="title">Save for a trip</div><div class="progress">In progress</div></div></div>
          <div class="goal-card"><span class="icon">🎬</span><div class="info"><div class="title">Watch 100 movies</div><div class="progress">12/100</div></div></div>
        </div>
        <button class="btn btn-ghost" onclick="addGoal()" style="width:100%;margin-top:8px">+ Add Goal</button>
      </div>

      <!-- Countdowns -->
      <div class="countdowns">
        <h3 style="font-size:var(--font-sm);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500;margin-bottom:8px">Coming Up</h3>
        <div id="countdownList"></div>
        <button class="btn btn-ghost" onclick="addCountdown()" style="width:100%;margin-top:8px">+ Add Event</button>
      </div>

      <!-- Fight Recovery -->
      <div class="recovery-card" id="recoveryCard" style="display:none">
        <h3>💛 Reconnect</h3>
        <p>It's been quiet. Want to break the ice?</p>
        <button class="btn btn-primary" onclick="startRecovery()">Send an olive branch 🕊️</button>
      </div>
    </div>
  `;

  loadBondData();
}

async function loadBondData() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const userSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (!userSnap?.exists()) return;
  const partnerId = userSnap.data().partnerId;
  if (!partnerId) return;

  const coupleId = [uid, partnerId].sort().join('_');

  // Load pulse score
  const bondSnap = await getDoc(doc(db, 'bonds', coupleId)).catch(() => null);
  if (bondSnap?.exists()) {
    const d = bondSnap.data();
    const scoreEl = document.getElementById('pulseScore');
    if (scoreEl) scoreEl.textContent = `${d.pulse || 75}%`;
    // Update love language bars
    if (d.languages) {
      Object.entries(d.languages).forEach(([key, val]) => {
        const el = document.getElementById(`lang${key.charAt(0).toUpperCase() + key.slice(1)}`);
        if (el) el.style.width = `${val}%`;
      });
    }
  } else {
    document.getElementById('pulseScore').textContent = '75%';
  }

  // Load countdowns
  const cdSnap = await getDocs(query(collection(db, 'bonds', coupleId, 'events'), orderBy('date'), limit(5))).catch(() => null);
  const cdList = document.getElementById('countdownList');
  if (cdSnap && !cdSnap.empty) {
    cdList.innerHTML = '';
    cdSnap.forEach(d => {
      const ev = d.data();
      const daysLeft = Math.ceil((ev.date.toMillis() - Date.now()) / 86400000);
      cdList.innerHTML += `<div class="countdown-card"><span class="event">${ev.title}</span><span class="days">${daysLeft > 0 ? daysLeft + 'd' : 'Today!'}</span></div>`;
    });
  } else {
    cdList.innerHTML = `<div style="text-align:center;padding:16px;color:var(--muted);font-size:var(--font-sm)">No upcoming events</div>`;
  }
}

window.addGoal = function() {
  const title = prompt('What goal do you want to achieve together?');
  if (!title) return;
  const uid = auth.currentUser?.uid;
  getDoc(doc(db, 'users', uid)).then(async snap => {
    if (!snap.exists() || !snap.data().partnerId) return;
    const coupleId = [uid, snap.data().partnerId].sort().join('_');
    await addDoc(collection(db, 'bonds', coupleId, 'goals'), {
      title, progress: 0, createdBy: uid, timestamp: serverTimestamp()
    });
    window.showToast('Goal added 💫');
  }).catch(() => {});
};

window.addCountdown = function() {
  const title = prompt('Event name (e.g. Anniversary, Next Meet)');
  if (!title) return;
  const dateStr = prompt('Date (YYYY-MM-DD)');
  if (!dateStr) return;
  const date = new Date(dateStr);
  if (isNaN(date)) { window.showToast('Invalid date'); return; }

  const uid = auth.currentUser?.uid;
  getDoc(doc(db, 'users', uid)).then(async snap => {
    if (!snap.exists() || !snap.data().partnerId) return;
    const coupleId = [uid, snap.data().partnerId].sort().join('_');
    await addDoc(collection(db, 'bonds', coupleId, 'events'), {
      title, date, createdBy: uid
    });
    window.showToast('Event added 📅');
    loadBondData();
  }).catch(() => {});
};

window.startRecovery = function() {
  const uid = auth.currentUser?.uid;
  getDoc(doc(db, 'users', uid)).then(snap => {
    if (!snap.exists() || !snap.data().partnerId) return;
    setDoc(doc(db, 'notifications', snap.data().partnerId), {
      type: 'olive_branch', from: uid, timestamp: new Date(), message: 'I want to reconnect 💜'
    }, { merge: true });
    window.showToast('🕊️ Olive branch sent');
  }).catch(() => {});
};
