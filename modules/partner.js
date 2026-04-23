import {
  collection, doc, getDoc, onSnapshot, updateDoc,
  query, getDocs, orderBy, startAt, endAt, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";

let livePosition = null;
let mapCenter = null;
const LOCATION_WRITE_INTERVAL_MS = 15000;
const LOCATION_MOVE_THRESHOLD_METERS = 10;

export function render() {
  if (window.partnerCleanup) window.partnerCleanup();
  setTimeout(() => { loadPartnerStatus(); startLiveLocationUpdates(); }, 0);

  return `
    <div class="partner-container">
      <div class="partner-page-head">
        <h2>Partner</h2>
        <button class="map-icon-btn" onclick="togglePartnerMap()" title="Live couple map">
          <i class="fas fa-map-marker-alt"></i>
        </button>
      </div>
      <input id="partnerSearch" oninput="searchPartner()" placeholder="Search partner by username...">
      <div id="partnerResults" class="partner-results"></div>
      <div id="partnerStatus"></div>
      <div id="partnerMap" class="partner-map-box hidden"></div>
      <div id="loveAnimation" class="love-animation hidden"></div>
    </div>`;
}

function loadPartnerStatus() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const userRef = doc(db, "users", uid);

  return onSnapshot(userRef, async (snap) => {
    const u = snap.data();
    const box = document.getElementById("partnerStatus");
    if (!box || !u) return;

    if (u.partnerID) {
      const pSnap = await getDoc(doc(db, "users", u.partnerID));
      const p = pSnap.data();
      box.innerHTML = `
        <div class="partner-box glass">
          <h3>You're in a relationship 💕</h3>
          <img src="${p?.avatar || p?.photoURL || 'https://i.pravatar.cc/100?u=' + u.partnerID}" class="partner-avatar">
          <p>${p?.username || "Your Partner"}</p>
          <span class="decision-status accepted">Status: Matched</span>
        </div>`;
      renderPartnerMap(u, p || {});
      return;
    }

    if (u.partnerRequestFrom) {
      const pSnap = await getDoc(doc(db, "users", u.partnerRequestFrom));
      const p = pSnap.data();
      box.innerHTML = `
        <div class="partner-box glass decision-card">
          <h3>Decision</h3>
          <p>${p?.username || "Someone"} wants to be your partner.</p>
          <span class="decision-status pending">Status: Pending</span>
          <div class="decision-actions">
            <button class="accept-btn" onclick="acceptPartner('${u.partnerRequestFrom}')">Yes</button>
            <button class="reject-btn" onclick="rejectPartner()">No</button>
          </div>
          <div class="ring-reveal" id="ringReveal">💍</div>
        </div>`;
      return;
    }

    if (u.partnerRequestTo) {
      box.innerHTML = `
        <div class="partner-box glass decision-card">
          <h3>Decision</h3>
          <p>Your request is waiting for response.</p>
          <span class="decision-status pending">Status: Pending</span>
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="partner-box glass decision-card">
        <h3>Decision</h3>
        <p>Find your partner and send a love request 💘</p>
        <span class="decision-status">Status: Not started</span>
      </div>`;
  });
}

window.searchPartner = async function() {
  const text = document.getElementById("partnerSearch")?.value.trim().toLowerCase() || "";
  const resultsBox = document.getElementById("partnerResults");
  if (!resultsBox) return;
  if (!text) { resultsBox.innerHTML = ""; return; }

  const q = query(collection(db, "users"), orderBy("username"), startAt(text), endAt(text + "\uf8ff"));
  const snap = await getDocs(q);
  let html = "";
  snap.forEach((docu) => {
    const u = docu.data();
    if (!u?.uid || u.uid === auth.currentUser?.uid) return;
    html += `
      <div class="partner-item glass">
        <img src="${u.avatar || 'https://i.pravatar.cc/100?u=' + u.uid}" class="partner-avatar">
        <div><p class="partner-name">${u.username || "user"}</p></div>
        <button onclick="sendPartnerReq('${u.uid}')" class="request-btn" title="Send request">💘</button>
      </div>`;
  });
  resultsBox.innerHTML = html || `<p class="no-results">No matching users found.</p>`;
};

window.sendPartnerReq = async function(targetUID) {
  const uid = auth.currentUser?.uid;
  if (!uid || uid === targetUID) return;
  await updateDoc(doc(db, "users", targetUID), { partnerRequestFrom: uid, partnerRequestAt: serverTimestamp() });
  await updateDoc(doc(db, "users", uid), { partnerRequestTo: targetUID, partnerRequestAt: serverTimestamp() });
  alert("Partner request sent 💌");
  loadPartnerStatus();
};

window.acceptPartner = async function(otherUID) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, "users", uid), { partnerID: otherUID, partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "matched" });
  await updateDoc(doc(db, "users", otherUID), { partnerID: uid, partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "matched" });
  showLoveAnimation(true);
  setTimeout(loadPartnerStatus, 1200);
};

window.rejectPartner = async function() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const meSnap = await getDoc(doc(db, "users", uid));
  const fromUid = meSnap.data()?.partnerRequestFrom;
  await updateDoc(doc(db, "users", uid), { partnerRequestFrom: null, partnerRequestTo: null, relationshipStatus: "single" });
  if (fromUid) await updateDoc(doc(db, "users", fromUid), { partnerRequestTo: null, relationshipStatus: "single" });
  alert("Request rejected.");
  loadPartnerStatus();
};

function showLoveAnimation(isAccepted = false) {
  const anim = document.getElementById("loveAnimation");
  if (!anim) return;
  anim.innerHTML = `
    <div class="heart-ring"></div>
    <div class="heart-burst">💖💘💝💞💓</div>
    ${isAccepted ? '<p class="match-msg">It\'s a match! You are couples now 💍</p>' : ""}`;
  document.getElementById("ringReveal")?.classList.add("show");
  anim.classList.remove("hidden");
  setTimeout(() => anim.classList.add("hidden"), 2000);
}

window.togglePartnerMap = function() {
  document.getElementById("partnerMap")?.classList.toggle("hidden");
};

function renderPartnerMap(me = {}, partner = {}) {
  const box = document.getElementById("partnerMap");
  if (!box) return;
  const myLoc = me.liveLocation;
  const partnerLoc = partner.liveLocation;
  if (!myLoc && !partnerLoc) { box.innerHTML = '<p class="map-note">Map will appear once location is available.</p>'; return; }
  const centerLat = partnerLoc?.lat || myLoc?.lat;
  const centerLng = partnerLoc?.lng || myLoc?.lng;
  if (!box.querySelector(".partner-map-frame")) {
    box.innerHTML = '<h4>Live couple map</h4><iframe class="partner-map-frame" loading="lazy"></iframe><div class="map-meta"></div>';
  }
  const frame = box.querySelector(".partner-map-frame");
  const meta = box.querySelector(".map-meta");
  const shouldUpdate = !mapCenter || Math.abs(mapCenter.lat - centerLat) > 0.0003 || Math.abs(mapCenter.lng - centerLng) > 0.0003;
  if (frame && shouldUpdate) { mapCenter = { lat: centerLat, lng: centerLng }; frame.src = buildMapUrl(centerLat, centerLng); }
  if (meta) {
    meta.innerHTML = `<span>Me: ${myLoc ? myLoc.lat.toFixed(4)+', '+myLoc.lng.toFixed(4) : "waiting..."}</span>
      <span>Partner: ${partnerLoc ? partnerLoc.lat.toFixed(4)+', '+partnerLoc.lng.toFixed(4) : "waiting..."}</span>`;
  }
}

function startLiveLocationUpdates() {
  const uid = auth.currentUser?.uid;
  if (!uid || !navigator.geolocation) return;
  let meData = {}, partnerData = {}, partnerUnsub = null, currentPartnerId = null, lastSentPosition = null, lastSentAt = 0, writeInFlight = false;

  const meUnsub = onSnapshot(doc(db, "users", uid), (snap) => {
    meData = snap.data() || {};
    if (meData.partnerID) {
      if (!partnerUnsub || currentPartnerId !== meData.partnerID) {
        partnerUnsub?.();
        partnerUnsub = onSnapshot(doc(db, "users", meData.partnerID), (ps) => { partnerData = ps.data() || {}; renderPartnerMap(meData, partnerData); });
        currentPartnerId = meData.partnerID;
      }
    } else if (partnerUnsub) { partnerUnsub(); partnerUnsub = null; currentPartnerId = null; partnerData = {}; }
    renderPartnerMap(meData, partnerData);
  });

  const watchId = navigator.geolocation.watchPosition(async (position) => {
    livePosition = { lat: position.coords.latitude, lng: position.coords.longitude };
    meData.liveLocation = { ...livePosition, updatedAt: Date.now() };
    renderPartnerMap(meData, partnerData);
    const now = Date.now();
    const movedEnough = !lastSentPosition || getDistanceMeters(lastSentPosition, livePosition) >= LOCATION_MOVE_THRESHOLD_METERS;
    const timeElapsed = now - lastSentAt >= LOCATION_WRITE_INTERVAL_MS;
    if ((!movedEnough && !timeElapsed) || writeInFlight) return;
    writeInFlight = true;
    try { await updateDoc(doc(db, "users", uid), { liveLocation: { lat: livePosition.lat, lng: livePosition.lng, updatedAt: now } }); lastSentPosition = { ...livePosition }; lastSentAt = now; }
    finally { writeInFlight = false; }
  }, (err) => console.warn("Location error", err), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });

  window.partnerCleanup = () => { meUnsub(); partnerUnsub?.(); currentPartnerId = null; navigator.geolocation.clearWatch(watchId); mapCenter = null; };
}

function buildMapUrl(lat, lng) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.008}%2C${lat-0.008}%2C${lng+0.008}%2C${lat+0.008}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function getDistanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const sinLat = Math.sin(dLat / 2), sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * sinLng * sinLng;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
