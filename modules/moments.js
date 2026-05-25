// NUVVU NENU — Moments Page (Private Memory Timeline)
import { db, auth } from '../firebase.js';
import { collection, query, orderBy, limit, getDocs, addDoc, doc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getPartnerId } from '../utils/coupleId.js';

export function renderMoments(container) {
  container.innerHTML = `
    <div class="moments-page stagger">
      <div class="moments-header">
        <h2>Moments 💜</h2>
        <button class="add-btn" onclick="addMemory()">+</button>
      </div>

      <!-- Monthly recap -->
      <div class="recap-card">
        <h3>✨ Your Month Together</h3>
        <p>Memories from this month, beautifully collected</p>
        <button class="btn btn-ghost" onclick="viewRecap()">View Recap</button>
      </div>

      <!-- Memory timeline -->
      <div class="memory-timeline" id="memoryTimeline">
        <div style="text-align:center;padding:32px;color:var(--muted);font-size:var(--font-sm)">Loading memories…</div>
      </div>
    </div>
  `;

  loadMemories();
}

async function loadMemories() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  // Get couple ID
  const userSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (!userSnap?.exists()) return;
  const partnerId = getPartnerId(userSnap.data());
  if (!partnerId) {
    document.getElementById('memoryTimeline').innerHTML = `<div style="text-align:center;padding:32px;color:var(--muted)">Connect with your partner to start saving memories together 💜</div>`;
    return;
  }

  const coupleId = [uid, partnerId].sort().join('_');
  const q = query(collection(db, 'memories', coupleId, 'items'), orderBy('timestamp', 'desc'), limit(20));
  const snap = await getDocs(q).catch(() => null);

  const timeline = document.getElementById('memoryTimeline');
  if (!snap || snap.empty) {
    timeline.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted);font-size:var(--font-sm)">
        No memories yet.<br>Tap + to add your first moment together 💜
      </div>`;
    return;
  }

  timeline.innerHTML = '';
  snap.forEach(d => {
    const m = d.data();
    const date = m.timestamp?.toDate?.() || new Date();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const locked = m.locked && !m.unlocked;

    timeline.innerHTML += `
      <div class="memory-card ${locked ? 'locked' : ''}">
        ${m.photoUrl ? `<div class="media"><img src="${m.photoUrl}" alt="memory" loading="lazy"></div>` : ''}
        <div class="title">${m.title || 'A moment together'}</div>
        <div class="meta">
          <span>🕐 ${time}</span>
          <span>📅 ${dateStr}</span>
          ${m.location ? `<span>📍 ${m.location}</span>` : ''}
          ${m.weather ? `<span>${m.weather}</span>` : ''}
        </div>
        ${m.emotion ? `<span class="emotion-tag">${m.emotion}</span>` : ''}
      </div>
    `;
  });
}

window.addMemory = function() {
  const title = prompt('Name this moment 💜');
  if (!title) return;
  const emotion = prompt('How did it feel? (e.g. 🥰 Warm, 😂 Funny, 🥺 Emotional)');
  const location = prompt('Where? (optional)');
  const weather = prompt('Weather? (e.g. ☀️ Sunny, 🌧️ Rainy)');

  const uid = auth.currentUser?.uid;
  if (!uid) return;

  getDoc(doc(db, 'users', uid)).then(async snap => {
    const partnerId = getPartnerId(snap.data());
    if (!snap.exists() || !partnerId) {
      window.showToast('Connect with partner first');
      return;
    }
    const coupleId = [uid, partnerId].sort().join('_');
    await addDoc(collection(db, 'memories', coupleId, 'items'), {
      title,
      emotion: emotion || '',
      location: location || '',
      weather: weather || '',
      addedBy: uid,
      timestamp: serverTimestamp(),
      locked: false
    });
    window.showToast('Memory saved 💜');
    loadMemories();
  }).catch(() => window.showToast('Error saving memory'));
};

window.viewRecap = function() {
  window.showToast('✨ Monthly recaps coming with Premium');
  window.loadPage?.('subscription');
};
