// NUVVU NENU — You (Profile) Page
import { db, auth } from '../firebase.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

export function renderProfile(container) {
  const user = window.currentUser;
  const name = user.displayName || 'You';

  container.innerHTML = `
    <div class="profile-page stagger">
      <!-- Couple Identity -->
      <div class="couple-header">
        <div class="couple-avatars">
          <div class="couple-avatar">🫧</div>
          <span class="couple-heart">♡</span>
          <div class="couple-avatar">💜</div>
        </div>
        <div class="couple-names" id="coupleNames">${name}</div>
        <div class="couple-days" id="coupleDays">Loading…</div>
      </div>

      <!-- Emotional Identity -->
      <div class="identity-section">
        <h3>Your Emotional Identity</h3>
        <div class="identity-card"><span class="icon">💜</span><div class="info"><div class="label">Love Style</div><div class="value" id="loveStyle">Tap to set</div></div></div>
        <div class="identity-card"><span class="icon">🎵</span><div class="info"><div class="label">Comfort Song</div><div class="value" id="comfortSong">Not set</div></div></div>
        <div class="identity-card"><span class="icon">🌙</span><div class="info"><div class="label">Current Mood</div><div class="value" id="currentMood">—</div></div></div>
        <div class="identity-card"><span class="icon">📸</span><div class="info"><div class="label">Favorite Memory</div><div class="value" id="favMemory">Not set</div></div></div>
      </div>

      <!-- Voice Intro -->
      <div class="voice-intro" onclick="recordVoiceIntro()">
        <div class="play-btn">🎙️</div>
        <div class="info">
          <div class="label">Voice Intro</div>
          <div class="duration" id="voiceDuration">Tap to record a voice intro for your partner</div>
        </div>
      </div>

      <!-- Settings -->
      <div class="identity-section">
        <h3>Settings</h3>
        <div class="settings-list">
          <button class="settings-item" onclick="editProfile()"><span class="icon">✏️</span><span class="label">Edit Profile</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="loadPage('subscription')"><span class="icon">⭐</span><span class="label">Premium</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="managePartner()"><span class="icon">💜</span><span class="label">Partner Settings</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="toggleNotifs()"><span class="icon">🔔</span><span class="label">Notifications</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="logout()"><span class="icon">👋</span><span class="label">Log Out</span><span class="arrow">›</span></button>
        </div>
      </div>
    </div>
  `;

  loadProfileData();
}

async function loadProfileData() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const snap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (!snap?.exists()) return;
  const d = snap.data();

  // Couple info
  if (d.partnerId) {
    const pSnap = await getDoc(doc(db, 'users', d.partnerId)).catch(() => null);
    const pName = pSnap?.data()?.displayName?.split(' ')[0] || 'Partner';
    const myName = d.displayName?.split(' ')[0] || 'You';
    document.getElementById('coupleNames').textContent = `${myName} ♡ ${pName}`;
    if (d.togetherSince) {
      const days = Math.floor((Date.now() - d.togetherSince.toMillis()) / 86400000);
      document.getElementById('coupleDays').textContent = `Together for ${days} days 💜`;
    }
  } else {
    document.getElementById('coupleDays').textContent = 'Invite your partner to connect';
  }

  // Identity fields
  if (d.loveStyle) document.getElementById('loveStyle').textContent = d.loveStyle;
  if (d.comfortSong) document.getElementById('comfortSong').textContent = d.comfortSong;
  if (d.currentMood) document.getElementById('currentMood').textContent = d.currentMood;
  if (d.favMemory) document.getElementById('favMemory').textContent = d.favMemory;
}

window.editProfile = function() {
  const uid = auth.currentUser?.uid;
  const loveStyle = prompt('Your love style (e.g. Gentle, Passionate, Playful, Protective)');
  const comfortSong = prompt('Your comfort song');
  const mood = prompt('Current mood emoji + word');

  const updates = {};
  if (loveStyle) updates.loveStyle = loveStyle;
  if (comfortSong) updates.comfortSong = comfortSong;
  if (mood) updates.currentMood = mood;

  if (Object.keys(updates).length) {
    updateDoc(doc(db, 'users', uid), updates).then(() => {
      window.showToast('Profile updated 💜');
      loadProfileData();
    });
  }
};

window.managePartner = function() {
  const code = prompt('Enter your partner\'s invite code (their UID) to connect:');
  if (!code) return;
  const uid = auth.currentUser?.uid;
  updateDoc(doc(db, 'users', uid), { partnerId: code }).then(() => {
    window.showToast('Partner linked! 💜');
    loadProfileData();
  }).catch(() => window.showToast('Error linking partner'));
};

window.recordVoiceIntro = function() {
  window.showToast('🎙️ Voice recording coming with Premium');
};

window.toggleNotifs = function() {
  window.showToast('Notification settings coming soon');
};

window.logout = function() {
  if (confirm('Log out of Nuvvu Nenu?')) {
    signOut(auth).then(() => window.location.href = 'login.html');
  }
};
