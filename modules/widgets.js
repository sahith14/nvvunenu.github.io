// modules/widgets.js — Widget gallery / preview page.
// Live previews of "lock-screen-style" widgets in iOS and Android
// Material You styles. Reads partner + couple meta from appState
// + subscribes to couple meta for moods.
// =====================================================================
import { onAppState } from "../state/appState.js";
import { subscribeCoupleMeta } from "../services/coupleService.js";
import { formatActivity } from "../services/presenceService.js";
import { skeletonList } from "../utils/skeleton.js";

let _container = null;
let _offState  = null;
let _unsubMeta = null;
let _state     = null;
let _meta      = null;

export function renderWidgets(container) {
  _container = container;
  _container.innerHTML = `<div class="wg-loading">${skeletonList(2, "card")}</div>`;

  _offState = onAppState((s) => {
    if (!s.ready) return;
    _state = s;
    if (s.coupleId && !_unsubMeta) {
      _unsubMeta = subscribeCoupleMeta(s.coupleId, (m) => { _meta = m; paint(); });
    }
    paint();
  });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); } catch {}
  try { _unsubMeta?.(); } catch {}
  _offState = null; _unsubMeta = null;
  _state = null; _meta = null;
  _container = null;
}

// =====================================================================
// Render
// =====================================================================
function paint() {
  if (!_container || !_state) return;
  const me      = _state.user || {};
  const partner = _state.partner || {};
  const startedAt = _meta?.startedAt?.toMillis?.() || _meta?.startedAt?.seconds * 1000 || null;

  const days   = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 86400000)) : 0;
  const streak = me.streak || _meta?.streak || 0;
  const myMood   = _meta?.moods?.[me.uid]?.emoji      || me.currentMood || null;
  const yrsMood  = _meta?.moods?.[partner?.uid]?.emoji || partner.currentMood || null;
  const partnerName = partner.displayName?.split(" ")[0] || partner.username || "Partner";
  const activity = partner.activity ? formatActivity(partner.activity) : null;
  const status = me.customStatus || partner.customStatus || "Together always";
  const annivCountdown = computeAnniversaryCountdown(startedAt);

  // 6 widgets × 2 OS styles each
  const widgets = [
    { key: "timer",   icon: "💞", title: "Relationship timer",   primary: `${days} days`,    secondary: "since you started" },
    { key: "annivers",icon: "🎂", title: "Anniversary",          primary: annivCountdown.label, secondary: annivCountdown.sub },
    { key: "streak",  icon: "🔥", title: "Streak",               primary: `${streak} days`,  secondary: "shared every day" },
    { key: "mood",    icon: "🌙", title: "Mood",                 primary: `${myMood || "·"} · ${yrsMood || "·"}`, secondary: myMood && yrsMood ? "in sync" : "share a mood today" },
    { key: "partact", icon: "🟢", title: "Partner activity",     primary: activity ? `${activity.icon} ${activity.text}` : `${partnerName} · idle`, secondary: activity ? "just now" : "tap home to nudge" },
    { key: "status",  icon: "✨", title: "Custom status",        primary: status, secondary: "tap to edit" },
  ];

  _container.innerHTML = `
    <div class="wg-page stagger">
      <header class="wg-hero">
        <h2 class="wg-hero__title">Lock-screen widgets</h2>
        <p class="wg-hero__sub">A live preview of the widgets we'll ship for iOS and Android Material You.<br>Add real native widgets requires app installs — for now, this is your interactive showcase.</p>
      </header>

      <section class="wg-section">
        <div class="wg-section__head">
          <span class="wg-os">iOS</span>
          <h3>Lock-screen style</h3>
        </div>
        <div class="wg-grid wg-grid--ios">
          ${widgets.map(w => iosCard(w)).join("")}
        </div>
      </section>

      <section class="wg-section">
        <div class="wg-section__head">
          <span class="wg-os wg-os--md">Material You</span>
          <h3>Android style</h3>
        </div>
        <div class="wg-grid wg-grid--md">
          ${widgets.map(w => mdCard(w)).join("")}
        </div>
      </section>

      <p class="wg-hint">When the iOS / Android apps ship, picking widgets will be a one-tap flow from your phone's widget gallery. Until then, these previews update live while the app is open.</p>
    </div>
  `;
}

// ----- iOS-style: small frosted glass with strong primary line -----------
function iosCard(w) {
  return `
    <article class="wg-card wg-card--ios">
      <div class="wg-card__top">
        <span class="wg-card__icon">${w.icon}</span>
        <span class="wg-card__title">${escapeHtml(w.title)}</span>
      </div>
      <div class="wg-card__primary">${escapeHtml(String(w.primary))}</div>
      <div class="wg-card__secondary">${escapeHtml(String(w.secondary))}</div>
    </article>`;
}

// ----- Android Material You: rounded square with bigger emoji ------------
function mdCard(w) {
  return `
    <article class="wg-card wg-card--md">
      <div class="wg-card__icon-md">${w.icon}</div>
      <div class="wg-card__title-md">${escapeHtml(w.title)}</div>
      <div class="wg-card__primary-md">${escapeHtml(String(w.primary))}</div>
      <div class="wg-card__secondary-md">${escapeHtml(String(w.secondary))}</div>
    </article>`;
}

function computeAnniversaryCountdown(startedAt) {
  if (!startedAt) return { label: "—", sub: "set a start date" };
  const start = new Date(startedAt);
  const now = new Date();
  const next = new Date(now.getFullYear(), start.getMonth(), start.getDate());
  if (next < now) next.setFullYear(now.getFullYear() + 1);
  const days = Math.ceil((next - now) / 86400000);
  if (days === 0) return { label: "Today!", sub: "Happy anniversary 💜" };
  return { label: `${days} days`, sub: `until ${next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` };
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
