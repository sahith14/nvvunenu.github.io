// =======================================================
// dateplanner.js — AI Date Planner + Vault (Simplified)
// =======================================================
import {
  doc, getDoc, addDoc, collection, query, orderBy,
  getDocs, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

const DATE_IDEAS = {
  indoor: [
    { title:'Movie Marathon Night', desc:'Pick a series and binge together with snacks', icon:'🎬', tags:['cozy','evening'] },
    { title:'Cook Together', desc:'Try a new recipe from a different cuisine', icon:'👨‍🍳', tags:['fun','creative'] },
    { title:'Board Game Night', desc:'Classic board games with hot cocoa', icon:'🎲', tags:['fun','evening'] },
    { title:'Spa Night', desc:'Face masks, candles, and relaxation', icon:'🧖', tags:['relaxing','evening'] },
    { title:'Art Session', desc:'Paint or draw portraits of each other', icon:'🎨', tags:['creative','fun'] },
    { title:'Karaoke Night', desc:'Sing your hearts out together', icon:'🎤', tags:['fun','evening'] },
    { title:'Puzzle Challenge', desc:'Work on a jigsaw puzzle as a team', icon:'🧩', tags:['cozy','calm'] },
    { title:'Dance at Home', desc:'Put on music and slow dance', icon:'💃', tags:['romantic','evening'] }
  ],
  outdoor: [
    { title:'Sunset Walk', desc:'Take a walk and watch the sunset together', icon:'🌅', tags:['romantic','evening'] },
    { title:'Picnic in the Park', desc:'Pack sandwiches and enjoy nature', icon:'🧺', tags:['fun','afternoon'] },
    { title:'Star Gazing', desc:'Find a dark spot and look at the stars', icon:'⭐', tags:['romantic','night'] },
    { title:'Bike Ride', desc:'Explore new paths on bikes', icon:'🚴', tags:['active','morning'] },
    { title:'Beach Day', desc:'Sand, waves, and sunshine', icon:'🏖️', tags:['fun','afternoon'] },
    { title:'Farmers Market', desc:'Browse local produce and try samples', icon:'🥕', tags:['fun','morning'] },
    { title:'Photography Walk', desc:'Capture moments around the city', icon:'📸', tags:['creative','afternoon'] },
    { title:'Garden Visit', desc:'Walk through a botanical garden', icon:'🌺', tags:['calm','afternoon'] }
  ],
  adventure: [
    { title:'Escape Room', desc:'Work together to solve puzzles', icon:'🔐', tags:['thrilling','afternoon'] },
    { title:'Go-Karting', desc:'Race each other on the track', icon:'🏎️', tags:['active','fun'] },
    { title:'Hiking Trail', desc:'Find a scenic trail and conquer it', icon:'🥾', tags:['active','morning'] },
    { title:'Zip Lining', desc:'Feel the rush together', icon:'🪂', tags:['thrilling','afternoon'] },
    { title:'Road Trip', desc:'Pick a random direction and drive', icon:'🚗', tags:['adventure','morning'] },
    { title:'Cooking Class', desc:'Learn a new cuisine together', icon:'🍝', tags:['fun','afternoon'] }
  ]
};

export function render() {
  return `
    <div class="dp-container">
      <div class="dp-header glass-premium">
        <h2>🗓️ AI Date Planner</h2>
        <p class="dp-sub">Let us plan your perfect date</p>
      </div>

      <div class="dp-filters glass-premium">
        <h3>What mood are you in?</h3>
        <div class="dp-mood-btns">
          <button class="dp-mood active" onclick="filterDates('all')">All</button>
          <button class="dp-mood" onclick="filterDates('indoor')">🏠 Indoor</button>
          <button class="dp-mood" onclick="filterDates('outdoor')">🌳 Outdoor</button>
          <button class="dp-mood" onclick="filterDates('adventure')">🎢 Adventure</button>
        </div>
        <div class="dp-time-filter">
          <button class="dp-time" onclick="filterByTime('morning')">🌅 Morning</button>
          <button class="dp-time" onclick="filterByTime('afternoon')">☀️ Afternoon</button>
          <button class="dp-time" onclick="filterByTime('evening')">🌙 Evening</button>
        </div>
      </div>

      <div class="dp-shuffle glass-premium">
        <button class="shuffle-btn" onclick="shuffleDateIdea()">
          <i class="fas fa-magic"></i> Surprise Me!
        </button>
        <div id="shuffleResult" class="shuffle-result"></div>
      </div>

      <div id="dateIdeas" class="dp-ideas"></div>

      <div class="saved-dates glass-premium">
        <h3><i class="fas fa-bookmark"></i> Saved Date Ideas</h3>
        <div id="savedDates" class="saved-list"></div>
      </div>
    </div>`;
}

export function init() {
  showAllDates();
  loadSavedDates();
  return () => {};
}

function showAllDates() {
  const el = document.getElementById('dateIdeas'); if (!el) return;
  let all = [];
  Object.entries(DATE_IDEAS).forEach(([cat, ideas]) => {
    ideas.forEach(i => all.push({ ...i, category: cat }));
  });
  renderIdeas(all);
}

function renderIdeas(ideas) {
  const el = document.getElementById('dateIdeas'); if (!el) return;
  el.innerHTML = ideas.map(i => `
    <div class="date-card glass-premium">
      <div class="dc-icon">${i.icon}</div>
      <div class="dc-info">
        <h4>${i.title}</h4>
        <p>${i.desc}</p>
        <div class="dc-tags">${(i.tags||[]).map(t=>`<span class="dc-tag">#${t}</span>`).join('')}</div>
      </div>
      <button class="dc-save" onclick="saveDateIdea('${i.title.replace(/'/g,"\\'")}','${i.icon}','${i.desc.replace(/'/g,"\\'")}')">
        <i class="fas fa-bookmark"></i>
      </button>
    </div>`).join('');
}

window.filterDates = function(cat) {
  document.querySelectorAll('.dp-mood').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (cat === 'all') { showAllDates(); return; }
  renderIdeas((DATE_IDEAS[cat]||[]).map(i => ({ ...i, category: cat })));
};

window.filterByTime = function(time) {
  let all = [];
  Object.entries(DATE_IDEAS).forEach(([cat, ideas]) => {
    ideas.forEach(i => { if (i.tags?.includes(time)) all.push({ ...i, category: cat }); });
  });
  renderIdeas(all);
};

window.shuffleDateIdea = function() {
  let all = [];
  Object.entries(DATE_IDEAS).forEach(([cat, ideas]) => {
    ideas.forEach(i => all.push({ ...i, category: cat }));
  });
  const pick = all[Math.floor(Math.random() * all.length)];
  const el = document.getElementById('shuffleResult');
  if (el) el.innerHTML = `
    <div class="shuffle-card glass-premium animate-pop">
      <span class="shuffle-icon">${pick.icon}</span>
      <h3>${pick.title}</h3>
      <p>${pick.desc}</p>
      <button class="save-shuffle" onclick="saveDateIdea('${pick.title.replace(/'/g,"\\'")}','${pick.icon}','${pick.desc.replace(/'/g,"\\'")}')">
        <i class="fas fa-bookmark"></i> Save
      </button>
    </div>`;
};

window.saveDateIdea = async function(title, icon, desc) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  await addDoc(collection(db, "dateideas", coupleId, "saved"), {
    title, icon, desc, savedBy: uid, timestamp: serverTimestamp()
  });
  alert('Date idea saved! 💕');
  loadSavedDates();
};

async function loadSavedDates() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const q = query(collection(db, "dateideas", coupleId, "saved"), orderBy("timestamp", "desc"));
  const snap = await getDocs(q);
  const el = document.getElementById('savedDates'); if (!el) return;

  let html = '';
  snap.forEach(d => {
    const s = d.data();
    html += `<div class="saved-item"><span>${s.icon}</span><span>${s.title}</span>
      <button onclick="removeSavedDate('${coupleId}','${d.id}')"><i class="fas fa-times"></i></button></div>`;
  });
  el.innerHTML = html || '<p>No saved dates yet</p>';
}

window.removeSavedDate = async function(coupleId, id) {
  await deleteDoc(doc(db, "dateideas", coupleId, "saved", id));
  loadSavedDates();
};
