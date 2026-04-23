// =======================================================
// memories.js — Anniversary & Memory Timeline
// =======================================================
import {
  doc, getDoc, setDoc, collection, addDoc, query, orderBy,
  getDocs, deleteDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

export function render() {
  return `
    <div class="memories-container">
      <div class="memories-header glass-premium">
        <h2>💝 Our Memories</h2>
        <p class="mem-sub">Your love story, one moment at a time</p>
      </div>

      <div class="anniversary-card glass-premium" id="anniversaryCard"></div>

      <div class="add-memory glass-premium">
        <h3><i class="fas fa-plus-circle"></i> Add Memory</h3>
        <input id="memTitle" placeholder="What happened?" class="mem-input">
        <textarea id="memDesc" placeholder="Tell the story..." class="mem-textarea" maxlength="500"></textarea>
        <input type="date" id="memDate" class="mem-input">
        <input type="file" id="memMedia" accept="image/*" class="mem-file">
        <div id="memPreview" class="mem-preview"></div>
        <button class="mem-add-btn" onclick="addMemory()"><i class="fas fa-heart"></i> Save Memory</button>
      </div>

      <div class="timeline" id="memoryTimeline">
        <div class="timeline-loading">Loading memories...</div>
      </div>
    </div>`;
}

export function init() {
  loadAnniversary();
  loadMemories();
  setupMediaPreview();
  return () => {};
}

function setupMediaPreview() {
  setTimeout(() => {
    const input = document.getElementById('memMedia');
    if (input) input.onchange = (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      const el = document.getElementById('memPreview');
      if (el) el.innerHTML = `<img src="${url}" class="mem-preview-img">`;
    };
  }, 100);
}

async function loadAnniversary() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const u = uSnap.data();
  const card = document.getElementById('anniversaryCard'); if (!card) return;

  if (u?.partnerID) {
    const pSnap = await getDoc(doc(db, "users", u.partnerID));
    const p = pSnap.data();
    
    // Calculate relationship duration
    const startDate = u.matchedAt?.toDate?.() || u.partnerRequestAt?.toDate?.() || new Date();
    const now = new Date();
    const diff = now - startDate;
    const days = Math.floor(diff / 864e5);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    let durationText = `${days} days`;
    if (years > 0) durationText = `${years} year${years>1?'s':''}, ${months%12} month${months%12!==1?'s':''}`;
    else if (months > 0) durationText = `${months} month${months>1?'s':''}, ${days%30} days`;

    // Next anniversary
    const nextAnn = new Date(startDate);
    nextAnn.setFullYear(now.getFullYear());
    if (nextAnn < now) nextAnn.setFullYear(now.getFullYear() + 1);
    const daysToAnn = Math.ceil((nextAnn - now) / 864e5);

    card.innerHTML = `
      <div class="ann-header">
        <div class="ann-avatars">
          <img src="${u.avatar || u.photoURL || 'https://i.pravatar.cc/80?u=' + uid}" class="ann-av">
          <span class="ann-heart">💕</span>
          <img src="${p?.avatar || p?.photoURL || 'https://i.pravatar.cc/80?u=' + u.partnerID}" class="ann-av">
        </div>
        <h3>${u.username || 'You'} & ${p?.username || 'Partner'}</h3>
      </div>
      <div class="ann-stats">
        <div class="ann-stat"><span class="ann-num">${days}</span><span>Days</span></div>
        <div class="ann-stat"><span class="ann-num">${months}</span><span>Months</span></div>
        <div class="ann-stat"><span class="ann-num">${years}</span><span>Years</span></div>
      </div>
      <p class="ann-duration">Together for ${durationText}</p>
      ${daysToAnn <= 30 ? `<div class="ann-reminder">🎉 Anniversary in ${daysToAnn} days!</div>` : ''}
    `;
  } else {
    card.innerHTML = '<p class="no-partner">Find your partner to start your story 💘</p>';
  }
}

window.addMemory = async function() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const title = document.getElementById('memTitle')?.value?.trim();
  const desc = document.getElementById('memDesc')?.value?.trim();
  const date = document.getElementById('memDate')?.value;
  const file = document.getElementById('memMedia')?.files?.[0];

  if (!title) { alert('Add a title!'); return; }

  let mediaUrl = '';
  if (file) {
    // Convert to base64 for simplicity (in prod use Firebase Storage)
    mediaUrl = await fileToBase64(file);
  }

  await addDoc(collection(db, "memories", coupleId, "entries"), {
    title, description: desc || '', date: date || new Date().toISOString().split('T')[0],
    media: mediaUrl, createdBy: uid, createdAt: serverTimestamp()
  });

  // Clear form
  ['memTitle','memDesc','memDate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const preview = document.getElementById('memPreview'); if(preview) preview.innerHTML='';
  const fileInput = document.getElementById('memMedia'); if(fileInput) fileInput.value='';

  loadMemories();
};

async function loadMemories() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const q = query(collection(db, "memories", coupleId, "entries"), orderBy("date", "desc"));
  const snap = await getDocs(q);

  const el = document.getElementById('memoryTimeline'); if (!el) return;

  if (snap.empty) {
    el.innerHTML = '<div class="no-memories"><p>No memories yet. Start creating your love story! 💕</p></div>';
    return;
  }

  let html = '<div class="timeline-line">';
  snap.forEach(d => {
    const m = d.data();
    const dateObj = new Date(m.date);
    const monthStr = dateObj.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });

    html += `
      <div class="timeline-item glass-premium">
        <div class="timeline-dot"></div>
        <div class="timeline-date">${monthStr}</div>
        <div class="timeline-content">
          <h4>${m.title}</h4>
          ${m.description ? `<p>${m.description}</p>` : ''}
          ${m.media ? `<img src="${m.media}" class="timeline-img" loading="lazy">` : ''}
        </div>
        <button class="timeline-del" onclick="deleteMemory('${coupleId}','${d.id}')"><i class="fas fa-trash"></i></button>
      </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

window.deleteMemory = async function(coupleId, memId) {
  if (!confirm('Delete this memory?')) return;
  await deleteDoc(doc(db, "memories", coupleId, "entries", memId));
  loadMemories();
};

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}
