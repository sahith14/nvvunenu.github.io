# BONDSYNC — SINGLE COMPREHENSIVE PROMPT FOR CLAUDE OPUS 4.7

> **DO NOT SUMMARIZE. READ EVERY FILE. FIX EVERY BUG. NO CSS GLITCHES. NO UI OVERLAP. EVERYTHING MUST WORK.**

---

## PROJECT OVERVIEW

BondSync ("Nuvvu Nenu") is a vanilla-JS couple app. Tech stack:
- **Frontend:** Vanilla ES modules + CSS (no frameworks)
- **Auth:** Firebase Auth
- **Database:** Firestore
- **Storage:** Supabase Storage (for media)
- **Backend:** Node.js + Express + Socket.IO + Supabase Postgres (in `/server`)

The app has pages: `feed`, `search`, `messages`, `partner`, `space`, `profile`, `profileView`, `checkin`, `memories`, `gifts`, `dashboard`, `lovenotes`, `calendar`, `pet`, `dateplanner`.

---

## CRITICAL RULES (DO NOT VIOLATE)

1. **NO FRAMEWORKS** — Vanilla JS only. No React, Vue, Svelte.
2. **NO CSS FRAMEWORKS** — Pure CSS. No Tailwind, Bootstrap.
3. **DO NOT DELETE** existing class names or DOM structures. Only enhance/add.
4. **CSS MUST NOT OVERLAP** — check every breakpoint, z-index, position, margin, padding. Test mobile AND desktop.
5. **NO GLOBAL UNQUALIFIED SELECTORS** like `input {}`, `button {}`, `video {}` in CSS — these break other modules.
6. **NO `alert()`** — replace all with `toast()` or `spToast()`.
7. **NO INLINE `getDoc(doc(db, "users", uid))`** in modules — use `window.appState` from `state/appState.js`.
8. **NO BASE64 IN FIRESTORE** — media goes to Supabase Storage via `services/storageService.js`.
9. **ALL MODULES MUST USE** `export function render()` + `export function init()` → return cleanup fn.
10. **Use `window.appState`** for all user/partner/coupleId lookups.

---

## FILE STRUCTURE

```
├── app.html              (main app shell)
├── app.js                (router, page loader, bootstrap)
├── index.html            (splash → redirects to login.html)
├── login.html            (login + Google OAuth)
├── signup.html           (signup)
├── firebase.js           (Firebase init)
├── supabase.js           (Supabase client for storage)
├── styles-global.css     (global reset, nav, themes, glass, anims)
├── styles-feed.css
├── styles-messages.css
├── styles-partner.css
├── styles-spaces.css
├── styles-search.css
├── styles-settings.css
├── styles-profile.css
├── styles-premium-glass.css
├── styles-upgrade.css    (toast, skeleton, day-sep, ticks)
├── styles-space-polish.css (space gradients, lock, shake, etc.)
├── features.css
├── modules/
│   ├── auth.js, feed.js, search.js, messages.js, partner.js
│   ├── space.js          (2241 lines — BLOATED, needs cleanup)
│   ├── spaceEnhance.js   (auto UI polish — keep)
│   ├── spaceGames.js     (TTT + Connect4 + Chess UI — keep)
│   ├── profile.js, profileView.js, checkin.js, memories.js
│   ├── gifts.js, dashboard.js, lovenotes.js, calendar.js
│   ├── pet.js, dateplanner.js
│   └── auth.js           (login/signup handling)
├── utils/
│   ├── coupleId.js
│   ├── time.js
│   ├── toast.js
│   └── skeleton.js
├── state/
│   └── appState.js       (global state — MANDATORY to use)
├── services/
│   ├── storageService.js  (Supabase uploads + compression)
│   ├── presenceService.js (online/lastSeen)
│   ├── partnerService.js (search/request/accept)
│   ├── chatService.js     (real-time DM + messages + pagination)
│   ├── memoryService.js   (memory CRUD with Supabase)
│   └── callService.js     (WebRTC peer — keep)
├── server/               (Node + Socket.IO + Supabase backend)
│   ├── src/index.js, src/db/schema.sql, src/sockets/chat.js
│   ├── src/services/chat.js, src/middleware/auth.js
│   └── src/client-sdk/e2ee.js, src/client-sdk/chatClient.js
```

---

## CSS BUGS TO FIX (TOP PRIORITY — NO UI OVERLAP)

### 1. `styles-global.css` — KILL GLOBAL SELECTORS (lines 474-493)

```css
/* BAD — this breaks EVERY input/button in the entire app */
input { display:block; width:250px; ... }
button { width:250px; ... }
```

**FIX:** Scope ALL of these under `.auth-body`, `.login-form`, or a specific class. E.g.:
```css
.auth-body input { ... }
.auth-body button { ... }
```

### 2. `styles-global.css` — `body` color conflict

`body { color: #2a235a; }` — this makes dark mode text invisible. The dark theme sets `background: #000; color: #fff` but `.theme-dark` only styles listed elements. Add a proper dark theme that sets `body { color: #fff; }` under `.theme-dark`.

### 3. `styles-spaces.css` — Global `video` selector (line 478)

```css
video { width:100%; height:100%; object-fit:contain; border-radius:12px; background:#000; }
```

This affects EVERY video tag including Instagram-style stories. Scope it: `#video-container video, .sp-call__remote, .sp-call__local { ... }`.

### 4. `styles-global.css` — `.glass:hover` transform (line 731)

```css
.glass:hover, .post-card:hover, .dm-item:hover, .room-header:hover {
  transform: translateY(-4px) scale(1.02);
}
```

This causes ALL glass elements to shift on hover, breaking layout on mobile (elements slide off screen). Add `@media (hover: hover)` or remove `transform` from this blanket selector. Keep it only on `.post-card` and `.dm-item`, NOT `.glass` globally.

### 5. `styles-messages.css` — Mobile slide conflicts

`.ig-dm-list { width: 320px; }` on mobile — this is hidden at 900px. But the responsive breakpoints in `styles-global.css` use `901px` and `1350px` while messages uses `900px`. Unify breakpoints: use `900px` everywhere.

### 6. `styles-spaces.css` — Space room layout breakpoints fight

```css
.space-room { grid-template-columns: 1fr 320px; }          /* default */
@media (max-width: 900px) { grid-template-columns: 1fr; }
@media (min-width: 1024px) { grid-template-columns: 260px 1fr 360px; }
```

Between 901px and 1023px the default `1fr 320px` applies but the container width is ~600px → overflow. Fix: change default to `1fr` and only add sidebars at 1024px+.

### 7. `styles-spaces.css` — Activity button width

`.activity-grid button { flex: 1; }` — on mobile, buttons get squished. Change to `flex: 1 1 120px; min-width: 120px;`.

### 8. `styles-global.css` — `#page` margin-left

Set at `901px` and `1351px` but also hidden at `1350px`. There's a 1px dead zone at exactly 1350px. Fix: use `< 901` and `>= 901` consistently.

### 9. `styles-global.css` — `.bottom-nav` on mobile

`position: fixed; bottom: 5px; left: 50%; transform: translateX(-50%); width: 95%` — on very small screens (<360px) this overflows. Add `max-width: 420px`.

### 10. `styles-premium-glass.css` + `styles-space-polish.css` overlap

Both define `.game-card` and `.space-header`. The polish file is loaded LAST so it wins, BUT the space file has conflicting `background` values. The polish file uses `rgba(255,255,255,0.10)` while spaces.css uses `#0b0d12` for `.space-root`. Ensure the space container inherits the purple gradient from the body, not a black override. Remove `.space-root { background: #0b0d12; }` entirely — let body background show through.

---

## MODULE BUGS TO FIX

### MODULES STILL USING INLINE getDoc(users/uid) — MIGRATE ALL

These modules fetch `users/{uid}` directly instead of using `window.appState`. Every one of these causes:
- Extra Firestore reads (costs money)
- Race conditions
- Inconsistent coupleId logic

**Files to fix:**

| File | Lines | What to do |
|------|-------|-----------|
| `modules/gifts.js` | 84-86 | Replace with `getState().coupleId` and `requireCouple()` |
| `modules/pet.js` | 71-72, 135-136 | Replace with `getState().coupleId` |
| `modules/calendar.js` | 107-109, 130-132 | Replace with `getState().coupleId` |
| `modules/checkin.js` | — | Audit and replace |
| `modules/dateplanner.js` | 146-148, 159-161 | Replace with `getState().coupleId` |
| `modules/dashboard.js` | 68 | Replace with `getState().user` |
| `modules/lovenotes.js` | 100-102, 126-128, 186-188 | Replace with `getState().coupleId` |
| `modules/profile.js` | 68, 228, 234 | Replace with `getState().user` |
| `modules/profileView.js` | 314, 204, 209, 220, 469 | Replace with cached data from appState or partnerCache |
| `modules/search.js` | 31 | Replace with `getState().user.uid` |
| `modules/space.js` | 382, 402, 441, 453, 464 | Replace with `getState().user`, `getState().partnerId`, `getState().coupleId` |
| `modules/partner.js` | 43, 57, 135 | Already partially done but check if using appState |

**Migration pattern for each file:**
```js
import { getState, onAppState, requireCouple } from "../state/appState.js";
import { toast, toastError, safe } from "../utils/toast.js";

// In init():
const off = onAppState((s) => {
  if (!s.ready) return;
  render(s);  // or boot(s)
  off();
});

// In any function:
const { user, partner, coupleId, partnerId } = getState();
// OR for couple-only features:
const { coupleId } = requireCouple();  // throws if no partner
```

### REPLACE ALL `alert()` CALLS

Search for `alert(` in ALL `.js` files. Replace with:
```js
import { toast, toastError } from "../utils/toast.js";
// or use window.toast if already global
toast("Message");
toastError("Error message");
```

Known locations:
- `modules/auth.js` — 3 alerts (login/signup errors)
- `modules/profile.js` — 6 alerts (followers, following, edit, share, etc.)
- `modules/gifts.js` — 1 alert (no partner)
- `modules/lovenotes.js` — 4 alerts (no partner, empty text, scheduled, sealed)
- `modules/feed.js` — 1 alert (share)
- `modules/space.js` — search for any remaining alerts
- `app.js` — check for alerts in login/signup handlers

### `modules/space.js` — CRITICAL CLEANUP

This file is **2241 lines** — WAY too big. Tasks:

1. **Strip dead code** — remove quality presets, screen share presets, music sync presets, trivia, pictionary, memory match game stubs. Keep ONLY: TicTacToe, Connect4, Chess (now in `spaceGames.js`), Video Call (use `callService.js`), Screen Share (basic), Music (basic UI), Chat.

2. **Remove duplicate getDoc(users/uid) calls** — use `getState()` instead.

3. **Replace the inline TTT/Connect4/Chess renderers** with calls to `window.BondSyncGames.mountGame(type, container)`.

4. **Move WebRTC logic** out to use `services/callService.js` instead of inline RTCPeerConnection code.

5. **Target: 400-600 lines max.**

### `modules/messages.js` — VERIFY INTEGRITY

This was heavily refactored. Check:
- Are imports clean (all at top, no mid-file dynamic imports)?
- Does `window.openChat()` work correctly?
- Does the mobile slide animation work (`.ig-dm.chat-open`) ?
- Are `ensureChat` and `subscribeMessages` properly imported from `services/chatService.js`?

### `modules/memories.js` — VERIFY

- Does `addMemoryHandler()` use `memoryService.addMemory()` correctly?
- Does the upload progress spinner work?
- Is the anniversary calculation correct?

---

## MISSING FEATURES TO IMPLEMENT

### 1. Dark Theme (REAL)

The `.theme-dark` in `styles-global.css` only styles listed elements. Make it a PROPER dark theme:

```css
.theme-dark {
  --bg: #0a0a0f;
  --panel: #12121a;
  --glass: rgba(255, 255, 255, 0.06);
  --border: rgba(255, 255, 255, 0.1);
  --text: #e8e8f0;
  --muted: #8888a0;
  --primary: #ff4d8d;
  --success: #3ddc97;
  --error: #ff5d5d;
}
.theme-dark body {
  background: var(--bg);
  color: var(--text);
}
/* Apply to all major components */
```

### 2. Theme Toggle

Add a theme toggle in `settings` page (or profile). Store preference in `localStorage`. On load, apply class to `<body>`.

### 3. Firestore Security Rules

Write and provide Firestore security rules. Critical — data is currently wide open.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own doc
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid;
    }
    // Chats: members only
    match /chats/{cid} {
      allow read, write: if request.auth != null && request.auth.uid in resource.data.members;
    }
    match /chats/{cid}/messages/{mid} {
      allow read, write: if request.auth != null && request.auth.uid in get(/databases/$(database)/documents/chats/$(cid)).data.members;
    }
    // Memories: couple-scoped
    match /memories/{cid}/entries/{eid} {
      allow read, write: if request.auth != null && (cid.matches(request.auth.uid + ".*") || cid.matches(".*" + request.auth.uid));
    }
    // Same pattern for gifts, calendar, pet, letters, dates
  }
}
```

### 4. Feed Post Upload → Supabase Storage

`modules/feed.js` likely stores base64 or uses Firestore for images. Move to `uploadMedia()` from `services/storageService.js`.

### 5. Profile Avatar Upload → Supabase Storage

Same pattern. Use `uploadMedia(file, { folder: 'avatars/' + uid })`.

### 6. Real-time Feed

Use `onSnapshot` on a `posts` collection (couple-scoped or public) instead of `getDocs`.

### 7. Gifts Module — Complete Migration

Currently inline `getDoc` + `alert`. Migrate to `appState` + `toast` + Supabase storage for gift images.

### 8. Calendar Module — Complete Migration

Migrate to `appState` + couple-scoped `onSnapshot`.

### 9. Pet Module — Complete Migration

Migrate to `appState` + couple-scoped `onSnapshot`.

### 10. Check-in Module — Complete Migration

Migrate to `appState` + couple-scoped.

### 11. Love Notes Module — Complete Migration

Migrate to `appState` + couple-scoped + Supabase for attachments.

### 12. Date Planner — Complete Migration

Migrate to `appState` + couple-scoped.

### 13. Dashboard — Complete Migration

Use `appState` data to render stats without extra reads.

### 14. Messages → Use E2EE Backend (Optional but document)

The `/server` backend has E2EE chat. Add a toggle or fallback:
- If `window.__USE_E2EE__` is true, use Socket.IO client from `server/src/client-sdk/chatClient.js`
- Otherwise, keep Firestore mode.

### 15. Socket.IO Client Integration

Write a `services/socketChatService.js` that mirrors `chatService.js` API but uses the Socket.IO backend. This allows seamless switching.

### 16. PWA Manifest + Service Worker

Add `manifest.json`, icons, and a basic service worker for offline skeleton + cache.

### 17. Push Notifications (Web Push)

Add VAPID key support and push notification for new messages.

### 18. Voice Messages

Add `MediaRecorder` API for sending voice messages in chat. Store as `.webm` in Supabase Storage.

### 19. Message Reactions UI

The chatService already stores reactions. Add a reaction picker (emoji bar on long-press / hover).

### 20. Message Forwarding

Allow forwarding messages to other chats.

### 21. Reply to Message (Thread)

Add reply UI (quote bubble above message).

### 22. Pin Messages

Allow pinning up to 3 messages per chat. Show pinned banner at top of chat.

### 23. Chat Background / Themes

Allow setting chat wallpaper (gradient, pattern, or image). Store preference in `localStorage`.

### 24. Profile Verification Badge

Add a blue checkmark for verified accounts.

### 25. Story Feature (Instagram-style)

24h disappearing posts. Use Firestore TTL or client-side expiry.

---

## ARCHITECTURE FIXES

### 1. Consolidate `getUser` calls

Every module that needs partner info should read from `window.appState.partner`, not do `getDoc(doc(db, "users", partnerId))`. The partner data is already live-synced.

### 2. `window.currentCleanup` contract

Every module's `init()` MUST return a cleanup function that unsubscribes ALL `onSnapshot` listeners. Check ALL modules for this contract.

### 3. Memory leaks in `space.js`

The `unsubscribers`, `intervals`, `listeners` arrays are manually managed. Replace with a single `AbortController` pattern or ensure `cleanupRegistries()` is bulletproof.

### 4. `app.html` — Add meta viewport properly

Already has `<meta name="viewport" content="width=device-width, initial-scale=1.0">`. Ensure `theme-color` meta is also present for mobile status bar coloring.

### 5. Z-index audit

| Element | Current z-index | Should be |
|---------|----------------|-----------|
| `.bottom-nav` | 9999 | 100 |
| `.desktop-nav` | 9999 | 100 |
| `#splash` | 999999 | 200 |
| `.sp-toast-host` | 9999 | 300 |
| `.feature-drawer` | ? | 90 |
| `.space-modal` | ? | 80 |
| Call overlay | ? | 150 |

Fix the z-index stack so nothing overlaps incorrectly. Drawers < modals < toasts < splash < call overlay.

---

## SPECIFIC CSS FIXES CHECKLIST

- [ ] Scope `input {}` and `button {}` in `styles-global.css` to `.auth-body`
- [ ] Scope `video {}` in `styles-spaces.css` to `#video-container video`
- [ ] Remove `.glass:hover` transform from `styles-global.css` or scope to specific cards only
- [ ] Fix `.space-root { background: #0b0d12 }` — remove it, let body gradient show
- [ ] Unify responsive breakpoints: use `900px` everywhere (not mix of 901, 900, 768, 1024)
- [ ] Fix `#page` margin-left dead zone at 1350px
- [ ] Add `max-width: 420px` to `.bottom-nav`
- [ ] Fix `.activity-grid button { flex: 1 }` to `flex: 1 1 120px`
- [ ] Fix `.space-room` grid: default `1fr`, add sidebars only at 1024px+
- [ ] Make `.theme-dark` actually work on ALL elements
- [ ] Ensure `env(safe-area-inset-bottom)` is used on ALL fixed bottom elements
- [ ] Ensure `overflow-x: hidden` on body + all containers
- [ ] Add `min-height: 100dvh` (dynamic viewport height) for mobile Safari
- [ ] Ensure no element has `width: 100vw` (causes horizontal scroll on mobile with scrollbar)

---

## TEST SCENARIOS (VERIFY AFTER FIXES)

### Mobile (iPhone SE / Pixel 5 width)
1. Open app → login → feed loads → no horizontal scroll
2. Tap bottom nav items → each page loads, no overlap with nav
3. Open messages → DM list shows → tap a chat → chat slides in, nav hidden
4. Open space → cards visible, tap game → game loads, no overflow
5. Scroll feed → bottom nav stays fixed, no content behind it
6. Tap profile → avatar upload → choose image → uploads to Supabase

### Desktop (1440px)
1. Sidebar visible, bottom nav hidden
2. `#page` has correct margin-left (240px)
3. Space room shows 3-column layout (members | main | chat)
4. Messages show DM list + chat side by side
5. Hover on cards shows lift effect, no layout shift
6. No z-index fighting between drawer, modals, toasts

### Cross-page
1. Login → signup → back to login → no state leakage
2. Logout → login as different user → appState resets correctly
3. Partner accept → all couple-scoped modules auto-refresh
4. Partner remove/reject → lock badges appear on all couple features

---

## FINAL OUTPUT EXPECTATION

After ALL fixes:
- **0 CSS glitches** — every page looks polished, nothing overlaps, nothing breaks layout
- **0 `alert()` calls** — all replaced with toast
- **0 inline `getDoc(users/uid)`** in modules — all use `appState`
- **space.js < 600 lines** — stripped of dead code, delegates to services
- **Dark theme works** — toggle in settings, persists in localStorage
- **All modules load data via `onSnapshot`** where real-time matters (chat, feed, memories)
- **All modules return cleanup functions**
- **Mobile + desktop both perfect**
- **No console errors on any page load**

---

## CONTEXT FILES YOU MUST READ FIRST

Before making ANY changes, read these files in this order to understand the architecture:

1. `app.js` — router, page loading, cleanup contract
2. `app.html` — shell, nav, drawers, toast element
3. `state/appState.js` — HOW to get user/partner/coupleId
4. `services/chatService.js` — HOW chat works now
5. `services/memoryService.js` — HOW memories work now
6. `styles-global.css` — base styles, the source of most bugs
7. `styles-spaces.css` + `styles-space-polish.css` — space styling
8. `styles-messages.css` — message/chat styling
9. `modules/space.js` — the bloated file to gut
10. `modules/messages.js` — verify refactored chat
11. `modules/memories.js` — verify refactored memories
12. `UPGRADE.md` — migration patterns for remaining modules

Then fix ALL remaining modules using the migration pattern.

---

## MANDATORY VERIFICATION COMMAND

After all changes, run this in browser console on EVERY page:

```js
// Check for alerts
const alertCalls = document.querySelectorAll('[onclick*="alert"]');
console.log('Alert onclick count:', alertCalls.length);  // MUST BE 0

// Check for global input/button CSS leakage
document.querySelectorAll('input, button').forEach(el => {
  const w = getComputedStyle(el).width;
  if (w === '250px' && !el.closest('.auth-body')) {
    console.warn('Global CSS leakage on', el);
  }
});

// Check appState
console.log('appState ready:', window.appState?.ready);
console.log('appState user:', window.appState?.user?.uid);
console.log('appState partner:', window.appState?.partner?.uid);
console.log('appState coupleId:', window.appState?.coupleId);

// Check for horizontal overflow
const docWidth = document.documentElement.scrollWidth;
const winWidth = window.innerWidth;
if (docWidth > winWidth) console.warn('HORIZONTAL OVERFLOW:', docWidth - winWidth);
```

---

## END OF PROMPT

> **REMEMBER: Read every file. Fix every bug. No summaries. Ship production-quality code. CSS is sacred — no glitches, no overlaps, no broken layouts.**
