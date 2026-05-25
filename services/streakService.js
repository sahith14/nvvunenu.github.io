// services/streakService.js — Daily-streak engine.
// Increments users/{uid}.streak when the user opens the app on a calendar
// day after their last bump. Resets to 1 when the gap is greater than 1 day.
// Idempotent: multiple calls on the same calendar day are no-ops.
// =====================================================================
import { db } from "../firebase.js";
import {
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Avoid double-bumps in the same session
const _bumpedThisSession = new Set();

/**
 * @param {string} uid
 * @returns {Promise<{streak:number, bumped:boolean, reason:string}>}
 */
export async function bumpStreak(uid) {
  if (!uid) return { streak: 0, bumped: false, reason: "no-uid" };
  if (_bumpedThisSession.has(uid)) return { streak: 0, bumped: false, reason: "session-cached" };
  _bumpedThisSession.add(uid);

  const ref = doc(db, "users", uid);
  let snap;
  try { snap = await getDoc(ref); }
  catch { return { streak: 0, bumped: false, reason: "read-failed" }; }
  if (!snap.exists()) return { streak: 0, bumped: false, reason: "no-user-doc" };

  const data = snap.data() || {};
  const today = todayKey();
  const lastDay = data.streakLastDay || null;
  const currentStreak = Number(data.streak || 0);

  if (lastDay === today) {
    // Already bumped today — return current streak with no write.
    return { streak: currentStreak, bumped: false, reason: "already-today" };
  }

  // Determine new streak based on the gap between lastDay and today.
  let nextStreak;
  if (!lastDay) {
    nextStreak = 1;
  } else {
    const diff = daysBetween(lastDay, today);
    if (diff === 1)      nextStreak = currentStreak + 1;
    else if (diff <= 0)  nextStreak = currentStreak;        // clock skew safety
    else                 nextStreak = 1;                    // gap > 1 day → reset
  }

  try {
    await updateDoc(ref, {
      streak: nextStreak,
      streakLastDay: today,
      streakLastBumpAt: serverTimestamp(),
      // streak record stays so we can show "Best streak: X" later
      streakBest: Math.max(Number(data.streakBest || 0), nextStreak),
    });
  } catch {
    return { streak: currentStreak, bumped: false, reason: "write-failed" };
  }

  return { streak: nextStreak, bumped: true, reason: "ok" };
}

/** Read-only fetch of a user's current streak. */
export async function getStreak(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    return {
      streak: Number(d.streak || 0),
      streakBest: Number(d.streakBest || 0),
      streakLastDay: d.streakLastDay || null,
    };
  } catch { return null; }
}

// ---------- date helpers (calendar-day, local time) -----------------------
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(aKey, bKey) {
  const a = parseKey(aKey);
  const b = parseKey(bKey);
  if (!a || !b) return Infinity;
  return Math.round((b - a) / 86400000);
}

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  // Parse as local midnight to keep comparisons calendar-day stable.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}
