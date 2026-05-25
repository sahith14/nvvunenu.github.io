/**
 * Nuvvu Nenu Subscription Service
 * Couple-only plans. No public posts / non-partner messaging.
 * Plans: free, together_plus, forever
 * Tracks daily usage counters, feature availability, and resets.
 */
import { db } from "../firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    priceMonthly: 0,
    priceINR: 0,
    blurb: "The basics — keep talking and stay connected.",
    features: {
      unlimitedPartnerMessages: true,
      voiceNotesPerDay: 10,
      videoCallsHd: false,
      sleepTogetherMode: false,
      premiumThemes: false,
      coupleInsights: false,
      memoriesMax: 30,
      monthlyRecap: false,
      customAvatarFrames: false,
      prioritySupport: false,
      // Together+ specific
      syncedMusic: false,
      watchTogether: false,
      sharedMediaRooms: false,
      liveStatusWidgets: false,
      premiumGames: false,
      sharedPlaylists: false,
      cloudSync: false,
      screenShareHD: false,
      // Forever specific
      cinematicRecaps: false,
      relationshipCoach: false,
      anniversaryFilms: false,
      foreverVault: false,
      futureMessageCapsules: false,
      emotionalAnalytics: false,
      relationshipDocumentaries: false,
      customDomains: false,
      futureTimeline: false,
      exclusiveThemes: false,
    }
  },
  together_plus: {
    id: "together_plus",
    label: "Together+",
    priceMonthly: 4.99,
    priceINR: 414,
    blurb: "Synced music, watch-together, premium games, AI recaps and unlimited everything.",
    features: {
      unlimitedPartnerMessages: true,
      voiceNotesPerDay: -1,
      videoCallsHd: true,
      sleepTogetherMode: true,
      premiumThemes: true,
      coupleInsights: true,
      memoriesMax: -1,
      monthlyRecap: true,
      customAvatarFrames: false,
      prioritySupport: false,
      syncedMusic: true,
      watchTogether: true,
      sharedMediaRooms: true,
      liveStatusWidgets: true,
      premiumGames: true,
      sharedPlaylists: true,
      cloudSync: true,
      screenShareHD: true,
      // Forever specific
      cinematicRecaps: false,
      relationshipCoach: false,
      anniversaryFilms: false,
      foreverVault: false,
      futureMessageCapsules: false,
      emotionalAnalytics: false,
      relationshipDocumentaries: false,
      customDomains: false,
      futureTimeline: false,
      exclusiveThemes: false,
    }
  },
  forever: {
    id: "forever",
    label: "Forever",
    priceMonthly: 12.99,
    priceINR: 1078,
    blurb: "Ultimate emotional tier. Anniversary films, AI coach, future capsules, exclusive themes.",
    features: {
      unlimitedPartnerMessages: true,
      voiceNotesPerDay: -1,
      videoCallsHd: true,
      sleepTogetherMode: true,
      premiumThemes: true,
      coupleInsights: true,
      memoriesMax: -1,
      monthlyRecap: true,
      customAvatarFrames: true,
      prioritySupport: true,
      syncedMusic: true,
      watchTogether: true,
      sharedMediaRooms: true,
      liveStatusWidgets: true,
      premiumGames: true,
      sharedPlaylists: true,
      cloudSync: true,
      screenShareHD: true,
      cinematicRecaps: true,
      relationshipCoach: true,
      anniversaryFilms: true,
      foreverVault: true,
      futureMessageCapsules: true,
      emotionalAnalytics: true,
      relationshipDocumentaries: true,
      customDomains: true,
      futureTimeline: true,
      exclusiveThemes: true,
    }
  }
};

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function planDocPath(uid) {
  return doc(db, "users", uid, "subscription", "plan");
}

export async function getSubscription(uid) {
  if (!uid) return { plan: "free", ...PLANS.free };
  const snap = await getDoc(planDocPath(uid));
  if (!snap.exists()) return { plan: "free", ...PLANS.free };
  const data = snap.data();
  return { plan: data.plan || "free", ...PLANS[data.plan || "free"], usage: data.usage || {} };
}

export async function setSubscription(uid, planId) {
  if (!uid || !PLANS[planId]) throw new Error("Invalid plan");
  await setDoc(planDocPath(uid), {
    plan: planId,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { plan: planId, ...PLANS[planId] };
}

export async function trackUsage(uid, action, amount = 1) {
  const key = todayKey();
  const ref = planDocPath(uid);
  const snap = await getDoc(ref);
  const current = snap.data() || {};
  const usage = current.usage || {};
  const today = usage[key] || {};

  const updated = {
    ...usage,
    [key]: {
      ...today,
      [action]: (today[action] || 0) + amount
    }
  };
  await updateDoc(ref, { usage: updated });
  return updated[key][action];
}

export async function getUsage(uid, action) {
  const snap = await getDoc(planDocPath(uid));
  const data = snap.data() || {};
  const usage = data.usage || {};
  return (usage[todayKey()] || {})[action] || 0;
}

export function hasFeature(planId, feature) {
  const def = PLANS[planId] || PLANS.free;
  return !!def.features[feature];
}

export function getLimit(planId, feature) {
  const def = PLANS[planId] || PLANS.free;
  return def.features[feature] ?? 0;
}
