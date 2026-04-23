// ===========================
// Instagram-Style Search System
// ===========================
import {
  collection,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  onSnapshot,
  getDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { db, auth } from "../firebase.js";

// ---------------------------
// GLOBALS
// ---------------------------
window.myFollowingList = [];
let touchStartX = 0;

// ---------------------------
// LOAD USER FOLLOWING LIST
// ---------------------------
if (auth) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;
    try {
      const s = await getDoc(doc(db, "users", user.uid));
      window.myFollowingList = s.data()?.following || [];
    } catch (error) {
      console.error("Error loading following list:", error);
      window.myFollowingList = [];
    }
  });
}

// ---------------------------
// SAVE RECENT SEARCH
// ---------------------------
window.saveRecentSearch = function (uid, name, username, avatar) {
  try {
    let recent = JSON.parse(localStorage.getItem("recentSearches") || "[]");

    // remove duplicates
    recent = recent.filter((r) => r.uid !== uid);

    // add new
    recent.unshift({ 
      uid, 
      name: name || 'User', 
      username: username || 'user', 
      avatar: avatar || 'img/default/default-avatar.png' 
    });

    // limit to 8
    if (recent.length > 8) recent = recent.slice(0, 8);

    localStorage.setItem("recentSearches", JSON.stringify(recent));
  } catch (error) {
    console.error("Error saving recent search:", error);
  }
};

// ---------------------------
// DELETE RECENT SEARCH
// ---------------------------
window.deleteRecent = function (uid) {
  try {
    let recent = JSON.parse(localStorage.getItem("recentSearches") || "[]");
    recent = recent.filter((r) => r.uid !== uid);
    localStorage.setItem("recentSearches", JSON.stringify(recent));
    loadRecentSearches();
  } catch (error) {
    console.error("Error deleting recent search:", error);
  }
};

// ---------------------------
// SWIPE GESTURES FOR RECENT ITEMS
// ---------------------------
window.touchStart = function (e) {
  touchStartX = e.touches[0].clientX;
  e.currentTarget.style.transition = "none";
};

window.touchMove = function (e) {
  const diff = e.touches[0].clientX - touchStartX;
  const el = e.currentTarget;

  if (diff < -25) {
    el.style.transform = "translateX(-70px)";
  }
};

window.touchEnd = function (e) {
  const el = e.currentTarget;
  el.style.transition = "transform 0.2s ease";
  
  if (parseInt(el.style.transform) < -30) {
    el.style.transform = "translateX(-70px)";
  } else {
    el.style.transform = "translateX(0)";
  }
};

// ---------------------------
// LOAD RECENT SEARCHES INTO UI
// ---------------------------
function loadRecentSearches() {
  const box = document.getElementById("recentBox");
  if (!box) return;

  try {
    let recent = JSON.parse(localStorage.getItem("recentSearches") || "[]");

    if (recent.length === 0) {
      box.innerHTML = `<p class="no-recent">No recent searches</p>`;
      return;
    }

    let html = `<p class="recent-title">Recent</p>`;

    recent.forEach((r) => {
      html += `
        <div class="recent-item"
            ontouchstart="touchStart(event)"
            ontouchmove="touchMove(event)"
            ontouchend="touchEnd(event)">

          <img src="${r.avatar || 'img/default/default-avatar.png'}" 
               class="recent-avatar"
               loading="lazy">

          <div class="recent-info"
               onclick="saveRecentSearch('${r.uid}', \`${r.name}\`, \`${r.username}\`, \`${r.avatar || ''}\`); openUserProfile('${r.uid}')"
               onmouseenter="preloadProfile('${r.uid}')">
            <p>${r.name}</p>
            <span>@${r.username}</span>
          </div>

          <button class="delete-recent" onclick="event.stopPropagation(); deleteRecent('${r.uid}')">✕</button>
        </div>
      `;
    });

    box.innerHTML = html;
  } catch (error) {
    console.error("Error loading recent searches:", error);
    box.innerHTML = `<p class="no-recent">Error loading recent searches</p>`;
  }
}

// ---------------------------
// LIVE USER SEARCH
// ---------------------------
window.liveUserSearch = function () {
  const input = document.getElementById("searchInput");
  const text = input.value.trim().toLowerCase();
  const recentBox = document.getElementById("recentBox");
  const resultsBox = document.getElementById("searchResults");

  if (!recentBox || !resultsBox) return;

  // Collapse recent when typing
  if (!text) {
    recentBox.style.display = "block";
    resultsBox.innerHTML = "";
    return;
  }

  recentBox.style.display = "none";

  try {
    // Query users by username
    const q = query(
      collection(db, "users"),
      orderBy("username"),
      startAt(text),
      endAt(text + "\uf8ff")
    );

    // Use onSnapshot for real-time updates
    if (window.searchUnsubscribe) {
      window.searchUnsubscribe();
    }

    window.searchUnsubscribe = onSnapshot(q, (snap) => {
      let html = "";

      snap.forEach((d) => {
        const u = d.data();
        const uid = d.id;

        if (!u.username?.toLowerCase().includes(text)) return;

        html += userResultCard(uid, u);
      });

      resultsBox.innerHTML = html || `<p class='no-results'>No users found</p>`;
    }, (error) => {
      console.error("Search error:", error);
      resultsBox.innerHTML = `<p class='error-msg'>Search error</p>`;
    });
  } catch (error) {
    console.error("Error setting up search:", error);
    resultsBox.innerHTML = `<p class='error-msg'>Search unavailable</p>`;
  }
};

// ---------------------------
// BUILD USER RESULT CARD
// ---------------------------
function userResultCard(uid, u) {
  // Mutual followers logic
  let mutualLine = "";
  const myFollowing = window.myFollowingList || [];
  const currentUser = auth.currentUser;

  if (u.followers && currentUser) {
    const mutual = u.followers.filter((x) => myFollowing.includes(x));

    if (mutual.length === 1) mutualLine = `Followed by ${mutual[0]}`;
    else if (mutual.length === 2)
      mutualLine = `Followed by ${mutual[0]}, ${mutual[1]}`;
    else if (mutual.length > 2)
      mutualLine = `Followed by ${mutual[0]}, ${mutual[1]} + ${mutual.length - 2} more`;
  }

  const isFollowing = currentUser && u.followers?.includes(currentUser.uid);

  return `
    <div class="user-card glass"
         onclick="saveRecentSearch('${uid}', \`${u.name}\`, \`${u.username}\`, \`${u.avatar || ''}\`); openUserProfile('${uid}')"
         onmouseenter="preloadProfile('${uid}')">

      <img src="${u.avatar || 'img/default/default-avatar.png'}" 
           class="user-avatar"
           loading="lazy">

      <div class="user-info">
        <p class="username">@${u.username || 'user'}</p>
        <p class="name">${u.name || 'User'}</p>

        ${mutualLine
          ? `<p class='mutual-line'>${mutualLine}</p>`
          : (currentUser && u.following?.includes(currentUser.uid))
          ? `<p class='follows-you'>Follows you</p>`
          : ""}
      </div>

      ${currentUser && currentUser.uid !== uid ? `
        <button class="followBtn"
                id="follow-${uid}"
                onclick="event.stopPropagation(); toggleFollow('${uid}')">
          ${isFollowing ? "Following" : "Follow"}
        </button>
      ` : ''}

    </div>
  `;
}

// ---------------------------
// OPEN PROFILE FROM SEARCH
// ---------------------------
// ---------------------------
// OPEN PROFILE FROM SEARCH - FIXED!
// ---------------------------
// ---------------------------
// OPEN PROFILE FROM SEARCH - SIMPLE FIX
// ---------------------------
window.openUserProfile = function (uid, name, username, avatar) {
  console.log("Opening profile for:", uid);
  
  // Save to recent searches
  if (name && username) {
    saveRecentSearch(uid, name, username, avatar);
  }
  
  // Clear any search listeners
  if (window.searchUnsubscribe) {
    window.searchUnsubscribe();
    window.searchUnsubscribe = null;
  }
  
  // Get the page container
  const page = document.getElementById("page");
  if (!page) return;
  
  // Import and render profileView directly
  import("./profileView.js").then(module => {
    page.innerHTML = module.render(uid);
    
    // Clear nav active states
    document.querySelectorAll(
      ".bottom-nav button, .desktop-nav button, .vision-nav button"
    ).forEach(btn => btn.classList.remove("active"));
  }).catch(error => {
    console.error("Error loading profile:", error);
  });
};

// ---------------------------
// PRELOAD PROFILE ON HOVER
// ---------------------------
window.preloadProfile = async function (uid) {
  // Already cached → skip
  if (window.profileCache && window.profileCache[uid]) return;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;

    // Store in shared cache
    if (!window.profileCache) window.profileCache = {};
    window.profileCache[uid] = snap.data();
  } catch (e) {
    // Silent fail (preload should never break UI)
    console.debug("Preload failed (non-critical):", e);
  }
};

// ---------------------------
// FOLLOW TOGGLE FOR SEARCH RESULTS
// ---------------------------
window.toggleFollow = async function (uid) {
  try {
    const me = auth.currentUser?.uid;
    if (!me) {
      alert("Please sign in to follow users");
      return;
    }

    if (me === uid) {
      alert("You cannot follow yourself");
      return;
    }

    const meRef = doc(db, "users", me);
    const targetRef = doc(db, "users", uid);

    const snap = await getDoc(meRef);
    const meData = snap.data();

    const isFollowing = meData.following?.includes(uid);
    const btn = document.getElementById(`follow-${uid}`);

    if (btn) {
      if (isFollowing) {
        btn.textContent = "Follow";
        await updateDoc(meRef, { following: arrayRemove(uid) });
        await updateDoc(targetRef, { followers: arrayRemove(me) });
      } else {
        btn.textContent = "Following";
        await updateDoc(meRef, { following: arrayUnion(uid) });
        await updateDoc(targetRef, { followers: arrayUnion(me) });
      }
    }

    // Update following list
    const updatedSnap = await getDoc(meRef);
    window.myFollowingList = updatedSnap.data()?.following || [];
  } catch (error) {
    console.error("Error toggling follow:", error);
    alert("Error updating follow status");
  }
};

// ---------------------------
// INIT SEARCH PAGE
// ---------------------------
export function init() {
  loadRecentSearches();
  
  // Clear any existing listeners
  if (window.searchUnsubscribe) {
    window.searchUnsubscribe();
    window.searchUnsubscribe = null;
  }
}

// ---------------------------
// RENDER SEARCH PAGE
// ---------------------------
export function render() {
  return `
    <div class="search-container">
      <input id="searchInput" 
             class="search-input" 
             placeholder="Search..." 
             oninput="liveUserSearch()"
             autocomplete="off" />

      <div id="recentBox" class="recent-search-list"></div>

      <div id="searchResults" class="search-results"></div>
    </div>
  `;
}

// Cleanup function
export function cleanup() {
  if (window.searchUnsubscribe) {
    window.searchUnsubscribe();
    window.searchUnsubscribe = null;
  }
}


