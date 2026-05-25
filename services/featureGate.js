// =====================================================================
// services/featureGate.js — enforces plan-based limits and triggers
// upgrade prompts. Reads from subscriptionService.js.
//
// Feature keys MUST match those defined in PLANS in subscriptionService.js:
//   unlimitedPartnerMessages, voiceNotesPerDay, videoCallsHd,
//   sleepTogetherMode, premiumThemes, coupleInsights, memoriesMax,
//   monthlyRecap, customAvatarFrames, prioritySupport,
//   cinematicRecaps, relationshipCoach
// =====================================================================
import {
  getSubscription, getUsage, trackUsage, getLimit, hasFeature, PLANS
} from "./subscriptionService.js";
import { toast, toastWarn } from "../utils/toast.js";

// ---------- helpers ----------
function uid() {
  try { return window.appState?.user?.uid || null; } catch { return null; }
}
function isPartner(otherUid) {
  try { return Boolean(otherUid) && window.appState?.partner?.uid === otherUid; } catch { return false; }
}

// ---------- core check ----------
/**
 * Generic counter-based gate.
 * @param {string} action       usage key stored under users/{uid}/subscription/plan.usage
 * @param {string} featureKey   PLANS feature key whose value is the daily limit (-1 = unlimited)
 * @param {number} amount       how much to track on success
 */
export async function trackAndCheck(action, featureKey, amount = 1) {
  const u = uid();
  if (!u) return { allowed: true, remaining: -1, reason: "no_user" };

  const sub = await getSubscription(u);
  const limit = getLimit(sub.plan, featureKey);
  if (limit === -1) return { allowed: true, remaining: -1 };
  if (typeof limit !== "number") return { allowed: true, remaining: -1 };

  const used = await getUsage(u, action);
  if (used >= limit) {
    showUpgradePrompt(featureKey);
    return { allowed: false, remaining: 0, used, limit };
  }

  const newUsed = await trackUsage(u, action, amount);
  return { allowed: true, remaining: limit - newUsed, used: newUsed, limit };
}

/** Boolean-feature gate (no counter). */
export async function requireFeature(featureKey) {
  const u = uid();
  if (!u) return { allowed: true };
  const sub = await getSubscription(u);
  if (hasFeature(sub.plan, featureKey)) return { allowed: true };
  showUpgradePrompt(featureKey);
  return { allowed: false };
}

// ---------- canonical gates used across modules ----------
export async function gatePartnerMessage(otherUid) {
  // Partner messaging is unlimited on every plan; non-partner DMs are not
  // part of the product (couple-centric). This always allows.
  if (isPartner(otherUid)) return { allowed: true };
  return { allowed: true }; // future: rate-limit non-partner DMs here
}

export async function gateVoiceNote() {
  return trackAndCheck("voiceNote", "voiceNotesPerDay", 1);
}

export async function gateVideoCallHd() {
  return requireFeature("videoCallsHd");
}

export async function gateSleepTogether() {
  return requireFeature("sleepTogetherMode");
}

export async function gatePremiumTheme() {
  return requireFeature("premiumThemes");
}

export async function gateCoupleInsights() {
  return requireFeature("coupleInsights");
}

export async function gateAddMemory() {
  const u = uid();
  if (!u) return { allowed: true };
  const sub = await getSubscription(u);
  const limit = getLimit(sub.plan, "memoriesMax"); // -1 = unlimited
  if (limit === -1) return { allowed: true, remaining: -1 };
  // memory count is stored by memoryService; for now check usage counter
  const used = await getUsage(u, "memoryAdded");
  if (used >= limit) { showUpgradePrompt("memoriesMax"); return { allowed: false, used, limit }; }
  await trackUsage(u, "memoryAdded", 1);
  return { allowed: true, remaining: limit - (used + 1) };
}

export async function gateMonthlyRecap()      { return requireFeature("monthlyRecap"); }
export async function gateCustomAvatarFrame() { return requireFeature("customAvatarFrames"); }
export async function gateRelationshipCoach() { return requireFeature("relationshipCoach"); }
export async function gateCinematicRecap()    { return requireFeature("cinematicRecaps"); }

// ---------- upgrade prompt plumbing ----------
const FEATURE_LABELS = {
  voiceNotesPerDay:      "more voice notes",
  videoCallsHd:          "HD video calls",
  sleepTogetherMode:     "Sleep Together mode",
  premiumThemes:         "premium themes",
  coupleInsights:        "couple insights",
  memoriesMax:           "unlimited memories",
  monthlyRecap:          "monthly recap",
  customAvatarFrames:    "custom avatar frames",
  prioritySupport:       "priority support",
  cinematicRecaps:       "cinematic recaps",
  relationshipCoach:     "relationship coach"
};

let _upgradeCallback = null;
export function setUpgradePromptCallback(fn) { _upgradeCallback = fn; }

export function showUpgradePrompt(featureKey) {
  const label = FEATURE_LABELS[featureKey] || "this feature";
  if (_upgradeCallback) {
    try { _upgradeCallback(featureKey, label); return; } catch (e) { console.warn(e); }
  }
  // Fallback: toast and route to subscription page if available
  toastWarn(`Upgrade to unlock ${label}.`);
  if (typeof window !== "undefined" && typeof window.loadPage === "function") {
    setTimeout(() => window.loadPage("subscription"), 700);
  }
}

export function getPlanName(planId) { return PLANS[planId]?.label || "Free"; }
