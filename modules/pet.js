// =======================================================
// pet.js — Shared Virtual Pet
// =======================================================
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

const PET_STAGES = [
  { min:0, emoji:'🥚', name:'Egg', desc:'Just born!' },
  { min:10, emoji:'🐣', name:'Baby', desc:'Growing with love' },
  { min:30, emoji:'🐥', name:'Toddler', desc:'Getting stronger' },
  { min:60, emoji:'🐤', name:'Child', desc:'Full of energy' },
  { min:100, emoji:'🦜', name:'Teen', desc:'Almost grown up' },
  { min:150, emoji:'🦚', name:'Adult', desc:'Majestic!' },
  { min:250, emoji:'🐉', name:'Legend', desc:'Legendary love!' }
];

const FOOD_ITEMS = [
  { id:'berry', emoji:'🫐', name:'Berry', hp:5, happy:3 },
  { id:'cake', emoji:'🍰', name:'Cake', hp:8, happy:10 },
  { id:'fish', emoji:'🐟', name:'Fish', hp:10, happy:5 },
  { id:'star', emoji:'⭐', name:'Star Treat', hp:15, happy:15 }
];

let unsubPet = null;

export function render() {
  return `
    <div class="pet-container">
      <div class="pet-header glass-premium">
        <h2>🐾 Our Pet</h2>
        <p class="pet-sub">Raise your love pet together!</p>
      </div>

      <div class="pet-display glass-premium" id="petDisplay">
        <div class="pet-loading">Loading pet...</div>
      </div>

      <div class="pet-actions glass-premium">
        <h3>Feed & Play</h3>
        <div class="food-grid">
          ${FOOD_ITEMS.map(f => `
            <button class="food-btn" onclick="feedPet('${f.id}')">
              <span class="food-emoji">${f.emoji}</span>
              <span class="food-name">${f.name}</span>
              <span class="food-stats">+${f.hp}❤️ +${f.happy}😊</span>
            </button>`).join('')}
        </div>
        <div class="play-actions">
          <button class="play-btn" onclick="playWithPet()"><i class="fas fa-futbol"></i> Play</button>
          <button class="play-btn" onclick="petPet()"><i class="fas fa-hand-sparkles"></i> Pet</button>
          <button class="play-btn" onclick="singToPet()"><i class="fas fa-music"></i> Sing</button>
        </div>
      </div>

      <div class="pet-log glass-premium">
        <h3>Activity Log</h3>
        <div id="petLog" class="pet-log-list"></div>
      </div>
    </div>`;
}

export function init() {
  loadPet();
  return () => { unsubPet?.(); };
}

async function loadPet() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const petRef = doc(db, "pets", coupleId);
  const snap = await getDoc(petRef);

  if (!snap.exists()) {
    // Create pet
    await setDoc(petRef, {
      name: 'Love Bug', hp: 50, happiness: 50, xp: 0,
      lastFed: null, lastPlayed: null, createdAt: serverTimestamp(),
      log: []
    });
  }

  // Listen for real-time updates
  unsubPet = onSnapshot(petRef, (s) => {
    if (s.exists()) renderPet(s.data());
  });
}

function renderPet(pet) {
  const el = document.getElementById('petDisplay'); if (!el) return;
  const stage = getStage(pet.xp || 0);
  const hp = Math.min(Math.max(pet.hp || 0, 0), 100);
  const happy = Math.min(Math.max(pet.happiness || 0, 0), 100);

  el.innerHTML = `
    <div class="pet-scene">
      <div class="pet-emoji ${pet.lastAction === 'play' ? 'bouncing' : ''}">${stage.emoji}</div>
      <h3 class="pet-name">${pet.name || 'Love Bug'}</h3>
      <p class="pet-stage">${stage.name} — ${stage.desc}</p>
      <div class="pet-bars">
        <div class="pet-bar"><span class="bar-label">❤️ Health</span>
          <div class="bar-track"><div class="bar-fill hp" style="width:${hp}%"></div></div>
          <span class="bar-val">${hp}</span></div>
        <div class="pet-bar"><span class="bar-label">😊 Happiness</span>
          <div class="bar-track"><div class="bar-fill happy" style="width:${happy}%"></div></div>
          <span class="bar-val">${happy}</span></div>
        <div class="pet-bar"><span class="bar-label">⭐ XP</span>
          <div class="bar-track"><div class="bar-fill xp" style="width:${Math.min((pet.xp||0)/250*100,100)}%"></div></div>
          <span class="bar-val">${pet.xp||0}</span></div>
      </div>
      <button class="rename-btn" onclick="renamePet()"><i class="fas fa-pen"></i></button>
    </div>`;

  // Log
  const log = document.getElementById('petLog');
  if (log && pet.log) {
    log.innerHTML = (pet.log || []).slice(-10).reverse().map(l =>
      `<div class="log-item"><span>${l.emoji}</span><span>${l.text}</span><span class="log-time">${l.time || ''}</span></div>`
    ).join('') || '<p>No activity yet</p>';
  }
}

function getStage(xp) {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) { if (xp >= s.min) stage = s; }
  return stage;
}

async function getPetRef() {
  const uid = auth.currentUser?.uid; if (!uid) return null;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  return doc(db, "pets", pid ? [uid, pid].sort().join('_') : uid);
}

async function updatePetState(updates, logEntry) {
  const ref = await getPetRef(); if (!ref) return;
  const snap = await getDoc(ref); if (!snap.exists()) return;
  const pet = snap.data();
  const log = [...(pet.log || []).slice(-20), { ...logEntry, time: new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) }];
  await updateDoc(ref, { ...updates, log, lastAction: logEntry.action });
}

window.feedPet = async function(foodId) {
  const food = FOOD_ITEMS.find(f => f.id === foodId); if (!food) return;
  const ref = await getPetRef(); if (!ref) return;
  const snap = await getDoc(ref); const pet = snap.data();
  await updatePetState({
    hp: Math.min((pet.hp||0) + food.hp, 100),
    happiness: Math.min((pet.happiness||0) + food.happy, 100),
    xp: (pet.xp||0) + 2, lastFed: serverTimestamp()
  }, { emoji: food.emoji, text: `Fed with ${food.name}`, action:'feed' });
};

window.playWithPet = async function() {
  const ref = await getPetRef(); if (!ref) return;
  const snap = await getDoc(ref); const pet = snap.data();
  await updatePetState({
    happiness: Math.min((pet.happiness||0) + 15, 100),
    hp: Math.max((pet.hp||0) - 5, 0),
    xp: (pet.xp||0) + 5
  }, { emoji:'⚽', text:'Played together!', action:'play' });
};

window.petPet = async function() {
  const ref = await getPetRef(); if (!ref) return;
  const snap = await getDoc(ref); const pet = snap.data();
  await updatePetState({
    happiness: Math.min((pet.happiness||0) + 10, 100),
    xp: (pet.xp||0) + 2
  }, { emoji:'🤗', text:'Received pets and love', action:'pet' });
};

window.singToPet = async function() {
  const ref = await getPetRef(); if (!ref) return;
  const snap = await getDoc(ref); const pet = snap.data();
  await updatePetState({
    happiness: Math.min((pet.happiness||0) + 12, 100),
    xp: (pet.xp||0) + 3
  }, { emoji:'🎵', text:'Listened to a song', action:'sing' });
};

window.renamePet = async function() {
  const name = prompt('Name your pet:');
  if (!name?.trim()) return;
  const ref = await getPetRef(); if (!ref) return;
  await updateDoc(ref, { name: name.trim() });
};
