# Nuvvu Nenu — Upgrade / Migration Notes

This is the codified migration pattern that every module in this codebase
must follow. It comes from the original BondSync upgrade pass and is kept
as the source of truth for how data flows.

---

## Hard rules (do not violate)

1. **No frameworks.** Vanilla ES modules + plain CSS only.
2. **No `alert()`.** Use `toast()` from `utils/toast.js`.
3. **No inline `getDoc(doc(db, "users", uid))`** in modules. Use
   `state/appState.js` (`getState()`, `onAppState()`, `requireCouple()`).
4. **No base64 in Firestore.** Media uploads must go through
   `services/storageService.js`. Storage backend is swappable
   (Firebase Storage today, Supabase Storage later via `utils/supabase.js`).
5. **Every module exports `init()` returning a cleanup function.** The router
   in `app.js` invokes that cleanup before swapping pages.
6. **Scope every CSS rule.** No global `input{}`, `button{}`, or `video{}`
   selectors — they break other modules. Always nest under a class.
7. **Z-index stack:** `drawers (90) < modals (80→100) < toasts (300) < splash
   (200) < call overlay (150 base, 600 fullscreen)`. Don't fight it.

---

## Data model (canonical)

### `users/{uid}`
```
uid, displayName, username, email, photoURL, avatar?,
relationshipType, togetherSince,
partnerID, partnerRequestFrom?, partnerRequestTo?, matchedAt,
status: { online: bool, lastSeen: ts },
mood?: { emoji, text, updatedAt },
liveLocation?: { lat, lng, updatedAt }
```

### `chats/{coupleId}`
```
members:  [uid1, uid2]
coupleId: "uid1_uid2"
lastMessage, lastMessageTime, lastMessageSender,
unread:  { [uid]: number },
typing:  { [uid]: boolean }
```

### `chats/{coupleId}/messages/{msgId}`
```
text, sender, time(serverTs),
status: "sent" | "delivered" | "seen",
deliveredAt, seenAt,
reactions: { [uid]: emoji },
replyTo?: msgId,
mediaUrl?, mediaPath?, mediaType?
```

### `memories/{coupleId}/entries/{id}`
```
title, description, date, mediaUrl, mediaPath, mediaType,
createdBy, createdAt
```

### `users/{uid}/subscription/plan`
```
plan: "free" | "together_plus" | "forever",
updatedAt,
usage: { "YYYY-MM-DD": { [actionKey]: number } }
```

### `couples/{coupleId}` (couple-scoped meta)
```
bondScore, mood, anniversaryAt, dayCount, lastPokeAt
```

---

## Migration recipe (apply to every new module)

### 1. Identity boilerplate
```js
import { getState, onAppState, requireCouple } from "../state/appState.js";

export function renderFoo(container) {
  const off = onAppState((s) => {
    if (!s.ready) return;
    boot(container, s);
    off();
  });
  return cleanup;
}
```

### 2. Live data (`onSnapshot` + `limit`), not `getDocs`
```js
import { onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
const q = query(col, orderBy("createdAt", "desc"), limit(20));
const unsub = onSnapshot(q, (snap) => render(snap.docs));
return () => unsub();
```

### 3. Media uploads via storageService (NOT base64)
```js
import { uploadMedia, compressImage } from "../services/storageService.js";
const optimized = await compressImage(file);
const { url, path, type } = await uploadMedia(optimized, { folder: `feed/${uid}` });
await addDoc(col, { mediaUrl: url, mediaPath: path, mediaType: type });
```

### 4. Errors via toast, never alert
```js
import { toast, toastError, safe } from "../utils/toast.js";
const ok = await safe(() => doThing(), "Couldn't do thing");
if (ok !== null) toast("Done");
```

### 5. Cleanup contract
```js
function cleanup() {
  unsub?.();
  clearInterval(tickerId);
  controller.abort();
}
```

---

## Firestore optimization checklist

- [ ] DM list uses `onSnapshot` not `getDocs`
- [ ] Message subscription uses `limit(40)` + cursor pagination
- [ ] Delivery / Seen marked in batch (1 commit per snapshot, not per message)
- [ ] Last-message metadata + unread counter on the chat doc (avoid sub-collection scan)
- [ ] Memories: index `(date desc)` (auto-created on first query)
- [ ] All initial loads include `limit(20)` to bound reads

---

## What NOT to refactor without a plan

- `modules/space.js` — large, has many feature surfaces. When trimming, split
  into `space.js` (shell) + `spaceGames.js` (TTT/Connect4/Chess) +
  `spaceEnhance.js` (visual polish) + `cuteFx.js` (hearts/sparkles).
- `services/callService.js` — WebRTC signaling. Don't change ICE order or
  candidate buffering without reading the existing code carefully.
- `firestore.rules` — security rules. Test changes in the Firebase emulator
  before deploying.
