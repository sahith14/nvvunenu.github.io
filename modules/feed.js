// =====================================================================
// modules/feed.js — Public feed UI.
// Internal views (no router pages, just swap content):
//   1. list   — Following | Explore tabs, composer, post cards, search
//   2. post   — single post detail with comments thread
//   3. user   — public profile of any user (their posts grid + follow)
// =====================================================================
import { db, auth } from '../firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
  createPost, deletePost, getPost,
  subscribeFeed, subscribeExplore, subscribeUserPosts,
  toggleLike, addComment, subscribeComments,
  follow, unfollow, isFollowing,
  searchUsers, subscribeUserDoc
} from '../services/feedService.js';

let unsubFeed     = null;
let unsubComments = null;
let unsubProfile  = null;
let unsubProfilePosts = null;

let containerEl = null;
let activeTab   = 'following';   // following | explore
let searchTimer = null;

// =========================================================================
// PUBLIC ENTRY
// =========================================================================
export function renderFeed(container) {
  containerEl = container;
  showList();
}

export function teardownFeed() {
  unsubFeed?.();         unsubFeed = null;
  unsubComments?.();     unsubComments = null;
  unsubProfile?.();      unsubProfile = null;
  unsubProfilePosts?.(); unsubProfilePosts = null;
}

// =========================================================================
// LIST VIEW (feed)
// =========================================================================
async function showList() {
  teardownFeed();
  const me = auth.currentUser;
  if (!me) return;

  containerEl.innerHTML = `
    <div class="feed-page">
      <header class="feed-header">
        <div class="feed-title">Feed</div>
        <div class="feed-search-wrap">
          <input class="feed-search" id="feedSearch" placeholder="Search @username" autocomplete="off">
          <div class="feed-search-results hidden" id="feedSearchResults"></div>
        </div>
      </header>

      <div class="feed-composer">
        <div class="feed-composer-head">
          <div class="feed-avatar" id="composerAvatar">💜</div>
          <textarea id="composerText" class="feed-composer-input" placeholder="Share a moment…" rows="2"></textarea>
        </div>
        <div class="feed-composer-actions">
          <label class="feed-composer-photo">
            <input type="file" id="composerImage" accept="image/*" hidden>
            <span>📷 Photo</span>
          </label>
          <span class="feed-composer-preview" id="composerPreview"></span>
          <button class="btn btn-primary feed-composer-post" id="btnPost">Post</button>
        </div>
      </div>

      <div class="feed-tabs">
        <button class="feed-tab ${activeTab==='following'?'active':''}" data-tab="following">Following</button>
        <button class="feed-tab ${activeTab==='explore'?'active':''}"   data-tab="explore">Explore</button>
      </div>

      <div class="feed-list" id="feedList">
        <div class="feed-blank">Loading…</div>
      </div>
    </div>
  `;

  // hydrate composer avatar (from appState — no extra Firestore read)
  const meData = (typeof window !== 'undefined' && window.appState?.user) || {};
  const avatarEl = document.getElementById('composerAvatar');
  if (avatarEl && meData.photoURL) avatarEl.innerHTML = `<img src="${meData.photoURL}" alt="">`;

  // wire tabs
  containerEl.querySelectorAll('.feed-tab').forEach((t) => {
    t.onclick = () => { activeTab = t.dataset.tab; switchTab(); };
  });

  // wire composer
  document.getElementById('btnPost').onclick = handlePost;

  document.getElementById('composerImage').onchange = (e) => {
    const f = e.target.files?.[0];
    document.getElementById('composerPreview').textContent = f ? `📎 ${f.name}` : '';
  };

  // wire search
  const searchEl = document.getElementById('feedSearch');
  searchEl.addEventListener('input', onSearchInput);
  searchEl.addEventListener('focus', onSearchInput);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.feed-search-wrap')) {
      document.getElementById('feedSearchResults')?.classList.add('hidden');
    }
  });

  await switchTab();
}

async function switchTab() {
  // toggle visual tab state
  containerEl.querySelectorAll('.feed-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });
  unsubFeed?.(); unsubFeed = null;

  const me = auth.currentUser;
  // Read 'following' from appState (already live-synced) instead of refetching.
  const following = (typeof window !== 'undefined' && window.appState?.user?.following) || [];

  if (activeTab === 'following') {
    unsubFeed = subscribeFeed(me.uid, following, (posts) => renderPosts(posts, true));
  } else {
    unsubFeed = subscribeExplore((posts) => renderPosts(posts, false));
  }
}

function renderPosts(posts, isFollowingTab) {
  const list = document.getElementById('feedList');
  if (!list) return;
  if (!posts.length) {
    list.innerHTML = isFollowingTab
      ? `<div class="feed-blank">Follow people on Explore to see their posts here ✨</div>`
      : `<div class="feed-blank">No posts yet — be the first 💜</div>`;
    return;
  }
  list.innerHTML = posts.map(renderPostCard).join('');
  attachPostCardHandlers();
}

// =========================================================================
// POST CARD
// =========================================================================
function renderPostCard(p) {
  const me = auth.currentUser?.uid;
  const liked = (p.likes || []).includes(me);
  const time = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
  const avatar = p.ownerPhoto
    ? `<img src="${p.ownerPhoto}" alt="">`
    : '💜';
  const handle = p.ownerUsername ? `@${p.ownerUsername}` : '';

  return `
    <article class="post-card" data-post="${p.id}" data-owner="${p.owner}">
      <header class="post-head">
        <button class="post-avatar" data-action="user" data-uid="${p.owner}">${avatar}</button>
        <div class="post-meta">
          <button class="post-name" data-action="user" data-uid="${p.owner}">${escapeHtml(p.ownerName || 'Someone')}</button>
          <div class="post-sub">${escapeHtml(handle)}${handle && time ? ' · ' : ''}${time}</div>
        </div>
        ${p.owner === me ? `<button class="post-more" data-action="delete" data-id="${p.id}" title="Delete">⋯</button>` : ''}
      </header>

      ${p.imageUrl ? `<button class="post-image" data-action="open" data-id="${p.id}"><img src="${p.imageUrl}" alt="" loading="lazy"></button>` : ''}

      ${p.text ? `<div class="post-text" data-action="open" data-id="${p.id}">${escapeHtml(p.text)}</div>` : ''}

      <footer class="post-actions">
        <button class="post-action ${liked ? 'liked' : ''}" data-action="like" data-id="${p.id}">
          ${liked ? '❤️' : '🤍'} <span>${p.likeCount || 0}</span>
        </button>
        <button class="post-action" data-action="open" data-id="${p.id}">
          💬 <span>${p.commentCount || 0}</span>
        </button>
      </footer>
    </article>
  `;
}

function attachPostCardHandlers() {
  containerEl.querySelectorAll('[data-action]').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const a = el.dataset.action;
      const id = el.dataset.id;
      const uid = el.dataset.uid;
      if (a === 'like')   { await toggleLike(id); }
      if (a === 'open')   { showPost(id); }
      if (a === 'user')   { showUser(uid); }
      if (a === 'delete') {
        confirmDeletePost(id);
      }
    };
  });
}

function confirmDeletePost(postId) {
  const wrap = document.createElement('div');
  wrap.className = 'bond-modal';
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true" aria-label="Delete post">
      <div class="bond-modal__head">Delete this post?</div>
      <div class="bond-modal__body">
        <p class="bond-modal__p">This can't be undone. Comments and likes will be removed too.</p>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Keep it</button>
        <button class="btn btn-primary" data-act="ok">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', close);
  wrap.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    const ok = wrap.querySelector('[data-act="ok"]');
    ok.disabled = true;
    try { await deletePost(postId); window.showToast?.('Post deleted'); close(); }
    catch (e) { ok.disabled = false; window.showToast?.("Couldn't delete"); }
  });
}

// =========================================================================
// COMPOSER
// =========================================================================
async function handlePost() {
  const text = document.getElementById('composerText')?.value || '';
  const file = document.getElementById('composerImage')?.files?.[0] || null;
  const btn = document.getElementById('btnPost');
  if (!text.trim() && !file) { window.showToast?.('Write something or add a photo'); return; }
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    await createPost({ text, file });
    document.getElementById('composerText').value = '';
    document.getElementById('composerImage').value = '';
    document.getElementById('composerPreview').textContent = '';
    window.showToast?.('Posted ✨');
  } catch (e) {
    if (e?.message === 'FILE_TOO_LARGE') window.showToast?.('Image too large (max 5MB)');
    else window.showToast?.('Could not post');
    console.warn(e);
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
}

// =========================================================================
// SEARCH
// =========================================================================
function onSearchInput() {
  const v = document.getElementById('feedSearch').value;
  const box = document.getElementById('feedSearchResults');
  clearTimeout(searchTimer);
  if (!v.trim()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const cleaned = v.trim().replace(/^@/, '');
    const results = await searchUsers(cleaned);
    if (!results.length) {
      box.innerHTML = `<div class="feed-search-empty">No users</div>`;
    } else {
      box.innerHTML = results.map((u) => `
        <button class="feed-search-row" data-uid="${u.uid}">
          <span class="feed-search-avatar">${u.photoURL ? `<img src="${u.photoURL}">` : '💜'}</span>
          <span class="feed-search-info">
            <span class="feed-search-name">${escapeHtml(u.displayName || u.username)}</span>
            <span class="feed-search-handle">@${escapeHtml(u.username || '')}</span>
          </span>
        </button>
      `).join('');
      box.querySelectorAll('.feed-search-row').forEach((r) => {
        r.onclick = () => { showUser(r.dataset.uid); box.classList.add('hidden'); };
      });
    }
    box.classList.remove('hidden');
  }, 250);
}

// =========================================================================
// POST DETAIL VIEW
// =========================================================================
async function showPost(postId) {
  teardownFeed();
  const post = await getPost(postId);
  if (!post) { window.showToast?.('Post not found'); showList(); return; }

  const me = auth.currentUser?.uid;
  const liked = (post.likes || []).includes(me);
  const avatar = post.ownerPhoto ? `<img src="${post.ownerPhoto}">` : '💜';
  const time = post.createdAt?.toDate ? timeAgo(post.createdAt.toDate()) : '';
  const handle = post.ownerUsername ? `@${post.ownerUsername}` : '';

  containerEl.innerHTML = `
    <div class="feed-page">
      <header class="feed-subhead">
        <button class="feed-back" id="postBack">‹</button>
        <span>Post</span>
      </header>

      <article class="post-card detail" data-post="${post.id}">
        <header class="post-head">
          <button class="post-avatar" id="postOwnerAvatar">${avatar}</button>
          <div class="post-meta">
            <button class="post-name" id="postOwnerName">${escapeHtml(post.ownerName || 'Someone')}</button>
            <div class="post-sub">${escapeHtml(handle)}${handle && time ? ' · ' : ''}${time}</div>
          </div>
        </header>
        ${post.imageUrl ? `<div class="post-image"><img src="${post.imageUrl}" alt=""></div>` : ''}
        ${post.text ? `<div class="post-text">${escapeHtml(post.text)}</div>` : ''}
        <footer class="post-actions">
          <button class="post-action ${liked ? 'liked' : ''}" id="postLike">
            ${liked ? '❤️' : '🤍'} <span id="postLikeCount">${post.likeCount || 0}</span>
          </button>
          <span class="post-action"><span>💬 <span id="postCommentCount">${post.commentCount || 0}</span></span></span>
        </footer>
      </article>

      <div class="post-comments" id="postComments"></div>

      <div class="post-comment-composer">
        <input id="commentInput" class="composer-input" placeholder="Write a comment…">
        <button class="composer-send" id="commentSend">➤</button>
      </div>
    </div>
  `;

  document.getElementById('postBack').onclick = () => showList();
  document.getElementById('postOwnerAvatar').onclick = () => showUser(post.owner);
  document.getElementById('postOwnerName').onclick   = () => showUser(post.owner);

  // like button
  const likeBtn = document.getElementById('postLike');
  likeBtn.onclick = async () => {
    const nowLiked = await toggleLike(post.id);
    likeBtn.classList.toggle('liked', nowLiked);
    likeBtn.firstChild.textContent = nowLiked ? '❤️ ' : '🤍 ';
    const cur = parseInt(document.getElementById('postLikeCount').textContent || '0');
    document.getElementById('postLikeCount').textContent = cur + (nowLiked ? 1 : -1);
  };

  // comment composer
  const commentInput = document.getElementById('commentInput');
  document.getElementById('commentSend').onclick = async () => {
    const t = commentInput.value.trim();
    if (!t) return;
    commentInput.value = '';
    await addComment(post.id, t);
  };
  commentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('commentSend').click(); });

  unsubComments = subscribeComments(post.id, (comments) => {
    const list = document.getElementById('postComments');
    if (!list) return;
    if (!comments.length) { list.innerHTML = `<div class="feed-blank small">Be the first to comment</div>`; return; }
    list.innerHTML = comments.map((c) => {
      const ts = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : '';
      const av = c.authorPhoto ? `<img src="${c.authorPhoto}">` : '💜';
      const handle = c.authorUsername ? `@${c.authorUsername}` : '';
      return `
        <div class="comment-row">
          <button class="comment-avatar" data-uid="${c.author}">${av}</button>
          <div class="comment-body">
            <div class="comment-head">
              <span class="comment-name">${escapeHtml(c.authorName || 'Someone')}</span>
              <span class="comment-handle">${escapeHtml(handle)}</span>
              <span class="comment-time">${ts}</span>
            </div>
            <div class="comment-text">${escapeHtml(c.text)}</div>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.comment-avatar').forEach((b) => {
      b.onclick = () => showUser(b.dataset.uid);
    });
    document.getElementById('postCommentCount').textContent = comments.length;
  });
}

// =========================================================================
// USER PROFILE VIEW (public)
// =========================================================================
async function showUser(targetUid) {
  if (!targetUid) return;
  teardownFeed();

  containerEl.innerHTML = `
    <div class="feed-page">
      <header class="feed-subhead">
        <button class="feed-back" id="userBack">‹</button>
        <span>Profile</span>
      </header>
      <div class="user-profile" id="userProfile">
        <div class="feed-blank">Loading…</div>
      </div>
      <div class="user-posts" id="userPostsGrid"></div>
    </div>
  `;
  document.getElementById('userBack').onclick = () => showList();

  unsubProfile = subscribeUserDoc(targetUid, async (u) => {
    const card = document.getElementById('userProfile');
    if (!card) return;
    if (!u) { card.innerHTML = `<div class="feed-blank">User not found</div>`; return; }
    const me = auth.currentUser?.uid;
    const isMe = me === targetUid;
    const followers = u.followerCount ?? (u.followers?.length || 0);
    const following = u.followingCount ?? (u.following?.length || 0);
    const amFollowing = (u.followers || []).includes(me);

    card.innerHTML = `
      <div class="user-card">
        <div class="user-avatar">${u.photoURL ? `<img src="${u.photoURL}">` : '💜'}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(u.displayName || u.username || 'User')}</div>
          <div class="user-handle">@${escapeHtml(u.username || '')}</div>
          ${u.bio ? `<div class="user-bio">${escapeHtml(u.bio)}</div>` : ''}
          <div class="user-stats">
            <span><b id="followerCount">${followers}</b> followers</span>
            <span><b>${following}</b> following</span>
          </div>
        </div>
      </div>
      ${isMe ? '' : `
        <button class="btn ${amFollowing ? 'btn-ghost' : 'btn-primary'} user-follow-btn" id="followBtn">
          ${amFollowing ? 'Following' : 'Follow'}
        </button>`}
    `;

    if (!isMe) {
      document.getElementById('followBtn').onclick = async () => {
        const btn = document.getElementById('followBtn');
        btn.disabled = true;
        try {
          if (amFollowing) await unfollow(targetUid);
          else             await follow(targetUid);
        } catch (e) { console.warn(e); window.showToast?.('Action failed'); }
        finally { btn.disabled = false; }
      };
    }
  });

  unsubProfilePosts = subscribeUserPosts(targetUid, (posts) => {
    const grid = document.getElementById('userPostsGrid');
    if (!grid) return;
    if (!posts.length) { grid.innerHTML = `<div class="feed-blank small">No posts yet</div>`; return; }
    grid.innerHTML = `
      <div class="user-post-grid">
        ${posts.map((p) => `
          <button class="user-post-cell" data-id="${p.id}">
            ${p.imageUrl
              ? `<img src="${p.imageUrl}" alt="">`
              : `<span class="user-post-text">${escapeHtml((p.text || '').slice(0, 80))}</span>`}
          </button>`).join('')}
      </div>
    `;
    grid.querySelectorAll('.user-post-cell').forEach((c) => {
      c.onclick = () => showPost(c.dataset.id);
    });
  });
}

// =========================================================================
// HELPERS
// =========================================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)        return `${s}s`;
  if (s < 3600)      return `${Math.floor(s/60)}m`;
  if (s < 86400)     return `${Math.floor(s/3600)}h`;
  if (s < 86400*7)   return `${Math.floor(s/86400)}d`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// expose for cross-module use (e.g. profile page jumping into feed)
window.openFeedUser = showUser;
window.openFeedPost = showPost;
