// =======================================================
// calendar.js — Shared Calendar for Couples
// =======================================================
import {
  doc, getDoc, addDoc, collection, query, orderBy, where,
  getDocs, deleteDoc, updateDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let unsubEvents = null;

export function render() {
  return `
    <div class="cal-container">
      <div class="cal-header glass-premium">
        <h2>📅 Shared Calendar</h2>
        <p class="cal-sub">Plan your love story together</p>
      </div>

      <div class="cal-nav glass-premium">
        <button class="cal-nav-btn" onclick="prevMonth()"><i class="fas fa-chevron-left"></i></button>
        <h3 id="calMonthYear"></h3>
        <button class="cal-nav-btn" onclick="nextMonth()"><i class="fas fa-chevron-right"></i></button>
      </div>

      <div class="cal-grid glass-premium" id="calGrid"></div>

      <div class="cal-events glass-premium">
        <div class="cal-events-header">
          <h3><i class="fas fa-list"></i> Upcoming Events</h3>
          <button class="add-event-btn" onclick="openEventForm()"><i class="fas fa-plus"></i></button>
        </div>
        <div id="eventsList" class="events-list"></div>
      </div>

      <div id="eventForm" class="event-form glass-premium hidden">
        <h3>Add Event</h3>
        <input id="evTitle" placeholder="Event title" class="ev-input">
        <input type="date" id="evDate" class="ev-input">
        <input type="time" id="evTime" class="ev-input">
        <select id="evType" class="ev-input">
          <option value="date">💕 Date Night</option>
          <option value="birthday">🎂 Birthday</option>
          <option value="anniversary">💍 Anniversary</option>
          <option value="trip">✈️ Trip</option>
          <option value="reminder">🔔 Reminder</option>
          <option value="other">📌 Other</option>
        </select>
        <textarea id="evNotes" placeholder="Notes..." class="ev-textarea" maxlength="300"></textarea>
        <div class="ev-actions">
          <button onclick="saveEvent()" class="ev-save"><i class="fas fa-check"></i> Save</button>
          <button onclick="closeEventForm()" class="ev-cancel">Cancel</button>
        </div>
      </div>
    </div>`;
}

export function init() {
  renderCalendar();
  loadEvents();
  return () => { unsubEvents?.(); };
}

function renderCalendar() {
  const grid = document.getElementById('calGrid'); if (!grid) return;
  const label = document.getElementById('calMonthYear');
  if (label) label.textContent = new Date(currentYear, currentMonth).toLocaleDateString('en', { month:'long', year:'numeric' });

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();

  let html = '<div class="cal-weekdays">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => html += `<div class="cal-wd">${d}</div>`);
  html += '</div><div class="cal-days">';

  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
    const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    html += `<div class="cal-day-cell ${isToday?'today':''}" data-date="${dateStr}" onclick="selectCalDate('${dateStr}')">
      <span class="day-num">${d}</span>
      <div class="day-dots" id="dots-${dateStr}"></div>
    </div>`;
  }
  html += '</div>';
  grid.innerHTML = html;
}

window.prevMonth = function() { currentMonth--; if(currentMonth<0){currentMonth=11;currentYear--;} renderCalendar(); loadEvents(); };
window.nextMonth = function() { currentMonth++; if(currentMonth>11){currentMonth=0;currentYear++;} renderCalendar(); loadEvents(); };

window.selectCalDate = function(date) {
  document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.cal-day-cell[data-date="${date}"]`)?.classList.add('selected');
  document.getElementById('evDate').value = date;
  openEventForm();
};

window.openEventForm = function() { document.getElementById('eventForm')?.classList.remove('hidden'); };
window.closeEventForm = function() { document.getElementById('eventForm')?.classList.add('hidden'); };

window.saveEvent = async function() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const title = document.getElementById('evTitle')?.value?.trim();
  const date = document.getElementById('evDate')?.value;
  const time = document.getElementById('evTime')?.value || '';
  const type = document.getElementById('evType')?.value || 'other';
  const notes = document.getElementById('evNotes')?.value?.trim() || '';

  if (!title || !date) { alert('Add title and date!'); return; }

  await addDoc(collection(db, "events", coupleId, "entries"), {
    title, date, time, type, notes, createdBy: uid, timestamp: serverTimestamp()
  });

  closeEventForm();
  ['evTitle','evDate','evTime','evNotes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  loadEvents();
};

async function loadEvents() {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const uSnap = await getDoc(doc(db, "users", uid));
  const pid = uSnap.data()?.partnerID;
  const coupleId = pid ? [uid, pid].sort().join('_') : uid;

  const q = query(collection(db, "events", coupleId, "entries"), orderBy("date"));
  const snap = await getDocs(q);

  const el = document.getElementById('eventsList'); if (!el) return;
  const typeIcons = { date:'💕', birthday:'🎂', anniversary:'💍', trip:'✈️', reminder:'🔔', other:'📌' };
  const today = new Date().toISOString().split('T')[0];

  let html = '';
  // Mark calendar dots
  snap.forEach(d => {
    const ev = d.data();
    const dotEl = document.getElementById(`dots-${ev.date}`);
    if (dotEl) dotEl.innerHTML += `<span class="ev-dot" style="background:${getTypeColor(ev.type)}"></span>`;

    if (ev.date >= today) {
      html += `
        <div class="event-item glass-premium">
          <span class="ev-icon">${typeIcons[ev.type]||'📌'}</span>
          <div class="ev-info">
            <strong>${ev.title}</strong>
            <span class="ev-date">${new Date(ev.date).toLocaleDateString('en',{month:'short',day:'numeric'})}${ev.time?' at '+ev.time:''}</span>
            ${ev.notes?`<p class="ev-notes">${ev.notes}</p>`:''}
          </div>
          <button class="ev-del" onclick="deleteEvent('${coupleId}','${d.id}')"><i class="fas fa-trash"></i></button>
        </div>`;
    }
  });

  el.innerHTML = html || '<p class="no-events">No upcoming events. Plan something!</p>';
}

window.deleteEvent = async function(coupleId, evId) {
  if (!confirm('Delete event?')) return;
  await deleteDoc(doc(db, "events", coupleId, "entries", evId));
  loadEvents();
};

function getTypeColor(type) {
  const colors = { date:'#e11d48', birthday:'#f59e0b', anniversary:'#a855f7', trip:'#0ea5e9', reminder:'#10b981', other:'#6b7280' };
  return colors[type] || '#6b7280';
}
