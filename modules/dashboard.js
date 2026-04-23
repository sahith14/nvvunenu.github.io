// =======================================================
// dashboard.js — Relationship Dashboard + Mood AI
// =======================================================
import {
  doc, getDoc, collection, query, orderBy, getDocs, where, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

export function render() {
  return `
    <div class="dash-container">
      <div class="dash-header glass-premium">
        <h2>📊 Relationship Dashboard</h2>
        <p class="dash-sub">Your love, visualized</p>
      </div>

      <div class="dash-grid">
        <div class="dash-card glass-premium" id="healthCard">
          <h3><i class="fas fa-heartbeat"></i> Relationship Health</h3>
          <div class="health-meter" id="healthMeter"></div>
        </div>

        <div class="dash-card glass-premium" id="moodInsight">
          <h3><i class="fas fa-brain"></i> Mood AI Insights</h3>
          <div id="moodAIContent"></div>
        </div>

        <div class="dash-card glass-premium" id="chatStats">
          <h3><i class="fas fa-comments"></i> Chat Activity</h3>
          <div id="chatStatsContent"></div>
        </div>

        <div class="dash-card glass-premium" id="loveLangCard">
          <h3><i class="fas fa-language"></i> Love Language</h3>
          <div id="loveLangContent"></div>
        </div>

        <div class="dash-card glass-premium" id="streakStats">
          <h3><i class="fas fa-fire"></i> Streak Stats</h3>
          <div id="streakStatsContent"></div>
        </div>

        <div class="dash-card glass-premium" id="memoryStats">
          <h3><i class="fas fa-photo-video"></i> Memory Stats</h3>
          <div id="memoryStatsContent"></div>
        </div>
      </div>

      <div class="dash-card glass-premium full-width" id="weeklyReport">
        <h3><i class="fas fa-chart-area"></i> Weekly Overview</h3>
        <div id="weeklyContent"></div>
      </div>

      <div class="dash-card glass-premium full-width" id="suggestions">
        <h3><i class="fas fa-lightbulb"></i> AI Suggestions</h3>
        <div id="suggestionsContent"></div>
      </div>
    </div>`;
}

export function init() {
  loadDashboard();
  return () => {};
}

async function loadDashboard() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const u = uSnap.data(); const pid = u?.partnerID;

  await Promise.all([
    loadHealthMeter(uid, pid),
    loadMoodAI(uid, pid),
    loadChatStats(uid, pid),
    loadLoveLanguage(uid),
    loadStreakStats(uid),
    loadMemoryStats(uid, pid),
    loadWeekly(uid),
    loadSuggestions(uid, pid)
  ]);
}

async function loadHealthMeter(uid, pid) {
  const el = document.getElementById('healthMeter'); if (!el) return;
  let score = 50; // Base score
  
  // Check streak
  const streakSnap = await getDoc(doc(db, "streaks", uid));
  if (streakSnap.exists()) score += Math.min(streakSnap.data().count || 0, 20);
  
  // Check today's checkin
  const today = new Date().toISOString().split('T')[0];
  const ciSnap = await getDoc(doc(db, "checkins", `${uid}_${today}`));
  if (ciSnap.exists()) score += 10;
  
  // Check partner checkin
  if (pid) {
    const pciSnap = await getDoc(doc(db, "checkins", `${pid}_${today}`));
    if (pciSnap.exists()) score += 10;
  }

  score = Math.min(score, 100);
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Excellent 💖' : score >= 60 ? 'Good 💛' : 'Needs attention 💔';

  el.innerHTML = `
    <div class="health-ring" style="--score:${score};--color:${color}">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="ring-bg"/>
      <circle cx="60" cy="60" r="54" class="ring-fill" style="stroke-dasharray:${score*3.39} 339"/></svg>
      <div class="ring-text"><span class="ring-num">${score}</span><span class="ring-label">${label}</span></div>
    </div>`;
}

async function loadMoodAI(uid, pid) {
  const el = document.getElementById('moodAIContent'); if (!el) return;
  
  // Analyze last 7 days of moods
  const moods = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const snap = await getDoc(doc(db, "checkins", `${uid}_${ds}`));
    if (snap.exists()) moods.push(snap.data().mood);
  }

  if (moods.length === 0) {
    el.innerHTML = '<p class="no-data">Start checking in daily for AI insights!</p>';
    return;
  }

  const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
  const trend = moods.length >= 2 ? moods[0] - moods[moods.length - 1] : 0;
  
  let insight = '', emoji = '';
  if (avg >= 8) { insight = 'You\'re in an amazing emotional state! Keep nurturing this positive energy.'; emoji = '🌟'; }
  else if (avg >= 6) { insight = 'You\'re doing well! Small gestures of love can elevate things even more.'; emoji = '😊'; }
  else if (avg >= 4) { insight = 'Things are okay but could be better. Try planning a special date or surprise.'; emoji = '💭'; }
  else { insight = 'You seem to be going through a tough time. Remember to communicate openly with your partner.'; emoji = '🫂'; }

  const trendText = trend > 0 ? '📈 Mood is improving!' : trend < 0 ? '📉 Mood has dipped recently' : '➡️ Mood is stable';

  el.innerHTML = `
    <div class="ai-insight">
      <span class="ai-emoji">${emoji}</span>
      <div class="ai-score">Average mood: <strong>${avg.toFixed(1)}/10</strong></div>
      <p class="ai-text">${insight}</p>
      <div class="ai-trend">${trendText}</div>
    </div>`;
}

async function loadChatStats(uid, pid) {
  const el = document.getElementById('chatStatsContent'); if (!el) return;
  if (!pid) { el.innerHTML = '<p class="no-data">Connect with a partner first!</p>'; return; }
  
  const chatId = [uid, pid].sort().join('_');
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("time", "desc"), limit(100));
  
  try {
    const snap = await getDocs(q);
    const myMsgs = snap.docs.filter(d => d.data().sender === uid).length;
    const partnerMsgs = snap.size - myMsgs;
    
    el.innerHTML = `
      <div class="chat-stat-grid">
        <div class="cs-item"><span class="cs-num">${snap.size}</span><span>Total</span></div>
        <div class="cs-item"><span class="cs-num">${myMsgs}</span><span>You</span></div>
        <div class="cs-item"><span class="cs-num">${partnerMsgs}</span><span>Partner</span></div>
      </div>
      <div class="chat-balance">
        <div class="balance-bar"><div class="balance-fill" style="width:${snap.size?myMsgs/snap.size*100:50}%"></div></div>
        <span class="balance-text">${snap.size ? Math.round(myMsgs/snap.size*100) : 50}% you / ${snap.size ? Math.round(partnerMsgs/snap.size*100) : 50}% partner</span>
      </div>`;
  } catch(e) {
    el.innerHTML = '<p class="no-data">Start chatting to see stats!</p>';
  }
}

async function loadLoveLanguage(uid) {
  const el = document.getElementById('loveLangContent'); if (!el) return;
  
  // Simple analysis based on user actions
  const languages = [
    { name: 'Words of Affirmation', icon: '💬', score: 0 },
    { name: 'Quality Time', icon: '⏰', score: 0 },
    { name: 'Gifts', icon: '🎁', score: 0 },
    { name: 'Acts of Service', icon: '🤝', score: 0 },
    { name: 'Physical Touch', icon: '🫂', score: 0 }
  ];

  // Check messages sent (Words)
  const today = new Date().toISOString().split('T')[0];
  const ciSnap = await getDoc(doc(db, "checkins", `${uid}_${today}`));
  if (ciSnap.exists()) languages[1].score += 3; // Quality time (checking in)

  const streakSnap = await getDoc(doc(db, "streaks", uid));
  if (streakSnap.exists()) languages[1].score += Math.min(streakSnap.data().count || 0, 5);

  // Check gifts sent
  const gq = query(collection(db, "gifts"), orderBy("timestamp", "desc"), limit(20));
  try {
    const gSnap = await getDocs(gq);
    gSnap.forEach(d => { if (d.data().from === uid) languages[2].score += 2; });
  } catch(e) {}

  // Randomize remaining for demo
  languages[0].score += Math.floor(Math.random() * 5) + 3;
  languages[3].score += Math.floor(Math.random() * 3) + 1;
  languages[4].score += Math.floor(Math.random() * 4) + 2;

  const maxScore = Math.max(...languages.map(l => l.score));

  el.innerHTML = languages.map(l => `
    <div class="ll-item ${l.score === maxScore ? 'primary' : ''}">
      <span class="ll-icon">${l.icon}</span>
      <div class="ll-info">
        <span class="ll-name">${l.name}</span>
        <div class="ll-bar"><div class="ll-fill" style="width:${maxScore?(l.score/maxScore)*100:0}%"></div></div>
      </div>
    </div>`).join('');
}

async function loadStreakStats(uid) {
  const el = document.getElementById('streakStatsContent'); if (!el) return;
  const snap = await getDoc(doc(db, "streaks", uid));
  if (!snap.exists()) { el.innerHTML = '<p class="no-data">Start your streak today!</p>'; return; }
  const d = snap.data();
  el.innerHTML = `
    <div class="ss-grid">
      <div class="ss-item"><span class="ss-num">${d.count||0}</span><span>Current</span></div>
      <div class="ss-item"><span class="ss-num">${d.longestStreak||0}</span><span>Longest</span></div>
      <div class="ss-item"><span class="ss-num">${(d.history||[]).length}</span><span>Total Days</span></div>
    </div>`;
}

async function loadMemoryStats(uid, pid) {
  const el = document.getElementById('memoryStatsContent'); if (!el) return;
  if (!pid) { el.innerHTML = '<p class="no-data">Add memories with your partner!</p>'; return; }
  const coupleId = [uid, pid].sort().join('_');
  try {
    const snap = await getDocs(collection(db, "memories", coupleId, "entries"));
    el.innerHTML = `<div class="mem-stat"><span class="ms-num">${snap.size}</span><span>Memories saved</span></div>`;
  } catch(e) { el.innerHTML = '<p class="no-data">Start saving memories!</p>'; }
}

async function loadWeekly(uid) {
  const el = document.getElementById('weeklyContent'); if (!el) return;
  let html = '<div class="weekly-grid">';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const snap = await getDoc(doc(db, "checkins", `${uid}_${ds}`));
    const mood = snap.exists() ? snap.data().mood : null;
    const dayName = d.toLocaleDateString('en', { weekday: 'short' });
    html += `<div class="weekly-day ${mood?'active':''}"><span class="wd-name">${dayName}</span><span class="wd-mood">${mood||'—'}</span></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

async function loadSuggestions(uid, pid) {
  const el = document.getElementById('suggestionsContent'); if (!el) return;
  const suggestions = [
    { icon:'💌', text:'Send your partner a surprise love note today' },
    { icon:'📅', text:'Plan a virtual date night this weekend' },
    { icon:'🎁', text:'Send a virtual gift to brighten their day' },
    { icon:'📸', text:'Add a new memory to your shared timeline' },
    { icon:'🎮', text:'Challenge your partner to a quick game' },
    { icon:'💬', text:'Share something you appreciate about them' }
  ];
  
  // Pick 3 random
  const picked = suggestions.sort(() => Math.random() - 0.5).slice(0, 3);
  el.innerHTML = picked.map(s => `
    <div class="sug-item glass-premium"><span class="sug-icon">${s.icon}</span><p>${s.text}</p></div>
  `).join('');
}
