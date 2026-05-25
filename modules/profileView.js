// =====================================================================
// modules/profileView.js — public, read-only profile of any user.
// Target uid is read from window.__viewUserUid (set by search.js or
// any caller before navigating to /profileView).
// =====================================================================
import { onAppState, getState } from "../state/appState.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, toastError, safe } from "../utils/toast.js";
import {
  follow, unfollow, isFollowing,
  subscribeUserDoc, subscribeUserPosts
} from "../services/feedService.js";

let _container = null;
let _offState  = null;
let _unsubUser = null;
let _unsubPosts = null;
let _targetUid = null;
let _isFollowingCached = false;

export async function renderProfileView(container) {
  _container = container;
  _targetUid = (typeof window !== "undefined" && window.__viewUserUid) || null;

  if (!_targetUid) {
    container.innerHTML = `
      <div class="pv-empty">
        <div class="pv-empty__icon">👤</div>
        <h3>No profile selected</h3>
        <p>Use Search to find someone, then tap <strong>View</strong>.</p>
        <button class="btn btn-primary" id="pvCtaSearch">Open search</button>
      </div>`;
    container.querySelector("#pvCtaSearch")?.addEventListener("click", () => window.loadPage?.("search"));
    return cleanup;
  }

  container.innerHTML = `
    <div class="pv-page">
      <header class="pv-header" id="pvHeader">
        ${skeletonList(1, "card")}
      </header>
      <h3 class="pv-section-h">Posts</h3>
      <div class="pv-grid" id="pvGrid">${skeletonList(6, "list")}</div>
    </div>
  `;

  // Re-render on appState ready (we need my uid for follow state + self-detection)
  _offState = onAppState((s) => { if (s.ready) attach(); });

  return cleanup;
}

function cleanup() {
  try { _offState?.(); }     catch {}
  try { _unsubUser?.(); }    catch {}
  try { _unsubPosts?.(); }   catch {}
  _offState = _unsubUser = _unsubPosts = null;
  _targetUid = null; _container = null; _isFollowingCached = false;
}

function attach() {
  if (!_targetUid || !_container) return;
  // Live user doc
  try { _unsubUser?.(); } catch {}
  _unsubUser = subscribeUserDoc(_targetUid, (u) => {
    if (!u) {
      _container.querySelector("#pvHeader").innerHTML = `
        <div class="pv-empty">
          <h3>User not found</h3>
          <p>This account may have been deleted.</p>
        </div>`;
      return;
    }
    paintHeader(u);
  });

  // Live posts
  try { _unsubPosts?.(); } catch {}
  _unsubPosts = subscribeUserPosts(_targetUid, (rows) => paintPosts(rows));
}

function paintHeader(u) {
  const me = getState().user || {};
  const isMe = u.uid === me.uid;
  const followers = u.followerCount  ?? (u.followers || []).length ?? 0;
  const following = u.followingCount ?? (u.following || []).length ?? 0;
  const postCount = u.postCount      ?? null;

  const handle = u.username ? `@${u.username}` : "@user";
  const name   = u.displayName || u.username || "Someone";
  const avatarUrl = (window.avatarFor ? window.avatarFor(u, u.uid) : null);

  const initial = (name || "?").trim().charAt(0).toUpperCase();

  _container.querySelector("#pvHeader").innerHTML = `
    <div class="pv-card">
      <div class="pv-top">
        <div class="pv-avatar">
          ${avatarUrl
            ? `<img alt="" src="${avatarUrl}" referrerpolicy="no-referrer">`
            : initial}
        </div>
        <div class="pv-name-row">
          <div class="pv-name">${escapeHtml(name)}</div>
          <div class="pv-handle">${escapeHtml(handle)}</div>
        </div>
      </div>
      ${u.bio ? `<p class="pv-bio">${escapeHtml(u.bio)}</p>` : ""}
      <div class="pv-stats">
        ${postCount != null ? `<div class="pv-stat"><div class="num">${postCount}</div><div class="label">Posts</div></div>` : ""}
        <div class="pv-stat"><div class="num">${followers}</div><div class="label">Followers</div></div>
        <div class="pv-stat"><div class="num">${following}</div><div class="label">Following</div></div>
      </div>
      <div class="pv-actions" id="pvActions"></div>
    </div>
  `;

  const actions = _container.querySelector("#pvActions");
  if (isMe) {
    actions.innerHTML = `<button class="btn btn-ghost" id="pvEdit">Edit profile</button>`;
    actions.querySelector("#pvEdit").addEventListener("click", () => window.loadPage?.("profile"));
    return;
  }
  // Follow button (initial state set asynchronously)
  actions.innerHTML = `<button class="btn btn-primary" id="pvFollow">Follow</button>`;
  const btn = actions.querySelector("#pvFollow");
  isFollowing(u.uid).then((on) => {
    _isFollowingCached = !!on;
    setFollowBtn(btn, _isFollowingCached);
  }).catch(() => setFollowBtn(btn, false));

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const ok = await safe(
      () => (_isFollowingCached ? unfollow(u.uid) : follow(u.uid)),
      _isFollowingCached ? "Couldn't unfollow" : "Couldn't follow"
    );
    btn.disabled = false;
    if (ok !== null) {
      _isFollowingCached = !_isFollowingCached;
      setFollowBtn(btn, _isFollowingCached);
      toast(_isFollowingCached ? "Following" : "Unfollowed");
    }
  });
}

function setFollowBtn(btn, on) {
  btn.textContent = on ? "Following" : "Follow";
  btn.classList.toggle("btn-primary", !on);
  btn.classList.toggle("btn-ghost", on);
}

function paintPosts(rows) {
  const grid = _container?.querySelector("#pvGrid");
  if (!grid) return;
  if (!rows || !rows.length) {
    grid.innerHTML = `<div class="pv-empty pv-empty--inline"><div class="pv-empty__icon">📭</div><p>No posts yet.</p></div>`;
    return;
  }
  grid.innerHTML = "";
  for (const p of rows) grid.appendChild(renderPostTile(p));
}

function renderPostTile(p) {
  const tile = document.createElement("article");
  tile.className = "pv-tile";
  if (p.imageUrl) {
    tile.innerHTML = `<img alt="" src="${p.imageUrl}" loading="lazy" referrerpolicy="no-referrer">`;
  } else {
    const text = (p.text || "").slice(0, 140);
    tile.classList.add("pv-tile--text");
    tile.innerHTML = `<div class="pv-tile__text">${escapeHtml(text)}</div>`;
  }
  tile.addEventListener("click", () => {
    // Reuse feed module's helper if present
    if (typeof window.openFeedPost === "function") window.openFeedPost(p.id);
    else window.loadPage?.("feed");
  });
  return tile;
}

// ----- helpers -----
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
