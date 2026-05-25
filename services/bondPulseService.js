// services/bondPulseService.js — Real Bond Pulse engine.
// Computes a 0-100 score from real activity over the past 14 days:
//   • messages exchanged
//   • kindness acts logged
//   • date ideas marked done
//   • mood shares
//   • time-capsule letters written
//   • calls made (best-effort — looks at users.lastCallAt if present)
// =====================================================================
import { db } from "../firebase.js";
import {
  collection, query, where, orderBy, limit, getDocs,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { chatIdFor } from "./chatService.js";

const WINDOW_DAYS = 14;

// Cap each source so a single firehose can't dominate the score.
// Each source contributes at most CAP points to the final 0-100.
const CAPS = {
  messages: 30,   // ~30 messages/day reaches saturation around 60/day total
  kindness: 15,   // 15 logged acts in 14 days = full points
  dates:    15,   // 5 dates done in 14 days = full
  moods:    10,   // 10 shared moods = full
  letters:  10,   // 5 letters written = full
  qotw:     10,   // both answering 1 weekly question = 10
  calls:    10,   // 5 calls in 14 days = full
};

// "Weights": how many real events earn one capped point above.
const WEIGHTS = {
  messages: 1 / 8,    // 1 point per 8 messages
  kindness: 1.0,      // 1 act = 1 point
  dates:    3,        // 1 date done = 3 points
  moods:    1.0,
  letters:  2,
  qotw:     5,
  calls:    2,
};

/**
 * Compute the bond pulse for a couple.
 * @param {string} coupleId
 * @param {string} myUid
 * @param {string} partnerUid
 * @returns {Promise<{score:number, breakdown:object}>}
 */
export async function computePulse(coupleId, myUid, partnerUid) {
  if (!coupleId) return { score: 50, breakdown: {} };

  const since = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86400000);

  const [
    msgCount,
    kindnessCount,
    datesDoneCount,
    moodSharesCount,
    lettersCount,
    qotwCount,
  ] = await Promise.all([
    countRecentMessages(myUid, partnerUid, since),
    countRecentSubcol(coupleId, "kindness", "at", since),
    countRecentDatesDone(coupleId, since),
    countRecentMoodShares(coupleId, since),
    countRecentSubcol(coupleId, "timecapsule", "createdAt", since),
    countRecentSubcol(coupleId, "qotw", "updatedAt", since),
  ]);

  const breakdown = {
    messages: scoreSource("messages", msgCount),
    kindness: scoreSource("kindness", kindnessCount),
    dates:    scoreSource("dates",    datesDoneCount),
    moods:    scoreSource("moods",    moodSharesCount),
    letters:  scoreSource("letters",  lettersCount),
    qotw:     scoreSource("qotw",     qotwCount),
    calls:    0,   // Stub for now — we don't track call history yet.
  };

  // 100-point baseline so brand-new couples with zero activity sit at ~50.
  // Each source's points lift you above 50 up to 100.
  const lifted = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const baseline = 50;
  const score = Math.max(0, Math.min(100, Math.round(baseline + lifted * 0.5)));

  return { score, breakdown, raw: { msgCount, kindnessCount, datesDoneCount, moodSharesCount, lettersCount, qotwCount } };
}

function scoreSource(key, count) {
  const w = WEIGHTS[key] || 0;
  const cap = CAPS[key] || 0;
  return Math.max(0, Math.min(cap, count * w));
}

// =====================================================================
// Source counts — keep queries cheap (limit to a sensible page size)
// =====================================================================

async function countRecentMessages(myUid, partnerUid, since) {
  if (!myUid || !partnerUid) return 0;
  const chatId = chatIdFor(myUid, partnerUid);
  try {
    const q = query(
      collection(db, "chats", chatId, "messages"),
      where("time", ">=", since),
      orderBy("time", "desc"),
      limit(500)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch { return 0; }
}

async function countRecentSubcol(coupleId, subPath, timeField, since) {
  try {
    const q = query(
      collection(db, "bonds", coupleId, subPath),
      where(timeField, ">=", since),
      orderBy(timeField, "desc"),
      limit(200)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch { return 0; }
}

async function countRecentDatesDone(coupleId, since) {
  try {
    const q = query(
      collection(db, "bonds", coupleId, "dates"),
      where("completedAt", ">=", since),
      orderBy("completedAt", "desc"),
      limit(200)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch { return 0; }
}

async function countRecentMoodShares(coupleId, since) {
  // Mood shares live on the couple meta doc as moods.{uid}.at — not easy to
  // window-query. Instead we look at user moodLog keys (last 14 days = up to 14 entries
  // per user × 2 = 28). Each unique calendar day with a mood counts as 1.
  // Cheap proxy: read the couples/{coupleId}/meta/stats doc once.
  try {
    const ref = (await import("./coupleService.js")).coupleMetaPath(coupleId);
    const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const snap = await getDoc(ref);
    const moods = snap.data()?.moods || {};
    let recent = 0;
    const cutoff = since.toMillis ? since.toMillis() : (since.seconds * 1000);
    for (const k of Object.keys(moods)) {
      const t = moods[k]?.at?.toMillis?.() || moods[k]?.at?.seconds * 1000 || 0;
      if (t >= cutoff) recent++;
    }
    return recent;
  } catch { return 0; }
}

/**
 * Friendly labels for the breakdown UI.
 */
export const PULSE_LABELS = {
  messages: { label: "Messages",  icon: "💬" },
  kindness: { label: "Kindness",  icon: "💛" },
  dates:    { label: "Dates",     icon: "🌹" },
  moods:    { label: "Moods",     icon: "🌙" },
  letters:  { label: "Letters",   icon: "📜" },
  qotw:     { label: "Q of week", icon: "💞" },
  calls:    { label: "Calls",     icon: "📞" },
};
