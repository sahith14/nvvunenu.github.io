// NUVVU NENU — Subscription Page (Regional Pricing)
import { db, auth } from '../firebase.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const PRICING = {
  IN: { currency: '₹', premium: 149, ultra: 499 },
  GB: { currency: '£', premium: 5, ultra: 15 },
  US: { currency: '$', premium: 7, ultra: 19 },
  CA: { currency: 'CA$', premium: 9, ultra: 24 },
  AU: { currency: 'A$', premium: 9, ultra: 24 },
  EU: { currency: '€', premium: 6, ultra: 17 },
  AE: { currency: 'AED', premium: 25, ultra: 69 },
  SG: { currency: 'S$', premium: 9, ultra: 25 },
  JP: { currency: '¥', premium: 980, ultra: 2800 },
  BR: { currency: 'R$', premium: 29, ultra: 89 },
  PH: { currency: '₱', premium: 299, ultra: 899 },
  NG: { currency: '₦', premium: 2500, ultra: 7500 },
  PK: { currency: 'Rs', premium: 500, ultra: 1500 },
  BD: { currency: '৳', premium: 250, ultra: 750 },
  DEFAULT: { currency: '$', premium: 7, ultra: 19 }
};

function getRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const locale = navigator.language || '';
    if (tz.includes('Calcutta') || tz.includes('Kolkata') || locale.startsWith('hi') || locale.includes('IN')) return 'IN';
    if (tz.includes('London') || locale.includes('GB')) return 'GB';
    if (tz.includes('Tokyo')) return 'JP';
    if (tz.includes('Sao_Paulo')) return 'BR';
    if (tz.includes('Dubai')) return 'AE';
    if (tz.includes('Singapore')) return 'SG';
    if (tz.includes('Sydney') || tz.includes('Melbourne')) return 'AU';
    if (tz.includes('Toronto') || tz.includes('Vancouver')) return 'CA';
    if (tz.includes('Manila')) return 'PH';
    if (tz.includes('Lagos')) return 'NG';
    if (tz.includes('Karachi')) return 'PK';
    if (tz.includes('Dhaka')) return 'BD';
    if (tz.includes('Berlin') || tz.includes('Paris') || tz.includes('Rome') || tz.includes('Madrid')) return 'EU';
    if (locale.startsWith('en-US') || tz.includes('America/New_York') || tz.includes('America/Chicago') || tz.includes('America/Los_Angeles')) return 'US';
    return 'DEFAULT';
  } catch { return 'DEFAULT'; }
}

export function renderSubscription(container) {
  const region = getRegion();
  const p = PRICING[region] || PRICING.DEFAULT;

  container.innerHTML = `
    <div class="premium-page stagger">
      <div class="premium-header">
        <h2>Nuvvu Nenu Premium</h2>
        <p>Unlock the full emotional experience</p>
      </div>

      <div class="free-tier">
        <h3>Free — Always</h3>
        <p>The essentials for staying connected</p>
        <ul>
          <li>Couple room & presence</li>
          <li>Mood check-ins</li>
          <li>5 memories per month</li>
          <li>Basic games</li>
          <li>Touch system</li>
        </ul>
      </div>

      <div class="plan-card featured">
        <span class="plan-badge">Most Popular</span>
        <div class="plan-name">Premium</div>
        <div class="plan-price">${p.currency}${p.premium}<span>/month</span></div>
        <ul class="plan-features">
          <li>Sleep together mode</li>
          <li>Unlimited cloud memories</li>
          <li>Monthly memory recaps</li>
          <li>Custom room themes</li>
          <li>Advanced couple games</li>
          <li>Voice journals</li>
          <li>Relationship insights</li>
          <li>Anniversary vault</li>
          <li>HD video calls</li>
        </ul>
        <button class="btn btn-primary" onclick="subscribe('premium')">Get Premium</button>
      </div>

      <div class="plan-card">
        <div class="plan-name">Ultra</div>
        <div class="plan-price">${p.currency}${p.ultra}<span>/month</span></div>
        <ul class="plan-features">
          <li>Everything in Premium</li>
          <li>Cinematic memory movies</li>
          <li>Real-time emotion sync</li>
          <li>Couple widgets</li>
          <li>Premium watch party</li>
          <li>Relationship coach</li>
          <li>Priority support</li>
          <li>Early access to new features</li>
        </ul>
        <button class="btn btn-ghost" onclick="subscribe('ultra')">Get Ultra</button>
      </div>
    </div>
  `;
}

window.subscribe = function(plan) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  setDoc(doc(db, 'subscriptions', uid), {
    plan, status: 'pending', requestedAt: serverTimestamp(), region: getRegion()
  }, { merge: true }).then(() => {
    window.showToast(`✨ ${plan.charAt(0).toUpperCase() + plan.slice(1)} requested! Payment integration coming soon.`);
  });
};
