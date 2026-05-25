// NUVVU NENU — You (Profile) Page
// Now also hosts: public-profile preview, username editor, and inline Bond view.
import { db, auth } from '../firebase.js';
import { doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { pairWithInviteCode, unpair } from '../services/partnerService.js';
import { setUsername, isUsernameAvailable } from '../services/feedService.js';
import { getPartnerId } from '../utils/coupleId.js';

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
        <div class="profile-handle" id="profileHandle">@…</div>
      </div>

      <!-- Public profile actions -->
      <div class="identity-section">
        <h3>Your Public Profile</h3>
        <div class="settings-list">
          <button class="settings-item" onclick="setMyUsername()"><span class="icon">@</span><span class="label">Edit Username</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="editBio()"><span class="icon">📝</span><span class="label">Edit Bio</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="viewMyPublicProfile()"><span class="icon">👁️</span><span class="label">View My Public Profile</span><span class="arrow">›</span></button>
        </div>
      </div>

      <!-- Emotional Identity -->
      <div class="identity-section">
        <h3>Your Emotional Identity</h3>
        <div class="identity-card" onclick="editField('loveStyle')"><span class="icon">💜</span><div class="info"><div class="label">Love Style</div><div class="value" id="loveStyle">Tap to set</div></div></div>
        <div class="identity-card" onclick="editField('comfortSong')"><span class="icon">🎵</span><div class="info"><div class="label">Comfort Song</div><div class="value" id="comfortSong">Not set</div></div></div>
        <div class="identity-card" onclick="editField('currentMood')"><span class="icon">🌙</span><div class="info"><div class="label">Current Mood</div><div class="value" id="currentMood">—</div></div></div>
        <div class="identity-card" onclick="editField('favMemory')"><span class="icon">📸</span><div class="info"><div class="label">Favorite Memory</div><div class="value" id="favMemory">Not set</div></div></div>
      </div>

      <!-- Inline Bond view -->
      <div class="identity-section bond-inline" id="bondInline">
        <h3>Your Bond 💫</h3>
        <div class="pulse-card mini">
          <div class="pulse-orb"></div>
          <div class="pulse-label">Relationship Pulse</div>
          <div class="pulse-score" id="profilePulseScore">—</div>
        </div>
        <div class="love-langs">
          <div class="lang-item"><span class="emoji">💬</span><div class="info"><div class="name">Words</div><div class="lang-bar"><div class="fill words" id="profLangWords"  style="width:60%"></div></div></div></div>
          <div class="lang-item"><span class="emoji">⏰</span><div class="info"><div class="name">Quality Time</div><div class="lang-bar"><div class="fill time" id="profLangTime"  style="width:80%"></div></div></div></div>
          <div class="lang-item"><span class="emoji">🤗</span><div class="info"><div class="name">Touch</div><div class="lang-bar"><div class="fill touch" id="profLangTouch" style="width:70%"></div></div></div></div>
        </div>
        <div class="countdowns">
          <h3 style="font-size:var(--font-sm);color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:500;margin-bottom:8px">Coming Up</h3>
          <div id="profCountdownList"></div>
          <button class="btn btn-ghost" onclick="addCountdown()" style="width:100%;margin-top:8px">+ Add Event</button>
        </div>
      </div>

      <!-- Settings -->
      <div class="identity-section">
        <h3>Settings</h3>
        <div class="settings-list">
          <button class="settings-item" onclick="editProfile()"><span class="icon">✏️</span><span class="label">Edit Profile (bulk)</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="loadPage('subscription')"><span class="icon">⭐</span><span class="label">Premium</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="managePartner()"><span class="icon">💜</span><span class="label">Partner Settings</span><span class="arrow">›</span></button>
          <button class="settings-item" onclick="copyInviteCode()"><span class="icon">🔗</span><span class="label">My Invite Code</span><span class="arrow">›</span></button>
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

  // Username handle
  const handleEl = document.getElementById('profileHandle');
  if (handleEl) handleEl.textContent = d.username ? `@${d.username}` : 'Set a username';

  // Couple info
  const partnerKey = getPartnerId(d);
  if (partnerKey) {
    const pSnap = await getDoc(doc(db, 'users', partnerKey)).catch(() => null);
    const pName = pSnap?.data()?.displayName?.split(' ')[0] || 'Partner';
    const myName = d.displayName?.split(' ')[0] || 'You';
    document.getElementById('coupleNames').textContent = `${myName} ♡ ${pName}`;
    if (d.togetherSince) {
      const days = Math.floor((Date.now() - d.togetherSince.toMillis()) / 86400000);
      document.getElementById('coupleDays').textContent = `Together for ${days} days 💜`;
    } else {
      document.getElementById('coupleDays').textContent = 'Linked 💜';
    }
    loadInlineBond(uid, partnerKey);
    document.getElementById('bondInline').style.display = '';
  } else {
    document.getElementById('coupleDays').textContent = 'Invite your partner to connect';
    document.getElementById('bondInline').style.display = 'none';
  }

  // Identity fields
  if (d.loveStyle)   document.getElementById('loveStyle').textContent   = d.loveStyle;
  if (d.comfortSong) document.getElementById('comfortSong').textContent = d.comfortSong;
  if (d.currentMood) document.getElementById('currentMood').textContent = d.currentMood;
  if (d.favMemory)   document.getElementById('favMemory').textContent   = d.favMemory;
}

async function loadInlineBond(uid, partnerKey) {
  const coupleId = [uid, partnerKey].sort().join('_');
  const bondSnap = await getDoc(doc(db, 'bonds', coupleId)).catch(() => null);
  if (bondSnap?.exists()) {
    const d = bondSnap.data();
    const score = document.getElementById('profilePulseScore');
    if (score) score.textContent = `${d.pulse || 75}%`;
  } else {
    const score = document.getElementById('profilePulseScore');
    if (score) score.textContent = '75%';
  }
  // Countdowns
  try {
    const cdSnap = await getDocs(query(collection(db, 'bonds', coupleId, 'events'), orderBy('date'), limit(3)));
    const list = document.getElementById('profCountdownList');
    if (!list) return;
    if (cdSnap.empty) {
      list.innerHTML = `<div style="text-align:center;padding:8px;color:var(--muted);font-size:var(--font-sm)">No upcoming events</div>`;
    } else {
      list.innerHTML = '';
      cdSnap.forEach((d) => {
        const ev = d.data();
        const ms = ev.date?.toMillis?.() ?? new Date(ev.date).getTime();
        const daysLeft = Math.ceil((ms - Date.now()) / 86400000);
        list.innerHTML += `<div class="countdown-card"><span class="event">${ev.title}</span><span class="days">${daysLeft > 0 ? daysLeft + 'd' : 'Today!'}</span></div>`;
      });
    }
  } catch {}
}

// =========================================================================
// HANDLERS
// =========================================================================
window.editField = function(field) {
  const uid = auth.currentUser?.uid;
  const val = prompt(`Set your ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}:`);
  if (!val) return;
  updateDoc(doc(db, 'users', uid), { [field]: val }).then(() => {
    window.showToast('Updated 💜');
    loadProfileData();
  });
};

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

window.editBio = async function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const snap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  const current = snap?.data()?.bio || '';
  const next = prompt('Your bio (shown on your public profile):', current);
  if (next === null) return;
  await updateDoc(doc(db, 'users', uid), { bio: next.slice(0, 200) });
  window.showToast('Bio updated');
};

window.setMyUsername = async function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const snap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  const current = snap?.data()?.username || '';
  const next = prompt(
    'Pick a username (3+ chars, a-z 0-9 _ .):',
    current
  );
  if (!next) return;
  try {
    const claimed = await setUsername(next);
    window.showToast(`Username set: @${claimed}`);
    loadProfileData();
  } catch (e) {
    if (e?.message === 'USERNAME_TAKEN')        window.showToast('That username is taken');
    else if (e?.message === 'USERNAME_TOO_SHORT') window.showToast('Username must be 3+ characters');
    else window.showToast('Could not set username');
  }
};

window.viewMyPublicProfile = function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  // Switch to feed page, then open my profile via the feed module's helper.
  window.loadPage?.('feed');
  setTimeout(() => window.openFeedUser?.(uid), 80);
};

window.managePartner = async function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const me = await getDoc(doc(db, 'users', uid)).catch(() => null);
  const linked = getPartnerId(me?.data());

  if (linked) {
    if (!confirm('You are already linked. Unlink your partner?')) return;
    try {
      await unpair(uid);
      window.showToast('Unlinked');
      loadProfileData();
    } catch (e) {
      window.showToast('Error unlinking');
    }
    return;
  }

  const code = prompt(
    'Paste your partner\'s invite code (their UID).\n' +
    'They can find it on their Profile → My Invite Code.'
  );
  if (!code) return;

  try {
    await pairWithInviteCode(uid, code);
    window.showToast('Partner linked! 💜');
    loadProfileData();
  } catch (e) {
    if (e?.message === 'CODE_NOT_FOUND') window.showToast('Invite code not found');
    else if (e?.message === 'SELF_PAIR') window.showToast("You can't pair with yourself 💜");
    else window.showToast('Could not link partner');
  }
};

window.copyInviteCode = function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  navigator.clipboard?.writeText(uid).catch(() => {});
  window.showToast('Invite code copied');
  alert('Your invite code:\n\n' + uid + '\n\nShare this with your partner.');
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
