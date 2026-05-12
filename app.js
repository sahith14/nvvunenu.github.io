// NUVVU NENU — App Core
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Page modules
import { renderHome } from './modules/home.js';
import { renderSpace } from './modules/space.js';
import { renderMoments } from './modules/moments.js';
import { renderBond } from './modules/bond.js';
import { renderProfile } from './modules/profile.js';
import { renderSubscription } from './modules/subscription.js';

const pages = { home: renderHome, space: renderSpace, moments: renderMoments, bond: renderBond, profile: renderProfile, subscription: renderSubscription };
let currentPage = 'home';

// Auth guard
onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = 'login.html'; return; }
  window.currentUser = user;
  loadPage('home');
});

// Router
window.loadPage = function(page) {
  if (!pages[page]) return;
  currentPage = page;
  const container = document.getElementById('page');
  container.className = 'page-enter';
  container.innerHTML = '';
  pages[page](container);
  updateNav(page);
};

function updateNav(page) {
  document.querySelectorAll('.bottom-nav button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

// Toast utility
window.showToast = function(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
};

// Time greeting
window.getGreeting = function() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
};
