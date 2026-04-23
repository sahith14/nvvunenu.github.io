// feed.js — Instagram style feed module

export function render() {
  setTimeout(() => enableDoubleTap(), 50);

  return `
    <div class="feed-container">

      <div class="stories-strip">
        ${renderStories()}
      </div>

      <div class="posts-area">
        ${renderPosts()}
      </div>

    </div>

    <!-- COMMENT MODAL -->
    <div id="commentModal" class="comment-modal hidden">
      <div class="comment-box glass">
        <h3>Comments</h3>

        <div class="comments-list" id="commentsList"></div>

        <input id="commentInput" placeholder="Add a comment..." />
        <button onclick="postComment()">Post</button>

        <button class="close-btn" onclick="closeComments()">Close</button>
      </div>
    </div>
  `;
}

// ----------------------------------------------
// STORIES
// ----------------------------------------------
function renderStories() {
  let storyUsers = [
    { name: "You", img: "https://i.pravatar.cc/100?u=you" },
    { name: "Aarav", img: "https://i.pravatar.cc/100?u=a1" },
    { name: "Navya", img: "https://i.pravatar.cc/100?u=a2" },
    { name: "Riya", img: "https://i.pravatar.cc/100?u=a3" },
  ];

  return storyUsers
    .map(
      (s) => `
    <div class="story">
      <img src="${s.img}">
      <p>${s.name}</p>
    </div>
  `
    )
    .join("");
}

// ----------------------------------------------
// POSTS
// ----------------------------------------------
function renderPosts() {
  let posts = [
    {
      id: 0,
      user: "Aarav",
      avatar: "https://i.pravatar.cc/100?u=p1",
      img: "https://picsum.photos/450/600?random=1",
    },
    {
      id: 1,
      user: "Navya",
      avatar: "https://i.pravatar.cc/100?u=p2",
      img: "https://picsum.photos/450/600?random=2",
    }
  ];

  return posts
    .map(
      (p) => `
      <div class="post-card glass">

        <div class="post-header">
          <img class="post-avatar" src="${p.avatar}">
          <span>${p.user}</span>
        </div>

        <!-- DOUBLE TAP AREA -->
        <div class="post-img-box">
          <img class="post-img" data-post="${p.id}" src="${p.img}">
          <img class="like-heart" id="heart${p.id}" src="https://cdn-icons-png.flaticon.com/512/833/833472.png">
        </div>

        <div class="post-actions">
          <span class="like-btn" data-post="${p.id}">❤️</span>
          <span onclick="openComments(${p.id})">💬</span>
          <span onclick="sharePost(${p.id})">📤</span>
        </div>

      </div>
    `
    )
    .join("");
}

// ----------------------------------------------
// DOUBLE TAP LIKE — FIXED
// ----------------------------------------------
function enableDoubleTap() {
  document.querySelectorAll(".post-img").forEach((img) => {
    let lastTap = 0;

    img.addEventListener("click", () => {
      const now = Date.now();

      if (now - lastTap < 300) {
        const id = img.dataset.post;
        likePost(id);

        const heart = document.getElementById("heart" + id);
        heart.classList.add("show-heart");
        setTimeout(() => heart.classList.remove("show-heart"), 700);
      }

      lastTap = now;
    });
  });

  // SINGLE TAP LIKE BUTTON
  document.querySelectorAll(".like-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      likePost(btn.dataset.post);
    });
  });
}

// ----------------------------------------------
// LIKE
// ----------------------------------------------
window.likePost = (id) => {
  const heart = document.getElementById(`heart${id}`);
  heart.classList.add("show-heart");
  setTimeout(() => heart.classList.remove("show-heart"), 800);
};

// ----------------------------------------------
// COMMENTS
// ----------------------------------------------
let currentPost = 0;
let comments = { 0: [], 1: [] };

window.openComments = (id) => {
  currentPost = id;
  document.getElementById("commentModal").classList.remove("hidden");
  renderComments();
};

window.closeComments = () =>
  document.getElementById("commentModal").classList.add("hidden");

function renderComments() {
  let box = document.getElementById("commentsList");
  box.innerHTML = comments[currentPost]
    .map((c) => `<p class="comment-item">${c}</p>`)
    .join("");
}

window.postComment = () => {
  let input = document.getElementById("commentInput");
  if (!input.value.trim()) return;

  comments[currentPost].push(input.value.trim());
  input.value = "";
  renderComments();
};

// ----------------------------------------------
// SHARE
// ----------------------------------------------
window.sharePost = (id) => {
  alert("Share feature will be added later 🎉");
};


