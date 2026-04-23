// =======================================================
// profileView.js — Instagram Style Tabs + Vision Header
// =======================================================

import {
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  arrayUnion,
  arrayRemove,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { auth, db } from "../firebase.js";

// MAIN PAGE RENDER
// -------------------------------------------------------
export function render(uid) {
  // CHECK UID FIRST — prevents Firebase crash
  if (!uid) {
    console.error("❌ profileView ERROR — UID missing");
    return `<p style="color:red;text-align:center;">Profile not found</p>`;
  }

  // Save UID for tab switching
  window.lastPVUID = uid;

  // Load profile after HTML is rendered
  setTimeout(() => loadProfile(uid), 25);

  // RETURN PAGE LAYOUT
  return `
    <div class="vision-profile-main profile-view">
    
      <button class="pv-back" onclick="backToSearch()">←</button>

      <div id="pvHeader" class="vision-header glass-card"></div>

      <div id="pvHighlights" class="pv-highlights"></div>

      <div id="pvTabs" class="pv-tabs-instagram"></div>

      <div id="pvContent" class="vision-content-area">Loading…</div>

      <div id="postModal" class="vision-post-modal hidden">
        <span class="modal-close" onclick="closePostModal()">×</span>
        <img id="modalImage">
      </div>

      <div id="profileActionsModal" class="profile-actions-modal hidden">
        <div class="actions-modal-content">
          <button class="action-btn report" onclick="reportUser('${uid}')">Report</button>
          <button class="action-btn block" onclick="blockUser('${uid}')">Block</button>
          <button class="action-btn restrict" onclick="restrictUser('${uid}')">Restrict</button>
          <button class="action-btn cancel" onclick="closeActionsModal()">Cancel</button>
        </div>
      </div>

    </div>
  `;
}

let modalTouchStartY = 0;
let touchStartX = 0;
const profileCache = {}; 
const followCountCache = {};
let mutualFollowersCache = {};

// LOAD PROFILE DATA
// -------------------------------------------------------
async function loadProfile(uid) {
  let u;

  // 🔑 USE CACHE IF AVAILABLE
  if (profileCache[uid]) {
    u = profileCache[uid];
  } else {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      document.getElementById("pvContent").innerHTML = 
        `<p class="no-content">User not found</p>`;
      return;
    }

    u = snap.data();
    profileCache[uid] = u; // cache it
  }

  const me = auth.currentUser?.uid;
  if (!me) {
    console.error("❌ No authenticated user");
    return;
  }

  const followsYou = u.following?.includes(me);
  const isFollowing = u.followers?.includes(me);
  const isOwnProfile = me === uid;

  // Get mutual followers
  const mutualFollowers = await getMutualFollowers(me, uid);
  
  // Load highlights/stories
  await loadHighlights(uid);

  // Render profile header
  document.getElementById("pvHeader").innerHTML = `
    <div class="profile-header-box">
      <div class="pv-avatar-section">
        <img src="${u.avatar || 'img/default/default-avatar.png'}" class="pv-avatar">
        ${isOwnProfile ? `<button class="add-story-btn" onclick="addToStory()">+</button>` : ''}
      </div>

      <div class="pv-info">
        <div class="pv-top-row">
          <h2 class="pv-username">${u.username || 'user'}</h2>
          <div class="pv-action-buttons">
            ${isOwnProfile ? `
              <button class="pv-btn edit-profile" onclick="editProfile()">
                Edit Profile
              </button>
              <button class="pv-btn menu-btn" onclick="showProfileMenu()">⋮</button>
            ` : `
              <button class="pv-btn message" onclick="openDM('${uid}')">
                ${isFollowing ? 'Message' : 'Message'}
              </button>
              <button class="pv-btn follow" id="followBtnPV" onclick="toggleFollow('${uid}')">
                ${isFollowing ? 'Following' : 'Follow'}
              </button>
              <button class="pv-btn menu-btn" onclick="showProfileActions('${uid}')">⋮</button>
            `}
          </div>
        </div>

        <div class="pv-stats">
          <span><b>${u.postsCount || 0}</b> Posts</span>
          <span><b>${u.followers?.length || 0}</b> Followers</span>
          <span><b>${u.following?.length || 0}</b> Following</span>
        </div>
        
        <div class="pv-bio-section">
          <h3 class="pv-display-name">${u.name || u.username || 'User'}</h3>
          
          ${u.bio ? `<p class="pv-bio">${u.bio}</p>` : ''}
          
          ${u.website ? `
            <a href="${u.website}" class="pv-website" target="_blank" rel="noopener noreferrer">
              ${u.website.replace(/^https?:\/\//, '')}
            </a>
          ` : ''}
          
          ${u.profession || u.education ? `
            <p class="pv-details">
              ${u.profession ? `${u.profession}${u.education ? ' • ' : ''}` : ''}
              ${u.education || ''}
            </p>
          ` : ''}
        </div>

        ${mutualFollowers.length > 0 ? `
          <div class="pv-mutual-followers">
            <div class="mutual-avatars">
              ${mutualFollowers.slice(0, 3).map(f => `
                <img src="${f.avatar || 'img/default/default-avatar.png'}" 
                     class="mutual-avatar" 
                     title="${f.name}"
                     onclick="openUserProfile('${f.uid}')">
              `).join('')}
            </div>
            <span class="mutual-text">
              Followed by ${mutualFollowers[0]?.name || 'someone'}
              ${mutualFollowers.length > 1 ? `, ${mutualFollowers[1]?.name || 'someone'}` : ''}
              ${mutualFollowers.length > 2 ? ` + ${mutualFollowers.length - 2} more` : ''}
            </span>
          </div>
        ` : followsYou ? `
          <p class="pv-follows-you">Follows you</p>
        ` : ''}
      </div>
    </div>
  `;

  // Render Instagram-style tabs
  renderTabs();

  // Default tab
  loadPosts(uid);
}

// GET MUTUAL FOLLOWERS
// -------------------------------------------------------
async function getMutualFollowers(me, targetUid) {
  const cacheKey = `${me}_${targetUid}`;
  
  if (mutualFollowersCache[cacheKey]) {
    return mutualFollowersCache[cacheKey];
  }

  try {
    // Get my following list
    const myDoc = await getDoc(doc(db, "users", me));
    const myData = myDoc.data();
    const myFollowing = myData?.following || [];

    // Get target's followers
    const targetDoc = await getDoc(doc(db, "users", targetUid));
    const targetData = targetDoc.data();
    const targetFollowers = targetData?.followers || [];

    // Find mutual followers
    const mutualIds = myFollowing.filter(id => 
      targetFollowers.includes(id) && id !== me && id !== targetUid
    );

    // Get details of mutual followers
    const mutualPromises = mutualIds.slice(0, 5).map(async (mutualId) => {
      const mutualDoc = await getDoc(doc(db, "users", mutualId));
      if (mutualDoc.exists()) {
        const data = mutualDoc.data();
        return {
          uid: mutualId,
          name: data.name || data.username || 'User',
          avatar: data.avatar || 'img/default/default-avatar.png',
          username: data.username || 'user'
        };
      }
      return null;
    });

    const mutualFollowers = (await Promise.all(mutualPromises)).filter(Boolean);
    mutualFollowersCache[cacheKey] = mutualFollowers;
    
    return mutualFollowers;
  } catch (error) {
    console.error("Error getting mutual followers:", error);
    return [];
  }
}

// LOAD HIGHLIGHTS/STORIES
// -------------------------------------------------------
async function loadHighlights(uid) {
  try {
    const highlightsRef = collection(db, "users", uid, "highlights");
    const snap = await getDocs(highlightsRef);
    
    const highlightsContainer = document.getElementById("pvHighlights");
    if (!highlightsContainer) return;

    if (snap.empty) {
      highlightsContainer.innerHTML = '';
      return;
    }

    let html = `<div class="pv-highlights-container">`;
    
    snap.forEach(doc => {
      const highlight = doc.data();
      html += `
        <div class="highlight-item" onclick="openHighlight('${doc.id}')">
          <div class="highlight-circle">
            <img src="${highlight.cover || 'img/default/highlight.png'}" 
                 class="highlight-cover">
          </div>
          <p class="highlight-title">${highlight.title || 'Highlight'}</p>
        </div>
      `;
    });

    html += `</div>`;
    highlightsContainer.innerHTML = html;
  } catch (error) {
    console.error("Error loading highlights:", error);
  }
}

// RENDER INSTAGRAM STYLE TABS
// -------------------------------------------------------
function renderTabs() {
  document.getElementById("pvTabs").innerHTML = `
    <div class="tl-nav">
      <div class="tl-tab active" onclick="switchPVTab('posts')">
        <i class="tab-icon">📷</i> Posts
      </div>
      <div class="tl-tab" onclick="switchPVTab('reels')">
        <i class="tab-icon">🎬</i> Reels
      </div>
      <div class="tl-tab" onclick="switchPVTab('tagged')">
        <i class="tab-icon">🏷️</i> Tagged
      </div>
      <div id="tl-main-underline"></div>
    </div>
  `;
}

// SWITCH TABS (Instagram style)
window.switchPVTab = function (tab) {
  const uid = window.lastPVUID;
  if (!uid) return;

  // New tab order
  const order = ["posts", "reels", "tagged"];
  const index = order.indexOf(tab);

  // Move underline
  const underline = document.getElementById("tl-main-underline");
  if (underline) {
    underline.style.transform = `translateX(${index * 100}%)`;
  }

  // Activate correct tab
  document.querySelectorAll(".tl-tab").forEach(t => t.classList.remove("active"));
  document
    .querySelector(`[onclick="switchPVTab('${tab}')"]`)
    ?.classList.add("active");

  // Load sections
  if (tab === "posts") loadPosts(uid);
  else if (tab === "reels") loadUserReels(uid);
  else if (tab === "tagged") loadTaggedPosts(uid);
};

// LOAD POSTS GRID
// -------------------------------------------------------
async function loadPosts(uid) {
  window.lastPVUID = uid;

  document.getElementById("pvContent").innerHTML = `
    <div class="skeleton-grid">
      ${Array.from({ length: 9 }).map(() => `<div class="skeleton"></div>`).join("")}
    </div>
  `;

  try {
    const postsRef = collection(db, "users", uid, "posts");
    const snap = await getDocs(postsRef);

    if (snap.empty) {
      document.getElementById("pvContent").innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📷</div>
          <h3>No Posts Yet</h3>
          <p>When ${profileCache[uid]?.username || 'this user'} shares photos and videos, you'll see them here.</p>
        </div>
      `;
      return;
    }

    let html = `<div class="pv-post-grid">`;

    snap.forEach(doc => {
      const p = doc.data();
      const hasMultiple = p.multipleImages || false;
      
      html += `
        <div class="pv-post-item" onclick="openPostModal('${p.img}')">
          <img src="${p.img}" loading="lazy">
          ${hasMultiple ? `<div class="multi-post-indicator">📷</div>` : ''}
          ${p.likesCount > 0 ? `
            <div class="post-stats">
              <span>❤️ ${p.likesCount}</span>
              ${p.commentsCount > 0 ? `<span>💬 ${p.commentsCount}</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    });

    html += `</div>`;
    document.getElementById("pvContent").innerHTML = html;
  } catch (error) {
    console.error("Error loading posts:", error);
    document.getElementById("pvContent").innerHTML =
      `<p class="error-msg">Error loading posts</p>`;
  }
}

// LOAD REELS
async function loadUserReels(uid) {
  try {
    const reelsRef = collection(db, "users", uid, "reels");
    const snap = await getDocs(reelsRef);

    if (snap.empty) {
      document.getElementById("pvContent").innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎬</div>
          <h3>No Reels Yet</h3>
          <p>No reels have been shared yet.</p>
        </div>
      `;
      return;
    }

    let html = `<div class="pv-reels-grid">`;
    
    snap.forEach(doc => {
      const reel = doc.data();
      html += `
        <div class="reel-item" onclick="openReel('${doc.id}')">
          <video class="reel-preview" muted>
            <source src="${reel.videoUrl}" type="video/mp4">
          </video>
          <div class="reel-stats">
            <span>▶️ ${reel.views || 0}</span>
            <span>❤️ ${reel.likes || 0}</span>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    document.getElementById("pvContent").innerHTML = html;
  } catch (error) {
    console.error("Error loading reels:", error);
    document.getElementById("pvContent").innerHTML = 
      `<p class="error-msg">Error loading reels</p>`;
  }
}

// LOAD TAGGED POSTS
async function loadTaggedPosts(uid) {
  try {
    // Query posts where user is tagged
    const postsRef = collection(db, "posts");
    const q = query(postsRef, where("tagged", "array-contains", uid), limit(50));
    const snap = await getDocs(q);

    if (snap.empty) {
      document.getElementById("pvContent").innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏷️</div>
          <h3>No Photos of ${profileCache[uid]?.username || 'User'}</h3>
          <p>When people tag ${profileCache[uid]?.username || 'this user'} in photos, they'll appear here.</p>
        </div>
      `;
      return;
    }

    let html = `<div class="pv-post-grid">`;

    snap.forEach(doc => {
      const p = doc.data();
      html += `
        <div class="pv-post-item" onclick="openPostModal('${p.img}')">
          <img src="${p.img}" loading="lazy">
        </div>
      `;
    });

    html += `</div>`;
    document.getElementById("pvContent").innerHTML = html;
  } catch (error) {
    console.error("Error loading tagged posts:", error);
    document.getElementById("pvContent").innerHTML = 
      `<p class="error-msg">Error loading tagged posts</p>`;
  }
}

// FOLLOW SYSTEM
// -------------------------------------------------------
window.toggleFollow = async function (uid) {
  try {
    const me = auth.currentUser?.uid;
    if (!me) {
      alert("Please sign in to follow users");
      return;
    }

    const meRef = doc(db, "users", me);
    const targetRef = doc(db, "users", uid);

    const snap = await getDoc(meRef);
    const meData = snap.data();

    const isFollowing = meData.following?.includes(uid);
    const btn = document.getElementById("followBtnPV");

    if (isFollowing) {
      btn.textContent = "Follow";
      await updateDoc(meRef, { following: arrayRemove(uid) });
      await updateDoc(targetRef, { followers: arrayRemove(me) });
    } else {
      btn.textContent = "Following";
      await updateDoc(meRef, { following: arrayUnion(uid) });
      await updateDoc(targetRef, { followers: arrayUnion(me) });
    }

    // Refresh profile to update counts and mutual followers
    loadProfile(uid);
  } catch (error) {
    console.error("Error toggling follow:", error);
    alert("Error updating follow status");
  }
};

// PROFILE ACTIONS
// -------------------------------------------------------
window.showProfileActions = function(uid) {
  const modal = document.getElementById("profileActionsModal");
  if (modal) {
    modal.classList.remove("hidden");
  }
};

window.closeActionsModal = function() {
  const modal = document.getElementById("profileActionsModal");
  if (modal) {
    modal.classList.add("hidden");
  }
};

window.reportUser = async function(uid) {
  if (confirm("Report this account?")) {
    try {
      const reportRef = doc(collection(db, "reports"));
      await updateDoc(reportRef, {
        reporterId: auth.currentUser.uid,
        reportedId: uid,
        type: "account",
        reason: "Inappropriate content",
        timestamp: new Date()
      });
      alert("Thank you for your report. We'll review this account.");
      closeActionsModal();
    } catch (error) {
      console.error("Error reporting user:", error);
    }
  }
};

window.blockUser = async function(uid) {
  if (confirm("Block this user? You won't be able to see their posts or profile.")) {
    try {
      const me = auth.currentUser.uid;
      const meRef = doc(db, "users", me);
      
      await updateDoc(meRef, {
        blocked: arrayUnion(uid)
      });
      
      // Also unfollow if following
      await updateDoc(meRef, { following: arrayRemove(uid) });
      await updateDoc(doc(db, "users", uid), { followers: arrayRemove(me) });
      
      alert("User blocked successfully");
      closeActionsModal();
      backToSearch();
    } catch (error) {
      console.error("Error blocking user:", error);
    }
  }
};

window.restrictUser = function(uid) {
  alert("User restricted. Their comments will only be visible to them.");
  closeActionsModal();
};

// EDIT PROFILE
window.editProfile = function () {
  const page = document.querySelector(".profile-view");
  if (page) {
    page.classList.add("profile-exit");
  }

  setTimeout(() => {
    if (window.loadPage) {
      loadPage("editProfile");

      // When returning back
      setTimeout(() => {
        const newPage = document.querySelector(".profile-view");
        if (newPage) {
          newPage.classList.add("profile-enter");
        }
      }, 80);
    }
  }, 240);
};

// ADD TO STORY
window.addToStory = function() {
  // Open camera or gallery to add to story
  alert("Add to story feature");
};

// OPEN REEL
window.openReel = function(reelId) {
  if (window.loadPage) {
    loadPage("reel", reelId);
  }
};

// DM SYSTEM
window.openDM = async function (partnerId) {
  try {
    // Create or get chat ID
    const chatId = await getOrCreateChat(partnerId);
    
    // Load messages page
    if (window.loadPage) {
      loadPage("messages");
      
      // Wait for messages to load then open chat
      setTimeout(() => {
        if (window.openChat) {
          openChat(chatId, partnerId);
        }
      }, 300);
    } else {
      alert("Messages feature not available");
    }
  } catch (error) {
    console.error("Error opening DM:", error);
    alert("Could not open messages");
  }
};

async function getOrCreateChat(partnerId) {
  const me = auth.currentUser.uid;
  const chatId = [me, partnerId].sort().join('_');
  
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  
  if (!chatSnap.exists()) {
    await updateDoc(chatRef, {
      participants: [me, partnerId],
      createdAt: new Date(),
      lastMessage: "",
      unread: { [me]: 0, [partnerId]: 0 }
    });
  }
  
  return chatId;
}

// POST MODAL
window.openPostModal = function (img) {
  const modal = document.getElementById("postModal");
  const image = document.getElementById("modalImage");

  if (modal && image) {
    image.src = img;
    modal.classList.remove("hidden");
  }
};

window.closePostModal = function () {
  const modal = document.getElementById("postModal");
  if (modal) {
    modal.classList.add("hidden");
  }
};

// BACK TO SEARCH - Updated
window.backToSearch = function () {
  // Clear profile history
  if (window.profileHistory) {
    window.profileHistory = [];
  }
  
  // Load search page
  if (window.loadPage) {
    loadPage("search");
  } else {
    console.error("loadPage function not found");
  }
};

// GLOBAL TOUCH HANDLERS
if (!window.profileViewTouchHandlersAdded) {
  window.profileViewTouchHandlersAdded = true;
  
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
    }
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    const touchEndX = e.changedTouches[0].clientX;

    if (touchStartX < 40 && touchEndX - touchStartX > 80) {
      if (document.querySelector(".profile-view")) {
        backToSearch();
      }
    }
  }, { passive: true });
}

// ================================
// Elastic pull-down avatar stretch
// ================================
let startY = 0;
let pulling = false;

window.addEventListener("touchstart", (e) => {
  if (window.scrollY !== 0) return;
  startY = e.touches[0].clientY;
  pulling = true;
});

window.addEventListener("touchmove", (e) => {
  if (!pulling) return;

  const avatar = document.querySelector(".pv-avatar");
  if (!avatar) return;

  const diff = e.touches[0].clientY - startY;
  if (diff <= 0) return;

  const stretch = Math.min(diff / 180, 0.35);

  avatar.classList.add("elastic");
  avatar.style.transform = `scale(${1 + stretch})`;
});

window.addEventListener("touchend", () => {
  const avatar = document.querySelector(".pv-avatar");
  if (!avatar) return;

  avatar.classList.remove("elastic");
  avatar.classList.add("release");
  avatar.style.transform = "scale(1)";

  setTimeout(() => avatar.classList.remove("release"), 450);
  pulling = false;
});

// ================================
// Swipe between profile tabs
// ================================
let swipeStartX = 0;

const tabOrder = ["posts", "reels", "tagged"];

window.addEventListener("touchstart", (e) => {
  swipeStartX = e.touches[0].clientX;
});

window.addEventListener("touchend", (e) => {
  const endX = e.changedTouches[0].clientX;
  const diff = endX - swipeStartX;

  if (Math.abs(diff) < 60) return;

  const currentTab =
    document.querySelector(".tl-tab.active")
      ?.getAttribute("onclick")
      ?.match(/'(.*?)'/)?.[1];

  if (!currentTab) return;

  let index = tabOrder.indexOf(currentTab);
  if (diff < 0 && index < 2) index++;
  if (diff > 0 && index > 0) index--;

  window.switchPVTab(tabOrder[index]);
});

// ================================
// STORY VIEWER
// ================================
let storyIndex = 0;
let storyTimer = null;
let stories = [];
let isStoryPaused = false;
let progressPausedAt = 0;
let storyStartTime = 0;

window.openHighlight = function (highlightId) {
  // TEMP: mock stories (replace with Firestore fetch later)
  stories = [
    { type: "img", src: "https://picsum.photos/800/1200?1" },
    { type: "img", src: "https://picsum.photos/800/1200?2" },
    { type: "img", src: "https://picsum.photos/800/1200?3" }
  ];

  storyIndex = 0;
  renderStoryViewer();
};

function renderStoryViewer() {
  const viewer = document.createElement("div");
  viewer.className = "story-viewer";
  viewer.innerHTML = `
    <div class="story-progress">
      ${stories.map((_, i) => `<span class="${i === 0 ? "active" : ""}"></span>`).join("")}
    </div>
    <div class="story-close" onclick="closeStory()">×</div>
    <div class="story-content"></div>
    <div class="story-reply">
      <input id="storyReplyInput" placeholder="Send message">
      <button onclick="sendStoryReply()">Send</button>
    </div>
  `;
  document.body.appendChild(viewer);
  showStory();
}

function showStory() {
  const viewer = document.querySelector(".story-viewer");
  const content = viewer.querySelector(".story-content");
  const bars = viewer.querySelectorAll(".story-progress span");

  bars.forEach(b => {
    b.classList.remove("active");
    b.style.animationPlayState = "running";
  });

  const activeBar = bars[storyIndex];
  activeBar.classList.add("active");

  const story = stories[storyIndex];
  content.innerHTML =
    story.type === "img"
      ? `<img src="${story.src}">`
      : `<video src="${story.src}" autoplay muted></video>`;

  clearTimeout(storyTimer);
  storyStartTime = Date.now();

  storyTimer = setTimeout(nextStory, 5000);
}

document.addEventListener("touchstart", () => {
  const bar = document.querySelector(".story-progress span.active");
  if (!bar) return;

  isStoryPaused = true;
  bar.style.animationPlayState = "paused";

  clearTimeout(storyTimer);
});

document.addEventListener("touchend", () => {
  const bar = document.querySelector(".story-progress span.active");
  if (!bar || !isStoryPaused) return;

  isStoryPaused = false;
  bar.style.animationPlayState = "running";

  const elapsed = Date.now() - storyStartTime;
  const remaining = Math.max(0, 5000 - elapsed);

  storyTimer = setTimeout(nextStory, remaining);
});

function nextStory() {
  storyIndex++;
  if (storyIndex >= stories.length) {
    closeStory();
  } else {
    showStory();
  }
}

window.closeStory = function () {
  clearTimeout(storyTimer);
  document.querySelector(".story-viewer")?.remove();
};

/* Tap navigation */
document.addEventListener("click", (e) => {
  const viewer = document.querySelector(".story-viewer");
  if (!viewer) return;

  const x = e.clientX;
  const w = window.innerWidth;

  if (x < w * 0.3) {
    storyIndex = Math.max(0, storyIndex - 1);
    showStory();
  } else if (x > w * 0.7) {
    nextStory();
  }
});

window.sendStoryReply = async function () {
  const input = document.getElementById("storyReplyInput");
  if (!input.value.trim()) return;

  const partnerId = window.lastPVUID;
  const message = input.value;

  closeStory();

  if (window.openDM) {
    const chatId = await getOrCreateChat(partnerId);
    loadPage("messages");

    setTimeout(() => {
      openChat(chatId, partnerId);
      sendMessage(message);
    }, 300);
  }
};

// ================================
// Pinch to zoom post image
// ================================
let initialDistance = 0;
let currentScale = 1;

const getDistance = (t1, t2) =>
  Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

document.addEventListener("touchmove", (e) => {
  const img = document.getElementById("modalImage");
  if (!img || e.touches.length !== 2) return;

  if (!initialDistance) {
    initialDistance = getDistance(e.touches[0], e.touches[1]);
    return;
  }

  const newDistance = getDistance(e.touches[0], e.touches[1]);
  currentScale = Math.min(Math.max(newDistance / initialDistance, 1), 3);
  img.style.transform = `scale(${currentScale})`;
});

document.addEventListener("touchend", () => {
  const img = document.getElementById("modalImage");
  if (!img) return;

  img.style.transform = "scale(1)";
  initialDistance = 0;
});

// ================================
// Header collapse on scroll
// ================================

window.addEventListener("scroll", () => {
  const header = document.getElementById("pvHeader");
  const avatar = document.querySelector(".pv-avatar");

  if (header) {
    header.style.paddingBottom = window.scrollY > 20 ? "6px" : "12px";
    header.classList.toggle("collapsed", window.scrollY > 80);
  }

  if (avatar) {
    avatar.classList.toggle("shrink", window.scrollY > 30);
  }
});

// EXPORT FUNCTIONS FOR USE IN OTHER MODULES
export { getMutualFollowers, loadProfile };


