// =======================================================
// lovenotes.js — Love Notes + Future Letters
// =======================================================
import {
  doc, getDoc, addDoc, collection, query, orderBy, where,
  getDocs, deleteDoc, serverTimestamp, onSnapshot, updateDoc, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

let unsubNotes = null;

export function render() {
  return `
    <div class="notes-container">
      <div class="notes-header glass-premium">
        <h2>💌 Love Notes & Letters</h2>
        <div class="notes-tabs">
          <button class="note-tab active" onclick="switchNoteTab('send')">Send Note</button>
          <button class="note-tab" onclick="switchNoteTab('inbox')">Inbox</button>
          <button class="note-tab" onclick="switchNoteTab('future')">Future Letters</button>
        </div>
      </div>

      <div id="noteTabContent">
        <!-- SEND NOTE TAB -->
        <div id="sendTab" class="note-section">
          <div class="compose-note glass-premium">
            <h3>✍️ Write a Love Note</h3>
            <div class="note-paper">
              <textarea id="noteText" class="note-textarea" placeholder="Dear love..." maxlength="1000"></textarea>
            </div>
            <div class="note-options">
              <div class="note-opt">
                <label><i class="fas fa-clock"></i> Schedule for later</label>
                <input type="datetime-local" id="noteSchedule" class="note-schedule">
              </div>
              <div class="note-opt">
                <label><i class="fas fa-palette"></i> Theme</label>
                <div class="note-themes">
                  <button class="theme-dot active" data-theme="love" onclick="selectNoteTheme('love')" style="background:#e11d48"></button>
                  <button class="theme-dot" data-theme="ocean" onclick="selectNoteTheme('ocean')" style="background:#0ea5e9"></button>
                  <button class="theme-dot" data-theme="forest" onclick="selectNoteTheme('forest')" style="background:#10b981"></button>
                  <button class="theme-dot" data-theme="sunset" onclick="selectNoteTheme('sunset')" style="background:#f59e0b"></button>
                  <button class="theme-dot" data-theme="night" onclick="selectNoteTheme('night')" style="background:#6366f1"></button>
                </div>
              </div>
            </div>
            <button class="send-note-btn" onclick="sendLoveNote()"><i class="fas fa-paper-plane"></i> Send with Love</button>
          </div>
        </div>

        <!-- INBOX TAB -->
        <div id="inboxTab" class="note-section hidden">
          <div id="noteInbox" class="note-inbox"></div>
        </div>

        <!-- FUTURE LETTERS TAB -->
        <div id="futureTab" class="note-section hidden">
          <div class="compose-letter glass-premium">
            <h3>📜 Write a Future Letter</h3>
            <p class="letter-desc">Write a letter to your future selves. It will unlock on the date you choose.</p>
            <textarea id="letterText" class="note-textarea" placeholder="Dear future us..." maxlength="2000"></textarea>
            <div class="letter-date">
              <label>Unlock on:</label>
              <input type="date" id="letterDate" class="note-schedule" min="${new Date(Date.now() + 864e5).toISOString().split('T')[0]}">
            </div>
            <button class="send-note-btn" onclick="sendFutureLetter()"><i class="fas fa-lock"></i> Seal Letter</button>
          </div>
          <div id="lettersList" class="letters-list"></div>
        </div>
      </div>
    </div>`;
}

export function init() {
  loadInbox();
  loadLetters();
  listenNotes();
  return () => { unsubNotes?.(); };
}

window.switchNoteTab = function (tab) {
  document.querySelectorAll('.note-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.note-section').forEach(s => s.classList.add('hidden'));
  event.target.classList.add('active');
  const map = { send: 'sendTab', inbox: 'inboxTab', future: 'futureTab' };
  document.getElementById(map[tab])?.classList.remove('hidden');
  if (tab === 'inbox') loadInbox();
  if (tab === 'future') loadLetters();
};

window.selectNoteTheme = function (theme) {
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.remove('active'));
  document.querySelector(`.theme-dot[data-theme="${theme}"]`)?.classList.add('active');
  window.__noteTheme = theme;
};

window.sendLoveNote = async function () {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  if (!pid) { alert('You need a partner!'); return; }

  const text = document.getElementById('noteText')?.value?.trim();
  if (!text) { alert('Write something first!'); return; }

  const scheduleTime = document.getElementById('noteSchedule')?.value;
  const theme = window.__noteTheme || 'love';

  await addDoc(collection(db, "lovenotes"), {
    from: uid, to: pid, text, theme,
    scheduledFor: scheduleTime ? new Date(scheduleTime).toISOString() : null,
    isScheduled: !!scheduleTime,
    unlocked: !scheduleTime,
    seen: false,
    timestamp: serverTimestamp()
  });

  document.getElementById('noteText').value = '';
  document.getElementById('noteSchedule').value = '';
  alert(scheduleTime ? '💌 Note scheduled!' : '💌 Note sent!');
};

window.sendFutureLetter = async function () {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  if (!pid) { alert('You need a partner!'); return; }

  const text = document.getElementById('letterText')?.value?.trim();
  const date = document.getElementById('letterDate')?.value;
  if (!text || !date) { alert('Write a letter and pick a date!'); return; }

  const coupleId = [uid, pid].sort().join('_');
  await addDoc(collection(db, "letters", coupleId, "entries"), {
    text, unlockDate: date, writtenBy: uid,
    sealed: true, timestamp: serverTimestamp()
  });

  document.getElementById('letterText').value = '';
  document.getElementById('letterDate').value = '';
  alert('📜 Letter sealed! It will unlock on ' + date);
  loadLetters();
};

async function loadInbox() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const el = document.getElementById('noteInbox'); if (!el) return;

  const q = query(collection(db, "lovenotes"), orderBy("timestamp", "desc"));
  const snap = await getDocs(q);

  let html = '';
  const now = new Date();
  snap.forEach(d => {
    const n = d.data();
    if (n.to !== uid) return;

    // Check if scheduled note should be unlocked
    if (n.isScheduled && !n.unlocked) {
      const schedDate = new Date(n.scheduledFor);
      if (now < schedDate) {
        html += `
          <div class="note-card locked glass-premium">
            <div class="note-lock"><i class="fas fa-lock"></i></div>
            <p class="note-locked-text">A note is waiting for you...</p>
            <span class="note-unlock-time">Unlocks ${schedDate.toLocaleDateString()} at ${schedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>`;
        return;
      }
    }

    const themeColors = { love: '#e11d48', ocean: '#0ea5e9', forest: '#10b981', sunset: '#f59e0b', night: '#6366f1' };
    html += `
      <div class="note-card glass-premium" style="border-left:4px solid ${themeColors[n.theme] || '#e11d48'}">
        <div class="note-content"><p>${n.text}</p></div>
        <span class="note-time">${n.timestamp?.toDate?.()?.toLocaleDateString() || ''}</span>
      </div>`;
  });

  el.innerHTML = html || '<p class="no-notes">No love notes yet 💔</p>';
}

async function loadLetters() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  if (!pid) return;

  const el = document.getElementById('lettersList'); if (!el) return;
  const coupleId = [uid, pid].sort().join('_');

  const q = query(collection(db, "letters", coupleId, "entries"), orderBy("timestamp", "desc"));
  const snap = await getDocs(q);

  let html = '';
  const today = new Date().toISOString().split('T')[0];
  snap.forEach(d => {
    const l = d.data();
    const isUnlocked = today >= l.unlockDate;
    html += `
      <div class="letter-card glass-premium ${isUnlocked ? 'unlocked' : 'sealed'}">
        ${isUnlocked ? `
          <div class="letter-opened">
            <div class="letter-head"><i class="fas fa-envelope-open"></i> Opened</div>
            <p class="letter-text">${l.text}</p>
          </div>
        ` : `
          <div class="letter-sealed">
            <i class="fas fa-lock"></i>
            <p>Sealed until ${new Date(l.unlockDate).toLocaleDateString()}</p>
          </div>
        `}
        <span class="letter-date">Written ${l.timestamp?.toDate?.()?.toLocaleDateString() || ''}</span>
      </div>`;
  });

  el.innerHTML = html || '<p class="no-notes">No future letters yet. Write one!</p>';
}

function listenNotes() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const q = query(collection(db, "lovenotes"), orderBy("timestamp", "desc"), limit(1));
  unsubNotes = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const n = change.doc.data();
        if (n.to === uid && !n.seen && n.unlocked !== false) {
          showNoteNotification();
        }
      }
    });
  });
}

function showNoteNotification() {
  const notif = document.createElement('div');
  notif.className = 'gift-notification';
  notif.innerHTML = '<span class="notif-emoji">💌</span><p>You received a love note!</p>';
  document.body.appendChild(notif);
  setTimeout(() => { notif.classList.add('fade-out'); setTimeout(() => notif.remove(), 500); }, 4000);
}
