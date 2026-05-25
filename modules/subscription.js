// =====================================================================
// modules/subscription.js — Plan selection page.
// Shows the 3 canonical plans (free / together_plus / forever).
// Wires to services/subscriptionService.js so featureGate sees changes.
// Mock checkout: confirms in a modal and writes the chosen plan.
// =====================================================================
import { onAppState } from "../state/appState.js";
import { toast, toastSuccess, toastWarn, toastError, safe } from "../utils/toast.js";
import { skeletonList } from "../utils/skeleton.js";
import {
  PLANS, getSubscription, setSubscription
} from "../services/subscriptionService.js";

// Regional pricing (display only — backend price stays canonical USD).
const RATES = {
  IN: { sym: "₹",   rate: 83 },
  GB: { sym: "£",   rate: 0.79 },
  US: { sym: "$",   rate: 1 },
  CA: { sym: "CA$", rate: 1.36 },
  AU: { sym: "A$",  rate: 1.51 },
  EU: { sym: "€",   rate: 0.92 },
  AE: { sym: "AED", rate: 3.67 },
  SG: { sym: "S$",  rate: 1.34 },
  JP: { sym: "¥",   rate: 156 },
  BR: { sym: "R$",  rate: 5.1 },
  PH: { sym: "₱",   rate: 58 },
  NG: { sym: "₦",   rate: 1500 },
  PK: { sym: "Rs",  rate: 280 },
  BD: { sym: "৳",   rate: 110 }
};
const FALLBACK = { sym: "$", rate: 1 };

function detectRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const loc = navigator.language || "";
    if (tz.includes("Calcutta") || tz.includes("Kolkata") || /-IN$/i.test(loc) || loc.startsWith("hi")) return "IN";
    if (tz.includes("London") || /-GB$/i.test(loc)) return "GB";
    if (tz.includes("Tokyo")) return "JP";
    if (tz.includes("Sao_Paulo")) return "BR";
    if (tz.includes("Dubai")) return "AE";
    if (tz.includes("Singapore")) return "SG";
    if (tz.includes("Sydney") || tz.includes("Melbourne")) return "AU";
    if (tz.includes("Toronto") || tz.includes("Vancouver")) return "CA";
    if (tz.includes("Manila")) return "PH";
    if (tz.includes("Lagos")) return "NG";
    if (tz.includes("Karachi")) return "PK";
    if (tz.includes("Dhaka")) return "BD";
    if (/Berlin|Paris|Rome|Madrid|Amsterdam|Vienna|Brussels|Lisbon|Athens|Warsaw/i.test(tz)) return "EU";
    if (/-US$/i.test(loc) || /America\/(New_York|Chicago|Los_Angeles|Denver|Phoenix)/.test(tz)) return "US";
    return null;
  } catch { return null; }
}

function priceLabel(planId, region) {
  const def = PLANS[planId];
  const usd = def?.priceMonthly || 0;
  if (!usd) return "Free";
  const r = RATES[region] || FALLBACK;
  // Show local currency rounded to integer when rate >= 1, else 2dp.
  const local = usd * r.rate;
  const rounded = local >= 50 ? Math.round(local) : Math.round(local * 100) / 100;
  return `${r.sym}${rounded}`;
}

// Feature display order + human labels (mirrors PLANS feature keys).
const FEATURE_LABELS = [
  ["unlimitedPartnerMessages", "Unlimited messages with your partner"],
  ["voiceNotesPerDay",         "Voice notes"],
  ["videoCallsHd",             "HD video calls"],
  ["sleepTogetherMode",        "Sleep Together mode"],
  ["premiumThemes",            "Premium themes"],
  ["coupleInsights",           "Couple insights"],
  ["memoriesMax",              "Memories"],
  ["monthlyRecap",             "Monthly recap"],
  ["customAvatarFrames",       "Custom avatar frames"],
  ["prioritySupport",          "Priority support"],
  ["cinematicRecaps",          "Cinematic recaps"],
  ["relationshipCoach",        "Relationship coach"]
];

function describeFeature(planId, [key, label]) {
  const v = PLANS[planId]?.features?.[key];
  if (v === true)        return `<li class="ok">${label}</li>`;
  if (v === -1)          return `<li class="ok">${label} <em>(unlimited)</em></li>`;
  if (typeof v === "number" && v > 0) return `<li class="ok">${label} <em>(${v}/day)</em></li>`;
  return `<li class="off">${label}</li>`;
}

let _container = null;
let _offState  = null;

export function renderSubscription(container) {
  _container = container;
  _container.innerHTML = `<div>${skeletonList(3, "card")}</div>`;

  _offState = onAppState(async (s) => {
    if (!s.ready) return;
    const sub = await safe(() => getSubscription(s.user.uid), "Couldn't load plan");
    paint(s, sub?.plan || "free");
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  _offState = null; _container = null;
}

function paint(state, currentPlan) {
  const region = detectRegion();
  const regionLabel = region ? ` (${region})` : "";
  const cards = ["free", "together_plus", "forever"].map((planId) => {
    const def     = PLANS[planId];
    const isCur   = planId === currentPlan;
    const featured = planId === "together_plus";
    const features = FEATURE_LABELS.map((entry) => describeFeature(planId, entry)).join("");

    return `
      <article class="plan-card ${featured ? "featured" : ""} ${isCur ? "current" : ""}" data-plan="${planId}">
        ${featured ? `<span class="plan-badge">Most popular</span>` : ""}
        ${isCur    ? `<span class="plan-current-badge">Current plan</span>` : ""}
        <div class="plan-name">${escapeHtml(def.label)}</div>
        <div class="plan-price">
          ${priceLabel(planId, region)}
          ${planId !== "free" ? `<span>/month</span>` : ""}
        </div>
        <ul class="plan-features">${features}</ul>
        <button class="btn ${featured ? "btn-primary" : "btn-ghost"}" data-act="${isCur ? "noop" : (planId === "free" ? "downgrade" : "upgrade")}" data-plan="${planId}">
          ${isCur ? "You're on this plan"
                  : planId === "free" ? "Downgrade to Free"
                  : "Choose " + def.label}
        </button>
      </article>`;
  }).join("");

  _container.innerHTML = `
    <section class="premium-page stagger">
      <header class="premium-header">
        <h2>Nuvvu Nenu Premium</h2>
        <p>Pricing detected for your region${regionLabel}. Choose what fits.</p>
      </header>
      ${cards}
      <p class="premium-fineprint">
        Real payment processing is coming soon. Selecting a paid plan now sets it on your account
        for testing only — no card is charged.
      </p>
    </section>
  `;

  _container.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const planId = btn.dataset.plan;
      if (act === "noop") return;
      if (act === "downgrade") return openDowngradeModal(state.user.uid, planId);
      openMockCheckout(state.user.uid, planId, region);
    });
  });
}

// --- Mock checkout modal ---
function openMockCheckout(uid, planId, region) {
  const def = PLANS[planId];
  const priceText = priceLabel(planId, region) + " / month";
  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="Confirm plan">
      <div class="bond-modal__head">Switch to ${escapeHtml(def.label)}</div>
      <div class="bond-modal__body">
        <p class="bond-modal__p">
          You're about to switch to <strong>${escapeHtml(def.label)}</strong> at <strong>${escapeHtml(priceText)}</strong>.
        </p>
        <p class="bond-modal__p" style="opacity:.85">
          💳 Real payment processing is coming soon. For now this just enables the plan on your
          account so you can preview the features.
        </p>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Cancel</button>
        <button class="btn btn-primary" data-act="ok">Proceed (mock)</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const okBtn = wrap.querySelector('[data-act="ok"]');
    okBtn.disabled = true;
    const ok = await safe(() => setSubscription(uid, planId), "Couldn't switch plan");
    okBtn.disabled = false;
    if (ok !== null) {
      close();
      toastSuccess(`You're on ${def.label} 💜`);
      try { window.cuteConfetti?.(80); } catch {}
      // Re-render with new plan
      const sub = await safe(() => getSubscription(uid), null);
      paint({ user: { uid } }, sub?.plan || planId);
    }
  });
}

function openDowngradeModal(uid, planId) {
  const wrap = document.createElement("div");
  wrap.className = "bond-modal";
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="Downgrade">
      <div class="bond-modal__head">Downgrade to Free?</div>
      <div class="bond-modal__body">
        <p class="bond-modal__p">You'll keep your data, but premium features will lock until you re-subscribe.</p>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Stay on current plan</button>
        <button class="btn btn-primary" data-act="ok">Downgrade</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener("click", close);
  wrap.querySelector('[data-act="ok"]').addEventListener("click", async () => {
    const ok = await safe(() => setSubscription(uid, "free"), "Couldn't switch plan");
    if (ok !== null) {
      close();
      toast("Switched to Free");
      const sub = await safe(() => getSubscription(uid), null);
      paint({ user: { uid } }, sub?.plan || "free");
    }
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
