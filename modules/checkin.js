// =======================================================
// checkin.js — Daily Check-In + Streak + Countdown
// =======================================================
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

const MOODS = [
  { emoji:'😢', label:'Sad', value:1, color:'#6366f1' },
  { emoji:'😔', label:'Down', value:2, color:'#818cf8' },
  { emoji:'😐', label:'Meh', value:3, color:'#a78bfa' },
  { emoji:'🙂', label:'Okay', value:4, color:'#c084fc' },
  { emoji:'😊', label:'Good', value:5, color:'#e879f9' },
  { emoji:'😄', label:'Great', value:6, color:'#f472b6' },
  { emoji:'🥰', label:'Loved', value:7, color:'#fb7185' },
  { emoji:'😍', label:'Amazing', value:8, color:'#f43f5e' },
  { emoji:'🤩', label:'Ecstatic', value:9, color:'#e11d48' },
  { emoji:'💖', label:'Perfect', value:10, color:'#be185d' }
];

let unsubPartner = null;
let countdownInterval = null;

export function render() {
  return `
    <div class="checkin-container">
      <div class="checkin-header glass-premium">
        <div class="checkin-title-row">
          <h2>💫 Daily Check-In</h2>
          <div class="streak-badge" id="streakBadge"><i class="fas fa-fire"></i> <span id="streakCount">0</span></div>
        </div>
        <p class="checkin-sub">How are you feeling today?</p>
      </div>

      <div class="mood-selector glass-premium" id="moodSelector">
        <div class="mood-grid">
          ${MOODS.map(m=>`
            <button class="mood-btn" data-v="${m.value}" onclick="selectMood(${m.value})" style="--mc:${m.color}">
              <span class="mood-e">${m.emoji}</span>
              <span class="mood-l">${m.label}</span>
            </button>`).join('')}
        </div>
        <textarea id="moodNote" class="mood-note" placeholder="Add a note..." maxlength="200"></textarea>
        <button class="checkin-submit" onclick="submitCheckin()"><i class="fas fa-check-circle"></i> Check In</button>
      </div>

      <div id="todayStatus" class="today-status glass-premium hidden">
        <h3>Today's Vibe</h3>
        <div class="status-row"><div id="myMood"></div><div id="partnerMood"><p class="wait-txt">Waiting for partner...</p></div></div>
      </div>

      <div class="streak-section glass-premium">
        <h3><i class="fas fa-fire-alt"></i> Love Streak</h3>
        <div class="streak-num" id="streakNum">0</div>
        <p class="streak-lbl">days connected</p>
        <div class="streak-cal" id="streakCal"></div>
        <div class="milestones" id="milestones"></div>
      </div>

      <div class="mood-history glass-premium">
        <h3><i class="fas fa-chart-line"></i> Mood History</h3>
        <div class="mood-chart" id="moodChart"></div>
      </div>

      <div class="countdown-section glass-premium">
        <h3><i class="fas fa-hourglass-half"></i> Next Date</h3>
        <div id="countdownDisplay"><p>Set your next meeting date!</p>
          <button class="set-date-btn" onclick="openDatePicker()"><i class="fas fa-calendar-plus"></i> Set Date</button>
        </div>
        <div id="datePicker" class="hidden">
          <input type="datetime-local" id="meetDateInput" class="meet-input">
          <button class="save-date-btn" onclick="saveMeetDate()"><i class="fas fa-heart"></i> Save</button>
        </div>
      </div>
    </div>`;
}

export function init() {
  loadData(); loadStreak(); loadHistory(); loadCountdown();
  return () => { unsubPartner?.(); if(countdownInterval) clearInterval(countdownInterval); };
}

window.selectMood = function(v) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('selected', +b.dataset.v===v));
  window.__mood = v;
};

window.submitCheckin = async function() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const mood = window.__mood;
  if(!mood){ alert('Select a mood first!'); return; }
  const note = document.getElementById('moodNote')?.value?.trim()||'';
  const today = new Date().toISOString().split('T')[0];
  await setDoc(doc(db,"checkins",`${uid}_${today}`),{ userId:uid, mood, note, date:today, timestamp:serverTimestamp() });
  await updateStreak(uid);
  loadData(); loadStreak(); loadHistory();
};

async function loadData() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const today = new Date().toISOString().split('T')[0];
  const snap = await getDoc(doc(db,"checkins",`${uid}_${today}`));
  if(snap.exists()){
    const d = snap.data(); const m = MOODS.find(x=>x.value===d.mood);
    document.getElementById('moodSelector')?.classList.add('hidden');
    const st = document.getElementById('todayStatus'); if(st) st.classList.remove('hidden');
    const my = document.getElementById('myMood');
    if(my&&m) my.innerHTML=`<div class="mood-card" style="--mc:${m.color}"><span class="big-e">${m.emoji}</span><strong>${m.label}</strong>${d.note?`<p>"${d.note}"</p>`:''}</div>`;
  }
  const uSnap = await getDoc(doc(db,"users",uid));
  const pid = uSnap.data()?.partnerID;
  if(pid){ unsubPartner = onSnapshot(doc(db,"checkins",`${pid}_${today}`), s => {
    if(!s.exists()) return; const d=s.data(); const m=MOODS.find(x=>x.value===d.mood);
    const el=document.getElementById('partnerMood');
    if(el&&m) el.innerHTML=`<div class="mood-card partner" style="--mc:${m.color}"><span class="big-e">${m.emoji}</span><strong>Partner: ${m.label}</strong></div>`;
  }); }
}

async function updateStreak(uid) {
  const ref = doc(db,"streaks",uid); const snap = await getDoc(ref);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  if(snap.exists()){
    const d = snap.data();
    if(d.lastCheckin===yesterday) await updateDoc(ref,{ count:(d.count||0)+1, lastCheckin:today, longestStreak:Math.max(d.longestStreak||0,(d.count||0)+1), history:[...(d.history||[]).slice(-30),today] });
    else if(d.lastCheckin!==today) await setDoc(ref,{ count:1, lastCheckin:today, longestStreak:Math.max(d.longestStreak||0,1), history:[today] });
  } else await setDoc(ref,{ count:1, lastCheckin:today, longestStreak:1, history:[today] });
}

async function loadStreak() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const snap = await getDoc(doc(db,"streaks",uid)); if(!snap.exists()) return;
  const d = snap.data(); const c = d.count||0;
  const el1 = document.getElementById('streakNum'); if(el1) el1.textContent=c;
  const el2 = document.getElementById('streakCount'); if(el2) el2.textContent=c;
  const badge = document.getElementById('streakBadge'); if(badge) badge.classList.toggle('active',c>0);
  // Calendar
  const cal = document.getElementById('streakCal'); if(!cal) return;
  let h=''; for(let i=6;i>=0;i--){ const dt=new Date(); dt.setDate(dt.getDate()-i);
    const ds=dt.toISOString().split('T')[0]; const a=(d.history||[]).includes(ds);
    h+=`<div class="cal-day ${a?'active':''}">${a?'🔥':'○'}<span>${dt.toLocaleDateString('en',{weekday:'short'})}</span></div>`;
  } cal.innerHTML=h;
  // Milestones
  const ml = document.getElementById('milestones'); if(!ml) return;
  const ms = [{d:3,i:'🌱'},{d:7,i:'🌿'},{d:14,i:'🌸'},{d:30,i:'🌺'},{d:60,i:'💎'},{d:100,i:'👑'},{d:365,i:'🏆'}];
  ml.innerHTML = ms.map(m=>`<div class="ms ${c>=m.d?'done':''}">${m.i}<span>${m.d}d</span></div>`).join('');
}

async function loadHistory() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const el = document.getElementById('moodChart'); if(!el) return;
  let h='<div class="chart-bars">';
  for(let i=6;i>=0;i--){ const dt=new Date(); dt.setDate(dt.getDate()-i);
    const ds=dt.toISOString().split('T')[0];
    const snap = await getDoc(doc(db,"checkins",`${uid}_${ds}`));
    const mood = snap.exists()?snap.data().mood:0; const m=MOODS.find(x=>x.value===mood);
    h+=`<div class="bar-wrap"><div class="bar" style="height:${mood?(mood/10)*100:5}%;background:${m?.color||'#cbd5e1'}"></div><span>${dt.toLocaleDateString('en',{weekday:'short'})}</span></div>`;
  } h+='</div>'; el.innerHTML=h;
}

async function loadCountdown() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const snap = await getDoc(doc(db,"users",uid)); const md = snap.data()?.nextMeetDate;
  if(md) startTimer(new Date(md));
}

function startTimer(target) {
  const el = document.getElementById('countdownDisplay'); if(!el) return;
  if(countdownInterval) clearInterval(countdownInterval);
  function upd(){ const diff=target-new Date();
    if(diff<=0){ el.innerHTML='<div class="cd-done">🎉 It\'s time! Go meet your love!</div>'; return; }
    const d=Math.floor(diff/864e5), hr=Math.floor(diff%864e5/36e5), mn=Math.floor(diff%36e5/6e4), sc=Math.floor(diff%6e4/1e3);
    el.innerHTML=`<div class="cd-timer"><div class="cd-unit"><span class="cd-val">${d}</span><span class="cd-lbl">Days</span></div><span class="cd-sep">:</span><div class="cd-unit"><span class="cd-val">${String(hr).padStart(2,'0')}</span><span class="cd-lbl">Hrs</span></div><span class="cd-sep">:</span><div class="cd-unit"><span class="cd-val">${String(mn).padStart(2,'0')}</span><span class="cd-lbl">Min</span></div><span class="cd-sep">:</span><div class="cd-unit"><span class="cd-val">${String(sc).padStart(2,'0')}</span><span class="cd-lbl">Sec</span></div></div><button class="change-btn" onclick="openDatePicker()"><i class="fas fa-edit"></i></button>`;
  } upd(); countdownInterval=setInterval(upd,1000);
}

window.openDatePicker = function(){ document.getElementById('datePicker')?.classList.remove('hidden'); };

window.saveMeetDate = async function() {
  const uid = auth.currentUser?.uid; if(!uid) return;
  const v = document.getElementById('meetDateInput')?.value; if(!v) return;
  const iso = new Date(v).toISOString();
  await updateDoc(doc(db,"users",uid),{ nextMeetDate:iso });
  const uSnap = await getDoc(doc(db,"users",uid)); const pid=uSnap.data()?.partnerID;
  if(pid) await updateDoc(doc(db,"users",pid),{ nextMeetDate:iso });
  document.getElementById('datePicker')?.classList.add('hidden');
  startTimer(new Date(iso));
};
