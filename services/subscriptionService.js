/**
 * BondSync Subscription Service
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
    features: {
      unlimitedPartnerMessages: true,
      nonPartnerMessagesPerDay: 20,
      postsPerDay: 3,
      videoCallsToNonPartner: false,
      storyUpload: false,
      premiumThemes: false,
      coupleInsights: false,
      memoriesMax: 10,
      customAvatarFrames: false,
      prioritySupport: false
    }
  },
  together_plus: {
    id: "together_plus",
    label: "Together+",
    priceMonthly: 4.99,
    features: {
      unlimitedPartnerMessages: true,
      nonPartnerMessagesPerDay: 100,
      postsPerDay: 10,
      videoCallsToNonPartner: true,
      storyUpload: true,
      premiumThemes: true,
      coupleInsights: true,
      memoriesMax: 50,
      customAvatarFrames: false,
      prioritySupport: false
    }
  },
  forever: {
    id: "forever",
    label: "Forever",
    priceMonthly: 12.99,
    features: {
      unlimitedPartnerMessages: true,
      nonPartnerMessagesPerDay: -1, // unlimited
      postsPerDay: -1,
      videoCallsToNonPartner: true,
      storyUpload: true,
      premiumThemes: true,
      coupleInsights: true,
      memoriesMax: -1,
      customAvatarFrames: true,
      prioritySupport: true
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
