# Nuvvu Nenu — Setup

Get a fresh checkout running locally in under five minutes.

> **Stack at a glance**
> - **Frontend:** Vanilla ES modules + plain CSS (no build step).
> - **Auth + DB:** Firebase Auth + Firestore (project `nuvvunenu-cf326`).
> - **Storage:** Supabase Storage if configured; otherwise Firebase Storage (auto-fallback).
> - **Optional backend:** `server/` — Node 20 + Express + Socket.IO + Supabase. Used only for E2EE chat / future server-side concerns. The frontend works without it.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Git | any | Clone the repo |
| Python 3 *or* Node 18+ | any | Serve static files |
| Node 20+ *(only if you run the server)* | ≥ 20 | `server/` requires it |
| A Firebase project | — | Auth + Firestore + Storage |
| A Supabase project | — | *(optional)* Storage backend, faster + cheaper than Firebase Storage |

The frontend has **no `npm install` step** — files are loaded directly by the browser as ES modules.

---

## 2. Clone

```powershell
git clone https://github.com/sahith14/nvvunenu.github.io.git
cd nvvunenu.github.io
```

---

## 3. Configure Firebase (required)

The project ships with the Firebase config already inlined in `firebase.js`, `login.html`, `signup.html` (project: `nuvvunenu-cf326`). If you want to run against your own Firebase project:

1. Go to <https://console.firebase.google.com/> → **Create project**.
2. Add a Web app, copy the `firebaseConfig` object.
3. Replace the inline `firebaseConfig` in:
   - `firebase.js`
   - `login.html`
   - `signup.html`
4. In the Firebase console:
   - **Authentication → Sign-in method:** enable **Email/Password** and **Google**.
   - **Firestore → Create database** in production mode.
   - **Firestore → Rules:** copy the contents of `firestore.rules` from this repo and publish.
   - **Storage:** enable Cloud Storage (used as the fallback when Supabase isn't configured).

> The Firebase API key is **public-by-design** — it identifies the project. Access control is enforced by `firestore.rules`. Do not panic if you see it committed to git; just don't commit secrets like service-role / server-side keys.

---

## 4. Configure Supabase Storage (optional, recommended)

Without Supabase, media uploads silently use Firebase Storage. Supabase is faster and cheaper for media-heavy use.

1. Create a project at <https://supabase.com/>.
2. **Storage → New bucket** named `bondsync-media`. Make it **Public** (or set up policies for signed URLs in Phase 2).
3. Open `app.html` and add this **before** the `<script type="module" src="./app.js">` line:

```html
<script>
  window.__SUPABASE_URL__       = "https://YOUR_PROJECT.supabase.co";
  window.__SUPABASE_ANON_KEY__  = "YOUR_ANON_KEY";
  window.__SUPABASE_BUCKET__    = "bondsync-media"; // optional; this is the default
</script>
```

The anon key is safe to put in client code as long as your bucket policy enforces access. The frontend's `services/storageService.js` will detect these globals and switch backends automatically.

---

## 5. Run the frontend

The simplest way (Python 3):

```powershell
python -m http.server 8000
```

Or Node:

```powershell
npx http-server -p 8000
```

Open <http://localhost:8000/>. You'll see the splash screen, then auto-redirect to `/login.html`. Sign up, then you're in `app.html`.

> **Why a static server, not file://?** Browsers refuse to load ES modules from `file://` URLs. Any tiny static server works.

---

## 6. *(Optional)* Run the backend

The `server/` folder hosts a separate Express + Socket.IO + Supabase backend used for E2EE chat / future server-side concerns. The current frontend does **not** require it for any feature.

```powershell
cd server
cp .env.example .env       # then edit .env with real values
npm install
npm run dev                # node --watch, restarts on save
```

`server/.env` keys (see `server/.env.example`):

| Key | Required | Notes |
|---|---|---|
| `PORT` | yes | usually `8080` |
| `NODE_ENV` | yes | `development` or `production` |
| `CLIENT_ORIGIN` | yes | the frontend's URL, for CORS |
| `JWT_SECRET` | yes | a long random string |
| `JWT_ISSUER`, `JWT_AUDIENCE` | yes | recommend `nuvvunenu` |
| `SUPABASE_URL` | yes | same as the frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **server-only**, never expose to the browser |
| `SUPABASE_ANON_KEY` | yes | same as the frontend |
| `CHAT_RATE_MAX`, `CHAT_RATE_WINDOW_MS` | optional | per-socket rate-limits |

> ⚠️ **`server/.env` is in `.gitignore`** because it contains the Supabase service-role key. Treat that key like a database admin password.

---

## 7. Project layout

```
.
├── index.html              splash → redirects to login.html
├── login.html              email + Google login (writes users/{uid})
├── signup.html             email + Google signup
├── app.html                main app shell (header, nav, all module roots)
├── app.js                  router, page registry, theme bootstrap
├── firebase.js             Firebase init (auth, firestore, storage)
├── manifest.json           PWA manifest
├── firestore.rules         security rules — couple-only data model
├── docs/                   PRODUCT_ROADMAP, UPGRADE, CLAUDE_OPUS prompt
├── modules/                page modules (each exports renderXxx + cleanup)
│   ├── home.js             couple home dashboard
│   ├── feed.js             public feed (posts, follow, comments)
│   ├── space.js            couple zone (calls, games, sleep, breathing, touch)
│   ├── chat.js             real-time chat with AI suggested replies + voice notes
│   ├── moments.js          couple memory timeline (photo/video upload)
│   ├── bond.js             couple pairing hub (4 reactive states)
│   ├── profile.js          your-own profile + avatar upload
│   ├── profileView.js      read-only public profile
│   ├── search.js           username search
│   ├── settings.js         theme toggle, notifications, account
│   ├── subscription.js     plans (Free / Together+ / Forever) + mock checkout
│   ├── callView.js         WebRTC call overlay
│   ├── incomingCall.js     cross-page call ringer
│   ├── spaceGames.js       Tic Tac Toe + Connect 4 + Chess UI
│   ├── cuteFx.js           floating hearts + sparkles + ripple + confetti
│   └── avatar.js           SVG initial avatars (no third-party)
├── services/               business logic (no DOM)
│   ├── chatService.js      live DM + messages + reactions + ticks
│   ├── coupleService.js    bond score + mood + thinking-of-you poke
│   ├── memoryService.js    memory CRUD with Supabase/Firebase media
│   ├── partnerService.js   pairing flow (search/invite/accept/unpair)
│   ├── presenceService.js  online + lastSeen heartbeat
│   ├── callService.js      WebRTC peer factory
│   ├── feedService.js      posts/comments/follow + username uniqueness
│   ├── subscriptionService.js plan tiers + daily usage tracking
│   ├── featureGate.js      enforces plan limits (gateVoiceNote, gateSleepTogether, …)
│   ├── storageService.js   Supabase / Firebase Storage abstraction
│   └── aiReply.js          local heuristic smart-reply generator
├── state/
│   └── appState.js         single source of truth (user, partner, coupleId)
├── utils/
│   ├── coupleId.js         canonical id helper
│   ├── time.js             relative time + day grouping
│   ├── toast.js            non-blocking toast (replaces alert/prompt/confirm)
│   ├── skeleton.js         shimmer placeholder rows
│   ├── supabase.js         lazy Supabase client (storage only)
│   └── firestoreSafe.js    cached user reads + quota-aware getDocs
├── styles/                 modular CSS (one file per concern)
└── server/                 (optional) Express + Socket.IO + Supabase
    └── src/index.js        backend entry
```

---

## 8. Daily workflow

| What | Command |
|---|---|
| Run the frontend | `python -m http.server 8000` |
| Run the backend (live reload) | `cd server && npm run dev` |
| Sanity-check JS parses | `node --check app.js` (or any `.js`) |
| Edit files | Save and refresh — no build step |

---

## 9. Deploy

The frontend repo is `sahith14/nvvunenu.github.io` — pushing to `main` redeploys via **GitHub Pages** automatically. Recommended workflow:

```powershell
git add .
git commit -m "feat: ..."
git push origin main
```

GitHub Pages will pick up the new commit within ~1 minute.

> The first time you go live with new Firestore rules, run the Firebase emulator (`firebase emulators:start`) or push the rules via the Firebase console (**Firestore → Rules → Publish**).

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Pages stay on splash forever | Bad `firebaseConfig` | Re-check `firebase.js`, `login.html`, `signup.html` |
| Everything renders but sign-in fails | Auth method not enabled | Firebase console → Authentication → Sign-in method |
| Firestore writes fail with `permission-denied` | Rules not published | Push `firestore.rules` from the repo to Firebase |
| Photo upload fails | No Storage bucket OR rules block writes | Enable Cloud Storage; or wire Supabase per §4 |
| Voice notes blocked after 10 sends | You're on Free; daily cap reached | Subscribe to Together+ at `/subscription` (mock) |
| Sleep Together does nothing | Free plan; gate fired | Subscribe to Together+ |
| `Cross-Origin Request Blocked` from frontend → backend | `CLIENT_ORIGIN` mismatch | Set `server/.env` `CLIENT_ORIGIN` to match the frontend URL |
| Floating hearts annoying | Browser respects `prefers-reduced-motion` | Set OS-level "reduce motion" — they auto-disable |

---

## 11. Where to look in the code

- **Adding a new page:** create `modules/myPage.js` exporting `renderMyPage(container)` returning a cleanup fn → register in `app.js`'s `pages` map → add a button anywhere with `onclick="loadPage('myPage')"`.
- **Adding a feature gate:** add a key to `PLANS` in `services/subscriptionService.js` → add a `gateXxx()` helper in `services/featureGate.js` → call it from the module before the action.
- **Switching the storage backend:** set `window.__SUPABASE_URL__` + `__SUPABASE_ANON_KEY__` in `app.html`. Done. Remove the script tag to switch back to Firebase.
- **Wiring real AI replies:** define `window.__AI_PROVIDER__ = async (memory, myUid) => string[]` (e.g. an OpenAI proxy). The chat module will use it; the local heuristic stays as fallback.

---

## 12. Reference docs

- `docs/PRODUCT_ROADMAP.md` — vision, plan tiers, P0–P4 backlog.
- `docs/UPGRADE.md` — hard rules + the migration recipe every new module must follow.
- `docs/CLAUDE_OPUS_4_7_PROMPT.md` — full audit checklist used during the rebuild.
- `docs/env.example.txt` — environment variable template.
