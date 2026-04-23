import * as feed from "./modules/feed.js";
import * as search from "./modules/search.js";
import * as messages from "./modules/messages.js";
import * as partner from "./modules/partner.js";
import * as space from "./modules/space.js";
import * as profile from "./modules/profile.js";
import * as profileView from "./modules/profileView.js";
import * as checkin from "./modules/checkin.js";
import * as memories from "./modules/memories.js";
import * as gifts from "./modules/gifts.js";
import * as dashboard from "./modules/dashboard.js";
import * as lovenotes from "./modules/lovenotes.js";
import * as calendar from "./modules/calendar.js";
import * as pet from "./modules/pet.js";
import * as dateplanner from "./modules/dateplanner.js";

const pages = {
  feed,
  search,
  messages,
  partner,
  space,
  profile,
  profileView,
  checkin,
  memories,
  gifts,
  dashboard,
  lovenotes,
  calendar,
  pet,
  dateplanner
};

window.loadPage = async function (page, data) {
  const container = document.getElementById("page");
  if (!container) return;

  if (!pages[page]) {
    console.error("Page not found:", page);
    return;
  }

  try {
    const mod = pages[page];

    container.innerHTML = mod.render(data || "");

    if (mod.init) {
      if (window.currentCleanup) {
        try { window.currentCleanup(); } catch { }
      }
      window.currentCleanup = mod.init();
    }

    document.querySelectorAll(".bottom-nav button, .desktop-nav button")
      .forEach(btn => btn.classList.remove("active"));

    const btn = document.getElementById(`nav-${page}`) ||
      document.getElementById(`nav-${page}-desktop`);
    if (btn) btn.classList.add("active");

    // Close drawer on mobile if open
    const drawer = document.getElementById('featureDrawer');
    if (drawer) drawer.classList.add('hidden');

  } catch (e) {
    console.error("Page load failed:", e);
  }
};

// Feature drawer toggle
window.toggleFeatureDrawer = function () {
  const drawer = document.getElementById('featureDrawer');
  if (drawer) drawer.classList.toggle('hidden');
};

// Auto-load feed on startup
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.loadPage('feed');
  } else {
    // Redirect to login if not authenticated
    window.location.href = 'login.html';
  }
});
