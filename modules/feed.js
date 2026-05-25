// =====================================================================
// modules/feed.js — Instagram-style public feed.
// Renders with .ig-* classes so styles/cute/ig.css applies.
// Real Firestore data (no mock); double-tap-to-like with heart pop;
// comment bottom-sheet; stories strip; following/explore tabs.
// =====================================================================
import { auth } from '../firebase.js';
import {
  createPost, deletePost, getPost,
  subscribeFeed, subscribeExplore, subscribeUserPosts,
  toggleLike, addComment, subscribeComments,
  follow, unfollow, isFollowing,
  searchUsers, subscribeUserDoc
} from '../services/feedService.js';
import { toast, toastError, toastSuccess, safe } from '../utils/toast.js';

let unsubFeed         = null;
let unsubComments     = null;
let unsubProfile      = null;
let unsubProfilePosts = null;

let containerEl = null;
let activeTab   = 'following';   // following | explore
let currentMode = 'list';        // list | post | user

const PRAVATAR_FALLBACK = (uid) =>
  (typeof window !== 'undefined' && typeof window.avatarFor === 'function')
    ? window.avatarFor({ uid })
    : `https://ui-avatars.com/api/?background=ff8fb1&color=fff&name=${encodeURIComponent((uid || 'U').slice(0, 2))}`;

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
// LIST VIEW (Instagram feed)
// =========================================================================
async function showList() {
  teardownFeed();
  currentMode = 'list';
  const me = auth.currentUser;
  if (!me) return;

  containerEl.innerHTML = `
    <div class="ig-feed">
      <header class="ig-top">
        <h1 class="ig-logo">Nuvvu Nenu</h1>
        <div class="ig-top-actions">
          <button id="igAddPost"   title="New post" aria-label="New post"><i class="fas fa-plus-square"></i></button>
          <button id="igOpenDms"   title="Messages" aria-label="Messages"><i class="far fa-paper-plane"></i></button>
        </div>
      </header>

      <div class="ig-stories" id="igStories">
        ${renderStoryAddSkeleton()}
      </div>

      <div class="ig-tabs">
        <button class="ig-tab ${activeTab==='following'?'active':''}" data-tab="following">Following</button>
        <button class="ig-tab ${activeTab==='explore'?'active':''}"   data-tab="explore">Explore</button>
      </div>

      <div class="ig-pull" id="igPull" aria-hidden="true">
        <div class="ig-pull__spinner">↻</div>
        <div class="ig-pull__label">Pull to refresh</div>
      </div>

      <div class="ig-posts" id="igPosts">
        <div class="ig-post-skeleton"></div>
        <div class="ig-post-skeleton"></div>
      </div>

      <div class="comment-sheet hidden" id="commentSheet" aria-hidden="true"></div>

      <input type="file" id="igFilePicker" accept="image/*" hidden>
    </div>

    <style>
      .ig-tabs{
        display:flex;gap:14px;padding:10px 16px;
        border-bottom:1px solid rgba(0,0,0,.06);
        background:rgba(255,255,255,.65);
        position:sticky;top:54px;z-index:18;
        backdrop-filter:blur(18px);
      }
      body.theme-dark .ig-tabs{background:rgba(10,10,15,.7);border-bottom-color:rgba(255,255,255,.08)}
      .ig-tab{
        background:transparent;border:0;padding:8px 14px;border-radius:999px;
        font-weight:600;color:#7c6f8e;cursor:pointer;font-family:inherit;font-size:.92rem;
        transition:all .2s;
      }
      .ig-tab:hover{color:#a78bfa}
      .ig-tab.active{
        background:linear-gradient(135deg,#ff8fb1,#a78bfa);color:#fff;
        box-shadow:0 4px 12px rgba(255,143,177,.3);
      }
      .ig-pull {
        position: relative;
        height: 0; overflow: visible;
        text-align: center;
        opacity: 0;
        transform: translateY(-100%);
      }
      .ig-pull__spinner {
        display: inline-grid; place-items: center;
        width: 32px; height: 32px; margin: 8px auto 4px;
        border-radius: 50%;
        background: linear-gradient(135deg,#ff8fb1,#a78bfa);
        color: #fff; font-size: 16px;
        box-shadow: 0 4px 12px rgba(255,143,177,.4);
      }
      .ig-pull__label {
        font-size: .6875rem; font-weight: 700;
        letter-spacing: .4px; text-transform: uppercase;
        color: rgba(0,0,0,.55);
      }
      .ig-pull.is-ready .ig-pull__spinner {
        background: linear-gradient(135deg,#7effc2,#5ed3a3);
      }
      .ig-pull.is-spinning .ig-pull__spinner {
        animation: ig-pull-spin .9s linear infinite;
      }
      @keyframes ig-pull-spin { to { transform: rotate(360deg); } }
    </style>
  `;

  // Wire tabs
  containerEl.querySelectorAll('.ig-tab').forEach((t) => {
    t.onclick = () => { activeTab = t.dataset.tab; switchTab(); };
  });

  // Wire top-bar actions
  document.getElementById('igAddPost').onclick = pickAndPost;
  document.getElementById('igOpenDms').onclick = () => window.loadPage?.('chat');

  attachPullToRefresh();

  await switchTab();
}

async function switchTab() {
  containerEl.querySelectorAll('.ig-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });
  unsubFeed?.(); unsubFeed = null;

  const me = auth.currentUser;
  const following = (typeof window !== 'undefined' && window.appState?.user?.following) || [];

  if (activeTab === 'following') {
    unsubFeed = subscribeFeed(me.uid, following, (posts) => renderPosts(posts, true));
  } else {
    unsubFeed = subscribeExplore((posts) => renderPosts(posts, false));
  }
}

function renderPosts(posts, isFollowingTab) {
  const list = document.getElementById('igPosts');
  if (!list) return;

  // Refresh stories from the same posts source (recent posters as stories)
  renderStoriesFromPosts(posts);

  if (!posts.length) {
    list.innerHTML = `
      <div class="ig-empty">
        <h3>${isFollowingTab ? "Your feed is empty" : "No posts yet"}</h3>
        <p>${isFollowingTab ? "Follow people on Explore to see their posts here ✨" : "Be the first to share a moment 💜"}</p>
        ${isFollowingTab
          ? `<button class="ig-cta" onclick="document.querySelector('.ig-tab[data-tab=&quot;explore&quot;]').click()">Open Explore</button>`
          : `<button class="ig-cta" id="igEmptyAdd">+ Share your first post</button>`}
      </div>`;
    document.getElementById('igEmptyAdd')?.addEventListener('click', pickAndPost);
    return;
  }
  list.innerHTML = posts.map(renderPostCard).join('');
  attachPostHandlers(posts);
}

// ---------- Stories strip ----------
function renderStoryAddSkeleton() {
  return `
    <div class="ig-story add" id="igStoryAdd">
      <div class="ig-story-ring add">
        <img src="${PRAVATAR_FALLBACK(auth.currentUser?.uid || 'me')}" alt="">
        <div class="ig-story-plus">+</div>
      </div>
      <p>Your story</p>
    </div>
    <div class="story-skeleton"></div>
    <div class="story-skeleton"></div>
    <div class="story-skeleton"></div>
  `;
}

function renderStoriesFromPosts(posts) {
  const stripEl = document.getElementById('igStories');
  if (!stripEl) return;

  const seenSet = getSeenStories();
  // Take up to 8 unique recent owners
  const seen = new Set();
  const stories = [];
  for (const p of posts) {
    if (!p.owner || seen.has(p.owner)) continue;
    seen.add(p.owner);
    const lastTs = p.createdAt?.toMillis?.() || p.createdAt?.seconds * 1000 || 0;
    stories.push({
      uid: p.owner,
      name: (p.ownerName || p.ownerUsername || 'someone').split(' ')[0],
      img: p.ownerPhoto || PRAVATAR_FALLBACK(p.owner),
      hasUnseen: !seenSet.has(`${p.owner}|${lastTs}`),
      lastTs,
    });
    if (stories.length >= 8) break;
  }

  stripEl.innerHTML = `
    <div class="ig-story" id="igStoryAdd">
      <div class="ig-story-ring add">
        <img src="${(window.appState?.user?.photoURL) || PRAVATAR_FALLBACK(auth.currentUser?.uid)}" alt="">
        <div class="ig-story-plus">+</div>
      </div>
      <p>Your story</p>
    </div>
    ${stories.map((s) => `
      <button class="ig-story" data-uid="${s.uid}" data-last-ts="${s.lastTs}">
        <div class="ig-story-ring ${s.hasUnseen ? 'active' : ''}">
          <img src="${s.img}" alt="" referrerpolicy="no-referrer">
        </div>
        <p>${escapeHtml(s.name)}</p>
      </button>
    `).join('')}
  `;

  // Tapping "Your story" routes to /moments to add a memory
  stripEl.querySelector('#igStoryAdd')?.addEventListener('click', () => {
    if (typeof window.loadPage === 'function') window.loadPage('moments');
  });
  stripEl.querySelectorAll('.ig-story[data-uid]').forEach((s) => {
    s.addEventListener('click', () => {
      const uid = s.dataset.uid;
      const lastTs = s.dataset.lastTs || "0";
      markStorySeen(`${uid}|${lastTs}`);
      const ring = s.querySelector('.ig-story-ring');
      if (ring) ring.classList.remove('active');
      showUser(uid);
    });
  });
}

// ---------- Post card ----------
function renderPostCard(p) {
  const me = auth.currentUser?.uid;
  const liked = (p.likes || []).includes(me);
  const time  = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
  const handle = p.ownerUsername ? `@${p.ownerUsername}` : (p.ownerName || 'Someone');
  const photo = p.ownerPhoto || PRAVATAR_FALLBACK(p.owner);
  const text = p.text || '';

  return `
    <article class="ig-post" data-post="${p.id}" data-owner="${p.owner}">
      <header class="ig-post-head">
        <button class="ig-post-user" data-action="user" data-uid="${p.owner}">
          <div class="ig-avatar-ring"><img src="${photo}" alt="" referrerpolicy="no-referrer"></div>
          <div class="ig-post-user-info">
            <div class="ig-post-uname">${escapeHtml(p.ownerUsername || p.ownerName || 'someone')}</div>
            <div class="ig-post-loc">${escapeHtml(p.ownerName && p.ownerUsername ? p.ownerName : '')}</div>
          </div>
        </button>
        ${p.owner === me ? `<button class="ig-more" data-action="delete" data-id="${p.id}" aria-label="More">⋯</button>` : ''}
      </header>

      ${p.imageUrl ? `
        <div class="ig-post-media" data-media="${p.id}">
          <img class="ig-post-img" src="${p.imageUrl}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <div class="ig-heart-pop" id="heartPop-${p.id}">❤</div>
        </div>` : `
        <div class="ig-post-text-only" style="padding:14px;font-size:.95rem;line-height:1.45;">${escapeHtml(text)}</div>
      `}

      <div class="ig-post-actions">
        <div class="ig-post-actions-left">
          <button class="ig-act ${liked ? 'liked' : ''}" data-action="like" data-id="${p.id}" aria-label="Like">
            <i class="${liked ? 'fas' : 'far'} fa-heart"></i>
          </button>
          <button class="ig-act" data-action="open" data-id="${p.id}" aria-label="Comments"><i class="far fa-comment"></i></button>
          <button class="ig-act" data-action="share" data-id="${p.id}" aria-label="Share"><i class="far fa-paper-plane"></i></button>
        </div>
        <button class="ig-act" data-action="save" data-id="${p.id}" aria-label="Save"><i class="far fa-bookmark"></i></button>
      </div>

      <div class="ig-post-likes">${(p.likeCount || 0).toLocaleString()} likes</div>

      ${text && p.imageUrl ? `<div class="ig-post-caption"><strong data-action="user" data-uid="${p.owner}">${escapeHtml(p.ownerUsername || p.ownerName || 'someone')}</strong>${escapeHtml(text)}</div>` : ''}

      ${p.commentCount ? `<button class="ig-post-view-comments" data-action="open" data-id="${p.id}">View all ${p.commentCount} comments</button>` : ''}
      <div class="ig-post-time">${time}</div>
    </article>
  `;
}

function attachPostHandlers(posts) {
  // Click handlers
  containerEl.querySelectorAll('[data-action]').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const a = el.dataset.action;
      const id = el.dataset.id;
      const uid = el.dataset.uid;
      if (a === 'like')   { await onLike(id, el); }
      else if (a === 'open') { showPost(id); }
      else if (a === 'user') { showUser(uid); }
      else if (a === 'delete') { confirmDeletePost(id); }
      else if (a === 'share') { sharePost(id); }
      else if (a === 'save')  { el.classList.toggle('saved'); toast(el.classList.contains('saved') ? 'Saved' : 'Removed'); }
    };
  });

  // Double-tap to like on the image
  containerEl.querySelectorAll('.ig-post-media').forEach((media) => {
    let lastTap = 0;
    const id = media.dataset.media;
    media.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 320) {
        triggerHeartPop(id);
        ensureLiked(id);
      }
      lastTap = now;
    });
  });
}

async function onLike(postId, btn) {
  const nowLiked = await safe(() => toggleLike(postId), "Couldn't like");
  if (nowLiked === null) return;
  btn.classList.toggle('liked', !!nowLiked);
  btn.firstElementChild.className = nowLiked ? 'fas fa-heart' : 'far fa-heart';
  // Bump the visible count
  const article = btn.closest('.ig-post');
  const likesEl = article?.querySelector('.ig-post-likes');
  if (likesEl) {
    const m = likesEl.textContent.match(/[\d,]+/);
    const cur = m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
    likesEl.textContent = `${(cur + (nowLiked ? 1 : -1)).toLocaleString()} likes`;
  }
  if (nowLiked) triggerHeartPop(postId);
}

async function ensureLiked(postId) {
  // Always toggle so a tap on already-liked doesn't unlike on dbl tap
  const article = containerEl.querySelector(`.ig-post[data-post="${postId}"]`);
  const btn = article?.querySelector('.ig-act[data-action="like"]');
  if (!btn) return;
  if (btn.classList.contains('liked')) return; // already liked
  await onLike(postId, btn);
}

function triggerHeartPop(postId) {
  const el = document.getElementById('heartPop-' + postId);
  if (!el) return;
  el.classList.remove('pop');
  // restart animation
  void el.offsetWidth;
  el.classList.add('pop');
}

function sharePost(postId) {
  const url = location.origin + location.pathname + '#post:' + postId;
  if (navigator.share) {
    navigator.share({ title: 'Nuvvu Nenu', url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
  }
}

// ---------- New post flow (top + button or empty CTA) ----------
async function pickAndPost() {
  const inp = document.getElementById('igFilePicker');
  if (!inp) return;
  inp.value = '';
  inp.onchange = async () => {
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toastError('Image too big (max 8MB)'); return; }

    // Quick caption modal
    openCaptionModal(async (caption) => {
      const ok = await safe(() => createPost({ text: caption, file }), "Couldn't post");
      if (ok) toastSuccess('Posted ✨');
    });
  };
  inp.click();
}

function openCaptionModal(onSubmit) {
  const wrap = document.createElement('div');
  wrap.className = 'bond-modal';
  wrap.innerHTML = `
    <div class="bond-modal__panel" role="dialog" aria-modal="true">
      <div class="bond-modal__head">Add a caption</div>
      <div class="bond-modal__body">
        <label class="bond-field"><span>Caption (optional)</span>
          <textarea id="capInput" rows="3" maxlength="500" placeholder="Say something about it…"></textarea></label>
      </div>
      <div class="bond-modal__actions">
        <button class="btn btn-ghost"   data-act="cancel">Skip</button>
        <button class="btn btn-primary" data-act="ok">Share</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => { try { wrap.remove(); } catch {} };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); onSubmit(''); });
  wrap.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    const v = wrap.querySelector('#capInput').value.trim();
    close();
    onSubmit(v);
  });
  setTimeout(() => wrap.querySelector('#capInput')?.focus(), 60);
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
    const out = await safe(() => deletePost(postId), "Couldn't delete");
    if (out !== null) { toast('Post deleted'); close(); }
    else ok.disabled = false;
  });
}

// =========================================================================
// COMMENT BOTTOM-SHEET (replaces the post-detail page for inline browsing)
// =========================================================================
function showPost(postId) {
  const sheet = document.getElementById('commentSheet');
  if (!sheet) return;
  unsubComments?.(); unsubComments = null;

  sheet.classList.remove('hidden');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.innerHTML = `
    <div class="comment-sheet-inner">
      <header class="comment-sheet-header">
        <div class="sheet-grip"></div>
        <h3>Comments</h3>
        <button class="sheet-close" id="commentClose" aria-label="Close">✕</button>
      </header>
      <div class="comments-list" id="commentsList"><div class="muted">Loading…</div></div>
      <form class="comment-input-row" id="commentForm">
        <input id="commentInput" placeholder="Add a comment…" autocomplete="off">
        <button type="submit">Post</button>
      </form>
    </div>
  `;

  const close = () => {
    sheet.classList.add('hidden');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = '';
    unsubComments?.(); unsubComments = null;
  };
  document.getElementById('commentClose').onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  const form = document.getElementById('commentForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const inp = document.getElementById('commentInput');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    await safe(() => addComment(postId, v), "Couldn't post comment");
  };

  unsubComments = subscribeComments(postId, (comments) => {
    const list = document.getElementById('commentsList');
    if (!list) return;
    if (!comments.length) { list.innerHTML = `<div class="muted">Be the first to comment</div>`; return; }
    list.innerHTML = comments.map((c) => {
      const ts = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : '';
      const av = c.authorPhoto || PRAVATAR_FALLBACK(c.author);
      return `
        <div class="ig-comment">
          <img class="ig-comment-avatar" src="${av}" alt="" referrerpolicy="no-referrer">
          <div class="ig-comment-body">
            <p><strong>${escapeHtml(c.authorUsername || c.authorName || 'someone')}</strong>${escapeHtml(c.text)}</p>
            <div class="ig-comment-meta">${ts}</div>
          </div>
        </div>
      `;
    }).join('');
  });
}

// =========================================================================
// USER PROFILE VIEW (kept for in-feed taps; routes to /profileView for full)
// =========================================================================
function showUser(targetUid) {
  if (!targetUid) return;
  window.__viewUserUid = targetUid;
  if (typeof window.loadPage === 'function') window.loadPage('profileView');
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
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s/60)}m ago`;
  if (s < 86400)     return `${Math.floor(s/3600)}h ago`;
  if (s < 86400*7)   return `${Math.floor(s/86400)}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// expose for cross-module (profile module's "View public" links here)
window.openFeedUser = showUser;
window.openFeedPost = showPost;



// =====================================================================
// Story seen tracking — keyed by "<owner-uid>|<post-timestamp-ms>" so
// a brand-new post by a previously-seen owner re-activates the ring.
// Persisted to localStorage. Capped at 200 entries (FIFO trim).
// =====================================================================
const SEEN_STORIES_KEY = "nvvunenu.seenStories";

function getSeenStories() {
  try {
    const raw = localStorage.getItem(SEEN_STORIES_KEY) || "[]";
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function markStorySeen(key) {
  if (!key) return;
  const set = getSeenStories();
  if (set.has(key)) return;
  const list = [...set, key];
  // Cap to last 200 to keep localStorage tidy.
  const trimmed = list.length > 200 ? list.slice(-200) : list;
  try { localStorage.setItem(SEEN_STORIES_KEY, JSON.stringify(trimmed)); } catch {}
}


// =====================================================================
// Pull-to-refresh — drag the feed down at the top to reload.
// =====================================================================
function attachPullToRefresh() {
  const feedRoot = containerEl?.querySelector('.ig-feed');
  const pull     = containerEl?.querySelector('#igPull');
  const posts    = containerEl?.querySelector('#igPosts');
  if (!feedRoot || !pull || !posts) return;

  // We track on the actual scroll surface — use the scrolling element.
  const scroller = document.scrollingElement || document.documentElement;
  let startY = 0;
  let pulling = false;
  let dy = 0;
  let refreshing = false;
  const THRESH = 70;

  const reset = (animate = true) => {
    pulling = false; dy = 0;
    pull.style.transition = animate ? "transform .2s ease, opacity .2s" : "none";
    pull.style.transform  = "translateY(-100%)";
    pull.style.opacity    = "0";
    pull.classList.remove("is-ready", "is-spinning");
  };
  reset(false);

  feedRoot.addEventListener("touchstart", (e) => {
    if (refreshing) return;
    if ((scroller.scrollTop || 0) > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
    pull.style.transition = "none";
  }, { passive: true });

  feedRoot.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0) { reset(); return; }
    // Damp the pull so it feels rubber-banded
    const drag = Math.min(120, dy * 0.45);
    pull.style.transform = `translateY(${drag - 20}px)`;
    pull.style.opacity   = String(Math.min(1, drag / 50));
    pull.classList.toggle("is-ready", drag >= THRESH);
    pull.querySelector('.ig-pull__label').textContent =
      drag >= THRESH ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });

  feedRoot.addEventListener("touchend", async () => {
    if (!pulling || refreshing) return;
    const drag = Math.min(120, dy * 0.45);
    if (drag < THRESH) { reset(); return; }
    refreshing = true;
    pulling = false;
    // Spinner state
    pull.style.transition = "transform .2s ease";
    pull.style.transform  = "translateY(0)";
    pull.style.opacity    = "1";
    pull.classList.add("is-spinning");
    pull.querySelector('.ig-pull__label').textContent = "Refreshing…";
    try {
      await switchTab();    // re-attach subscriptions, replays the latest data
    } catch {}
    setTimeout(() => { refreshing = false; reset(); }, 500);
  });
}
