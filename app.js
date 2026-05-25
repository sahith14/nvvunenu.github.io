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

// Background services
import { startIncomingCallListener, stopIncomingCallListener } from './modules/incomingCall.js';
import { startPresence, stopPresence } from './services/presenceService.js';
import { initAppState, teardownAppState } from './state/appState.js';

const pages = {
  home:         renderHome,
  space:        renderSpace,
  chat:         renderChat,
  moments:      renderMoments,
  bond:         renderBond,
  profile:      renderProfile,
  subscription: renderSubscription
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

  loadPage('home');
});

// =========================================================================
// ROUTER
// =========================================================================
window.loadPage = function (page) {
  if (!pages[page]) return;

  // teardown the previous page (chat keeps live listeners)
  if (currentPage === 'chat' && page !== 'chat') {
    try { teardownChat(); } catch {}
  }
  if (typeof lastTeardown === 'function') {
    try { lastTeardown(); } catch {}
    lastTeardown = null;
  }

  currentPage = page;
  const container = document.getElementById('page');
  container.className = 'page-enter';
  container.innerHTML = '';
  Promise.resolve(pages[page](container)).catch((e) => console.warn('[router] page error', e));
  updateNav(page);
  // scroll to top on page swap
  container.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
};

function updateNav(page) {
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
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
