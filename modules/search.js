// =====================================================================
// modules/search.js — find users by username.
// Wraps services/feedService.searchUsers() with debounced input + follow.
// =====================================================================
import { searchUsers, follow, unfollow, isFollowing } from "../services/feedService.js";
import { onAppState } from "../state/appState.js";
import { skeletonList } from "../utils/skeleton.js";
import { toast, toastError, safe } from "../utils/toast.js";

export async function renderSearch(container) {
  container.innerHTML = `
    <section class="search-page">
      <h1 class="page-title">Search</h1>
      <p class="search-sub">Find people by their username.</p>

      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input id="searchInput" class="search-input"
               type="search"
               placeholder="@username"
               autocomplete="off"
               autocapitalize="off"
               spellcheck="false">
        <button id="searchClear" class="search-clear" hidden>✕</button>
      </div>

      <div id="searchResults" class="search-results" aria-live="polite"></div>
    </section>

    <style>
      .search-page{display:flex;flex-direction:column;gap:14px;padding-bottom:24px}
      .page-title{font-size:1.5rem;font-weight:800;margin:6px 2px 0}
      .search-sub{color:var(--muted);font-size:.875rem;margin:0 2px 8px}

      .search-box{
        display:flex;align-items:center;gap:8px;
        background:var(--surface);border:1px solid var(--border);
        border-radius:var(--radius-full);padding:0 14px;height:46px;
        transition:border-color var(--duration-fast) var(--ease-out);
      }
      .search-box:focus-within{border-color:rgba(155,140,255,.45)}
      .search-icon{opacity:.6;font-size:15px}
      .search-input{flex:1;height:100%;background:transparent;border:0;outline:0;color:var(--text);font-size:.9375rem}
      .search-clear{
        width:26px;height:26px;border-radius:50%;background:var(--card);border:1px solid var(--border);
        color:var(--muted);font-size:12px;display:inline-flex;align-items:center;justify-content:center;
      }
      .search-clear:hover{color:var(--text)}

      .search-results{display:flex;flex-direction:column;gap:8px;min-height:80px}
      .search-empty,.search-tip{color:var(--muted);font-size:.875rem;padding:12px 4px;text-align:center}

      .user-row{
        display:flex;align-items:center;gap:12px;padding:10px 12px;
        background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);
      }
      .user-avatar{width:42px;height:42px;border-radius:50%;flex:0 0 42px;
        background:var(--surface);object-fit:cover;display:grid;place-items:center;
        color:var(--muted);font-weight:700;font-size:1rem;
        border:1px solid var(--border);
      }
      .user-meta{flex:1;min-width:0}
      .user-name{font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .user-handle{color:var(--muted);font-size:.8125rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .user-actions{display:flex;gap:6px;flex:0 0 auto}
      .user-actions .btn{padding:8px 14px;font-size:.8125rem}
    </style>
  `;

  const input  = container.querySelector("#searchInput");
  const clear  = container.querySelector("#searchClear");
  const list   = container.querySelector("#searchResults");

  let myUid = null;
  const off = onAppState((s) => { if (s.ready) myUid = s.user?.uid || null; });

  // Tip state
  list.innerHTML = `<div class="search-tip">Type at least 2 characters to search.</div>`;

  let debounceId = null;
  let lastQuery  = "";

  function setClearVisible(v) { clear.hidden = !v; }

  async function runSearch(q) {
    lastQuery = q;
    if (q.length < 2) {
      list.innerHTML = `<div class="search-tip">Type at least 2 characters to search.</div>`;
      return;
    }
    list.innerHTML = skeletonList(4, "list");
    const results = await safe(() => searchUsers(q, 15), "Search failed");
    if (lastQuery !== q) return; // stale
    if (!results || !results.length) {
      list.innerHTML = `<div class="search-empty">No users found for "<strong>${escape(q)}</strong>".</div>`;
      return;
    }
    list.innerHTML = "";
    for (const u of results) {
      if (u.uid === myUid) continue;
      list.appendChild(renderUserRow(u));
    }
    if (!list.children.length) {
      list.innerHTML = `<div class="search-empty">Only you matched. Try a different name.</div>`;
    }
  }

  input.addEventListener("input", () => {
    const v = input.value.replace(/^@/, "").trim();
    setClearVisible(Boolean(v));
    clearTimeout(debounceId);
    debounceId = setTimeout(() => runSearch(v.toLowerCase()), 220);
  });

  clear.addEventListener("click", () => {
    input.value = ""; setClearVisible(false); input.focus();
    runSearch("");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value = ""; setClearVisible(false); runSearch(""); }
  });

  // Autofocus after layout
  setTimeout(() => input.focus(), 50);

  return () => { clearTimeout(debounceId); off?.(); };
}

function renderUserRow(u) {
  const row = document.createElement("div");
  row.className = "user-row";
  const initial = (u.displayName || u.username || "?").trim().charAt(0).toUpperCase();
  const avatar = u.photoURL
    ? `<img class="user-avatar" alt="" src="${u.photoURL}" referrerpolicy="no-referrer">`
    : `<div class="user-avatar" aria-hidden="true">${initial}</div>`;
  row.innerHTML = `
    ${avatar}
    <div class="user-meta">
      <div class="user-name">${escape(u.displayName || u.username || "Someone")}</div>
      <div class="user-handle">@${escape(u.username || "user")}</div>
    </div>
    <div class="user-actions">
      <button class="btn btn-ghost"   data-act="view">View</button>
      <button class="btn btn-primary" data-act="follow">Follow</button>
    </div>
  `;
  // Wire actions
  const btnView   = row.querySelector('[data-act="view"]');
  const btnFollow = row.querySelector('[data-act="follow"]');

  btnView.addEventListener("click", () => {
    // Hand the target uid to profileView via a global, then route there.
    window.__viewUserUid = u.uid;
    if (typeof window.loadPage === "function") window.loadPage("profileView");
  });

  // Initial follow state
  isFollowing(u.uid).then((on) => {
    btnFollow.textContent = on ? "Following" : "Follow";
    btnFollow.classList.toggle("btn-primary", !on);
    btnFollow.classList.toggle("btn-ghost",   on);
  }).catch(() => {});

  btnFollow.addEventListener("click", async () => {
    btnFollow.disabled = true;
    const wasFollowing = btnFollow.textContent.trim() === "Following";
    const ok = await safe(
      () => (wasFollowing ? unfollow(u.uid) : follow(u.uid)),
      wasFollowing ? "Couldn't unfollow" : "Couldn't follow"
    );
    btnFollow.disabled = false;
    if (ok !== null) {
      btnFollow.textContent = wasFollowing ? "Follow" : "Following";
      btnFollow.classList.toggle("btn-primary", wasFollowing);
      btnFollow.classList.toggle("btn-ghost", !wasFollowing);
      toast(wasFollowing ? "Unfollowed" : "Followed");
    }
  });

  return row;
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
