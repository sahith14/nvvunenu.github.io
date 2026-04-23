// ===============================
//   NUVVU NENU – PROFILE MODULE
//   Instagram-inspired profile page
// ===============================

import { db, auth } from "../firebase.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const profileTabOrder = ["posts", "reels", "tagged", "saved"];

export function render() {
  const uid = auth.currentUser?.uid;

  setTimeout(() => {
    if (!uid) {
      const page = document.getElementById("profilePage");
      if (page) page.innerHTML = `<p style="text-align:center;">Please log in to view your profile.</p>`;
      return;
    }

    loadProfile(uid);
  }, 0);
  
  return `
    <div id="profilePage" class="profile-container"></div>

    <div id="profileComposer" class="composer-modal hidden">
      <div class="composer-card glass">
        <h3>Create new post</h3>
        <input id="postCaption" placeholder="Write a caption..." maxlength="220">
        <input id="postMediaFile" type="file" accept="image/*,video/*" onchange="previewNewPost(event)">
        <div id="postPreview" class="post-preview"></div>
        <div class="composer-actions">
          <button onclick="submitNewPost()">Post</button>
          <button class="close-settings" onclick="closeComposer()">Cancel</button>
        </div>
      </div>
    </div>

    <div id="profileSettingsSheet" class="settings-sheet hidden">
      <div class="igp-sheet-card">
        <h3>Settings & activity</h3>
        <button onclick="applyTheme('light')">Theme: Light</button>
        <button onclick="applyTheme('dark')">Theme: Dark</button>
        <button onclick="openAccountCenter()">Accounts Center</button>
        <button onclick="openArchive()">Archive</button>
        <button onclick="logoutUser()" class="logout-btn">Log out</button>
        <button class="close-settings" onclick="closeSettings()">Close</button>
      </div>
    </div>
  `;
}

export async function loadProfile(uid) {
  const page = document.getElementById("profilePage");
  if (!page) return;

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) {
    page.innerHTML = `<p style="text-align:center;">User not found</p>`;
    return;
  }

  const user = snap.data();
  const [posts, reels, taggedPosts, savedPosts] = await Promise.all([
    loadUserPosts(uid),
    loadUserReels(uid),
    loadTaggedPosts(uid),
    loadSavedPosts(uid, user.savedPosts || [])
  ]);

  const avatar = user.avatar || user.photoURL || `https://i.pravatar.cc/150?u=${uid}`;
  const followers = user.followers?.length || 0;
  const following = user.following?.length || 0;
  
  page.innerHTML = `
    <section class="igp-shell">
      <header class="igp-topbar">
        <h2>@${user.username || "user"}</h2>
        <div class="igp-topbar-actions">
          <button onclick="createNewPost()">＋</button>
          <button onclick="openSettings()">☰</button>
        </div>
      </header>

      <div class="igp-head">
        <img src="${avatar}" class="profile-avatar" alt="profile avatar">
        
         <div class="igp-head-stats">
          <div><b>${posts.length}</b><span>Posts</span></div>
          <div onclick="openFollowers('${uid}')"><b>${followers}</b><span>Followers</span></div>
          <div onclick="openFollowing('${uid}')"><b>${following}</b><span>Following</span></div>
        </div>
      </div>
      
      <div class="igp-bio-wrap">
        <h3>${user.name || user.username || "User"}</h3>
        ${user.profession ? `<p>${user.profession}</p>` : ""}
        ${user.bio ? `<p>${user.bio}</p>` : ""}
        ${user.website ? `<a href="${user.website}" target="_blank" rel="noopener noreferrer">${user.website.replace(/^https?:\/\//, "")}</a>` : ""}
      </div>
      
      <div class="igp-actions-row">
        <button onclick="editProfile()">Edit profile</button>
        <button onclick="shareProfile('${uid}')">Share profile</button>
        <button onclick="showProfessionalTools()">Professional dashboard</button>
      </div>

      <div class="igp-secondary-actions">
        <button onclick="openArchive()">Archive</button>
        <button onclick="openInsights()">Insights</button>
        <button onclick="openAdTools()">Ad tools</button>
        <button onclick="openCloseFriends()">Close friends</button>
      </div>

      <div class="igp-tabs">
        <button class="active" data-tab="posts" onclick="switchProfileTab('posts')">▦</button>
        <button data-tab="reels" onclick="switchProfileTab('reels')">▶</button>
        <button data-tab="tagged" onclick="switchProfileTab('tagged')">🏷</button>
        <button data-tab="saved" onclick="switchProfileTab('saved')">🔖</button>
      </div>

      <div id="igpTabContent">${renderGrid(posts, "No posts yet")}</div>
      
      <section class="igp-suggested">
        <h4>Discover people</h4>
        <p>Find creators and friends similar to your interests.</p>
        <button onclick="loadPage('search')">See all suggestions</button>
      </section>
    </section>
  `;

  window.__profileTabData = { posts, reels, tagged: taggedPosts, saved: savedPosts };
}

function renderGrid(items, emptyLabel = "Nothing here yet") {
  if (!items.length) {
    return `<div class="igp-empty">${emptyLabel}</div>`;
  }

  return `
    <div class="posts-grid igp-grid">
      ${items
        .map((item) => {
          const src = item.img || item.cover || item.thumbnail || item.videoThumbnail || item.media;
          const isVideo = item.type === "video" || (src && /\.(mp4|webm|mov)$/i.test(src));
          return isVideo
            ? `<video src="${src}" class="post-grid-img" muted playsinline controls></video>`
            : `<img src="${src}" class="post-grid-img" loading="lazy">`;
        })
        .join("")}
    </div>
  `;
}

async function loadUserPosts(uid) {
  const q = query(collection(db, "posts"), where("owner", "==", uid));
  const snap = await getDocs(q);
  const posts = [];
  snap.forEach((item) => posts.push(item.data()));
  
  const localPosts = JSON.parse(localStorage.getItem(`localPosts:${uid}`) || "[]");
  return [...localPosts, ...posts];
}

async function loadUserReels(uid) {
  const snap = await getDocs(collection(db, "users", uid, "reels"));
  const reels = [];
  snap.forEach((item) => reels.push(item.data()));
  return reels;
}

async function loadTaggedPosts(uid) {
  const q = query(collection(db, "posts"), where("tagged", "array-contains", uid));
  const snap = await getDocs(q);
  const tagged = [];
  snap.forEach((item) => tagged.push(item.data()));
  return tagged;
}

async function loadSavedPosts(uid, savedPostIds) {
  if (!savedPostIds.length) return [];

  const saved = [];
  for (const postId of savedPostIds.slice(0, 24)) {
    const snap = await getDoc(doc(db, "posts", postId));
    if (snap.exists()) saved.push(snap.data());
  }
  return saved;
};

window.switchProfileTab = function (tabName) {
  const content = document.getElementById("igpTabContent");
  const all = window.__profileTabData || {};

  document.querySelectorAll(".igp-tabs button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  if (!content) return;

  if (!profileTabOrder.includes(tabName)) {
    content.innerHTML = `<div class="igp-empty">Invalid tab</div>`;
    return;
  }

  const map = {
    posts: { items: all.posts || [], empty: "No posts yet" },
    reels: { items: all.reels || [], empty: "No reels yet" },
    tagged: { items: all.tagged || [], empty: "No tagged posts yet" },
    saved: { items: all.saved || [], empty: "No saved posts yet" }
  };

  content.innerHTML = renderGrid(map[tabName].items, map[tabName].empty);
};

window.openFollowers = async function (uid) {
  const snap = await getDoc(doc(db, "users", uid));
  const followers = snap.data()?.followers || [];
  alert(`Followers (${followers.length})\n\n${followers.join("\n") || "No followers yet"}`);
};

window.openFollowing = async function (uid) {
  const snap = await getDoc(doc(db, "users", uid));
  const following = snap.data()?.following || [];
  alert(`Following (${following.length})\n\n${following.join("\n") || "Not following anyone yet"}`);
};

window.openSettings = function () {
  document.getElementById("profileSettingsSheet")?.classList.remove("hidden");
};

window.closeSettings = function () {
  document.getElementById("profileSettingsSheet")?.classList.add("hidden");
};

window.editProfile = function () {
  alert("Edit profile screen can be connected here.");
};

window.shareProfile = function (uid) {
  const shareText = `${window.location.origin}${window.location.pathname}#profileView:${uid}`;
  navigator.clipboard?.writeText(shareText);
  alert("Profile link copied.");
};

window.showProfessionalTools = function () {
  alert("Professional dashboard: Insights, ad tools, and branded content controls.");
};

window.openArchive = function () {
  alert("Archive opened. Stories and posts you archived will appear here.");
};

window.openInsights = function () {
  alert("Insights opened. Track reach, engagement, and audience growth.");
};

window.openAdTools = function () {
  alert("Ad tools opened. Promote posts and manage campaigns.");
};

window.openCloseFriends = function () {
  alert("Close friends list opened.");
};

window.openAccountCenter = function () {
  alert("Accounts Center opened.");
};

window.createNewPost = function () {
  document.getElementById("profileComposer")?.classList.remove("hidden");
};

window.closeComposer = function () {
  document.getElementById("profileComposer")?.classList.add("hidden");
  const preview = document.getElementById("postPreview");
  const media = document.getElementById("postMediaFile");
  const caption = document.getElementById("postCaption");
  if (preview) preview.innerHTML = "";
  if (media) media.value = "";
  if (caption) caption.value = "";
};

window.previewNewPost = function (event) {
  const file = event.target.files?.[0];
  const box = document.getElementById("postPreview");
  if (!file || !box) return;

  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  box.innerHTML = isVideo
    ? `<video src="${url}" controls muted playsinline></video>`
    : `<img src="${url}" alt="preview">`;
};

window.submitNewPost = function () {
  const uid = auth.currentUser?.uid;
  const file = document.getElementById("postMediaFile")?.files?.[0];
  const caption = document.getElementById("postCaption")?.value?.trim() || "";

  if (!uid || !file) {
    alert("Please choose an image or video first.");
    return;
  }

  const media = URL.createObjectURL(file);
  const localPost = {
    id: `local-${Date.now()}`,
    owner: uid,
    media,
    img: file.type.startsWith("image/") ? media : undefined,
    type: file.type.startsWith("video/") ? "video" : "image",
    caption,
    createdAt: Date.now()
  };

  const key = `localPosts:${uid}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  existing.unshift(localPost);
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 30)));

  closeComposer();
  loadProfile(uid);
};

window.applyTheme = function (name) {
  const body = document.body;
  body.classList.remove("theme-light", "theme-dark", "theme-love", "theme-rose", "theme-animated");
  body.classList.add("theme-" + name);
};

window.logoutUser = function () {
  signOut(auth).then(() => {
    window.location.href = "login.html";
  });
};

export function renderExternalProfile(u, uid) {
  return `
    <div class="profile-container">
      <div class="profile-header glass">
        <img src="${u.avatar || "https://i.pravatar.cc/150?u=" + uid}" class="profile-avatar">
        <h2>${u.username}</h2>
        <p class="profile-name">${u.name || ""}</p>

        <div class="stats-row">
          <div>${u.followers?.length || 0}<br>Followers</div>
          <div>${u.following?.length || 0}<br>Following</div>
        </div>

        <button class="edit-btn" onclick="toggleFollow(event, '${uid}')">Follow</button>
        <button class="edit-btn" onclick="openChatFromProfile('${uid}')">Message</button>
      </div>

      <div class="posts-grid">
        <p style="text-align:center;opacity:0.6;margin-top:20px;">Posts loading...</p>
      </div>
    </div>
  `;
}

window.openChatFromProfile = async function (targetUID) {
  const myUID = auth.currentUser.uid;
  const chatId = [myUID, targetUID].sort().join("_");

  const chatRef = doc(db, "chats", chatId);
  const snap = await getDoc(chatRef);

  if (!snap.exists()) {
    await setDoc(chatRef, {
      members: [myUID, targetUID],
      usernames: {},
      lastMessage: "",
      lastMessageTime: serverTimestamp(),
      lastMessageSender: ""
    });
  }

  loadPage("messages");

  setTimeout(() => {
    window.openChat(chatId, targetUID);
  }, 300);
};


