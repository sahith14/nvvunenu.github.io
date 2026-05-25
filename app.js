// =====================================================================
// NUVVU NENU — App Bootstrap (modular)
// Boots Firebase auth, presence, incoming-call listener, and the page router.
// =====================================================================
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Page modules
import { renderHome }         from './modules/home.js';
import { renderSpace }        from './modules/space.js';
import { renderMoments }      from './modules/moments.js';
import { renderBond }         from './modules/bond.js';
import { renderProfile }      from './modules/profile.js';
import { renderSubscription } from './modules/subscription.js';
import { renderChat, teardownChat } from './modules/chat.js';
import { renderFeed, teardownFeed } from './modules/feed.js';
import { renderSettings }     from './modules/settings.js';
import { renderSearch }       from './modules/search.js';
import { renderProfileView }  from './modules/profileView.js';
import { applyTheme, getStoredTheme } from './modules/settings.js';
// Side-effect: registers window.avatarFor / window.initialAvatar globals
import './modules/avatar.js';
// Side-effect: floating hearts BG + click sparkles + ripple + like-bursts
import './modules/cuteFx.js';

// Background services
import { startIncomingCallListener, stopIncomingCallListener } from './modules/incomingCall.js';
import { startPresence, stopPresence } from './services/presenceService.js';
import { initAppState, teardownAppState } from './state/appState.js';
import { ensureUsername } from './services/feedService.js';

// Apply saved theme as early as possible to avoid flash of wrong theme.
try { applyTheme(getStoredTheme()); } catch {}

const pages = {
  home:         renderHome,
  feed:         renderFeed,
  space:        renderSpace,
  chat:         renderChat,
  moments:      renderMoments,
  bond:         renderBond,
  profile:      renderProfile,
  subscription: renderSubscription,
  settings:     renderSettings,
  search:       renderSearch,
  profileView:  renderProfileView
};

// Pages whose entry exposes a teardownXxx() instead of returning a cleanup fn.
const customTeardowns = {
  chat: teardownChat,
  feed: teardownFeed
};

let currentPage = 'home';
let lastTeardown = null;

// =========================================================================
// AUTH GUARD
// =========================================================================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    teardownAppState();
    stopPresence();
    stopIncomingCallListener();
    window.location.href = 'login.html';
    return;
  }
  window.currentUser = user;

  // Boot background services
  initAppState(user);
  startPresence();
  startIncomingCallListener();
  // ensure the user has a username for search/discoverability (idempotent)
  ensureUsername(user).catch(() => {});

  loadPage('home');
});

// =========================================================================
// ROUTER
// =========================================================================
window.loadPage = function (page) {
  if (!pages[page]) return;

  // Run custom teardown for the OUTGOING page (matching old behavior)
  const outgoingTeardown = customTeardowns[currentPage];
  if (outgoingTeardown && page !== currentPage) {
    try { outgoingTeardown(); } catch (e) { console.warn('[router] teardown', currentPage, e); }
  }

  // Run cleanup returned by the previous render call
  if (typeof lastTeardown === 'function') {
    try { lastTeardown(); } catch (e) { console.warn('[router] cleanup', e); }
    lastTeardown = null;
  }

  currentPage = page;
  const container = document.getElementById('page');
  container.className = 'page-enter';
  container.innerHTML = '';

  // Highlight nav (search/settings have no nav button — that's fine)
  updateNav(page);
  // Reset scroll
  container.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Invoke render. If it returns a function, treat that as cleanup.
  Promise.resolve(pages[page](container))
    .then((maybeCleanup) => {
      if (typeof maybeCleanup === 'function') lastTeardown = maybeCleanup;
    })
    .catch((e) => console.warn('[router] page error', e));
};

function updateNav(page) {
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  // Settings/search are reachable from the header — highlight those if visible.
  document.querySelectorAll('.app-header .ah-btn[data-page]').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === page);
  });
}

// =========================================================================
// GLOBAL UTILITIES
// =========================================================================
window.showToast = function (msg, duration = 2500) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove('show'), duration);
};

window.getGreeting = function () {
  const h = new Date().getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
};
