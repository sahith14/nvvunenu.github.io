// =====================================================================
// services/feedService.js — Public Feed (posts/likes/comments/follow).
//
// Data model:
//   posts/{postId}
//     owner, ownerName, ownerUsername, ownerPhoto
//     text, imageUrl, createdAt
//     likes:        [uid]    — array of UIDs that liked
//     likeCount:    number   — denormalized for sort
//     commentCount: number   — denormalized for cards
//
//   posts/{postId}/comments/{cid}
//     author, authorName, authorPhoto, text, createdAt
//
//   users/{uid}.followers:  [uid]
//   users/{uid}.following:  [uid]
//   users/{uid}.username:   string (lowercase)
//
//   usernames/{lowername} = { uid }    (uniqueness namespace)
// =====================================================================
import {
  collection, doc, query, where, orderBy, limit, startAfter,
  onSnapshot, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  arrayUnion, arrayRemove, increment, serverTimestamp, writeBatch,
  startAt, endAt
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth, storage } from "../firebase.js";

const PAGE = 15;

// =========================================================================
// USERNAME — unique reservation
// =========================================================================
function normalize(uname) { return (uname || "").trim().toLowerCase().replace(/[^a-z0-9_.]/g, ""); }

export async function isUsernameAvailable(uname) {
  const n = normalize(uname);
  if (!n || n.length < 3) return false;
  const snap = await getDoc(doc(db, "usernames", n));
  return !snap.exists();
}

/**
 * Claim a username. Atomically:
 *  - creates /usernames/{n} = { uid }
 *  - deletes the previous /usernames/{old} if any
 *  - updates users/{uid}.username
 */
export async function setUsername(newName) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("NOT_SIGNED_IN");
  const n = normalize(newName);
  if (n.length < 3) throw new Error("USERNAME_TOO_SHORT");

  // Check availability
  const claimRef = doc(db, "usernames", n);
  const existing = await getDoc(claimRef);
  if (existing.exists()) {
    if (existing.data().uid === uid) return n; // already mine, no-op
    throw new Error("USERNAME_TAKEN");
  }

  // Find current username if any, to release after claim
  const userSnap = await getDoc(doc(db, "users", uid));
  const oldName = userSnap.data()?.username;

  const batch = writeBatch(db);
  batch.set(claimRef, { uid, createdAt: serverTimestamp() });
  batch.update(doc(db, "users", uid), { username: n });
  if (oldName && oldName !== n) {
    batch.delete(doc(db, "usernames", oldName));
  }
  await batch.commit();
  return n;
}

/**
 * If the user has no username yet, set one derived from their displayName/email.
 * Idempotent. Called on auth so search works immediately.
 */
export async function ensureUsername(firebaseUser) {
  if (!firebaseUser?.uid) return null;
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  if (data.username) return data.username;

  // Derive a base name
  let base = (firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "user").toLowerCase();
  base = base.replace(/[^a-z0-9_.]/g, "").slice(0, 18) || "user";

  // Try base, base1, base2, ... until we find one free
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}${i}`;
    const claim = doc(db, "usernames", candidate);
    const exists = await getDoc(claim);
    if (!exists.exists()) {
      try {
        const batch = writeBatch(db);
        batch.set(claim, { uid: firebaseUser.uid, createdAt: serverTimestamp() });
        const update = {
          username:    candidate,
          displayName: firebaseUser.displayName || candidate,
          photoURL:    firebaseUser.photoURL || null
        };
        if (snap.exists()) batch.update(ref, update);
        else batch.set(ref, update, { merge: true });
        await batch.commit();
        return candidate;
      } catch {
        // race lost — try next suffix
        continue;
      }
    }
  }
  return null;
}

// =========================================================================
// POSTS — create / delete / detail
// =========================================================================
export async function createPost({ text, file } = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("NOT_SIGNED_IN");
  const cleaned = (text || "").trim();
  if (!cleaned && !file) throw new Error("EMPTY_POST");

  // Pull author meta
  const meSnap = await getDoc(doc(db, "users", uid));
  const me = meSnap.data() || {};

  let imageUrl = null;
  if (file) {
    if (file.size > 5 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
    const { ref, uploadBytes, getDownloadURL } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
    const path = `posts/${uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const r = ref(storage, path);
    await uploadBytes(r, file, { contentType: file.type });
    imageUrl = await getDownloadURL(r);
  }

  const post = {
    owner:         uid,
    ownerName:     me.displayName || "Someone",
    ownerUsername: me.username || null,
    ownerPhoto:    me.photoURL || null,
    text:          cleaned,
    imageUrl,
    createdAt:     serverTimestamp(),
    likes:         [],
    likeCount:     0,
    commentCount:  0
  };
  const ref = await addDoc(collection(db, "posts"), post);
  return ref.id;
}

export async function deletePost(postId) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  await deleteDoc(doc(db, "posts", postId));
}

export async function getPost(postId) {
  const s = await getDoc(doc(db, "posts", postId));
  if (!s.exists()) return null;
  return { id: s.id, ...s.data() };
}

// =========================================================================
// FEED SUBSCRIPTIONS
// =========================================================================
/**
 * Following feed: posts whose owner is in [me] ∪ following.
 * Firestore `in` allows max 30 values, so we cap.
 */
export function subscribeFeed(uid, followingUids, cb) {
  const ids = [uid, ...(followingUids || [])].slice(0, 30);
  const q = query(
    collection(db, "posts"),
    where("owner", "in", ids),
    orderBy("createdAt", "desc"),
    limit(PAGE)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn("[feed] subscribeFeed error", err);
    cb([]);
  });
}

/** Explore: most-recent posts globally. */
export function subscribeExplore(cb) {
  const q = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc"),
    limit(PAGE * 2)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn("[feed] subscribeExplore error", err);
    cb([]);
  });
}

/** Posts by a specific user (for their public profile). */
export function subscribeUserPosts(targetUid, cb) {
  const q = query(
    collection(db, "posts"),
    where("owner", "==", targetUid),
    orderBy("createdAt", "desc"),
    limit(60)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn("[feed] subscribeUserPosts error", err);
    cb([]);
  });
}

// =========================================================================
// LIKES
// =========================================================================
export async function toggleLike(postId) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const ref = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const liked = (snap.data().likes || []).includes(uid);
  await updateDoc(ref, {
    likes:     liked ? arrayRemove(uid) : arrayUnion(uid),
    likeCount: increment(liked ? -1 : 1)
  });
  return !liked;
}

// =========================================================================
// COMMENTS
// =========================================================================
export async function addComment(postId, text) {
  const uid = auth.currentUser?.uid; if (!uid) return;
  const cleaned = (text || "").trim();
  if (!cleaned) return;

  const me = (await getDoc(doc(db, "users", uid))).data() || {};

  const batch = writeBatch(db);
  const cRef = doc(collection(db, "posts", postId, "comments"));
  batch.set(cRef, {
    author:       uid,
    authorName:   me.displayName || "Someone",
    authorPhoto:  me.photoURL || null,
    authorUsername: me.username || null,
    text:         cleaned,
    likes:        [],
    createdAt:    serverTimestamp()
  });
  batch.update(doc(db, "posts", postId), { commentCount: increment(1) });
  await batch.commit();
}

/** Toggle a like on a comment. likes is a uid[] array on the comment doc. */
export async function toggleCommentLike(postId, commentId) {
  const uid = auth.currentUser?.uid;
  if (!uid || !postId || !commentId) return;
  const ref = doc(db, "posts", postId, "comments", commentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const liked = (snap.data().likes || []).includes(uid);
  const { arrayUnion, arrayRemove } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
  await updateDoc(ref, {
    likes: liked ? arrayRemove(uid) : arrayUnion(uid),
  });
}

export function subscribeComments(postId, cb) {
  const q = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc"),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn("[feed] subscribeComments err", err);
    cb([]);
  });
}

// =========================================================================
// FOLLOW / UNFOLLOW
// =========================================================================
export async function follow(targetUid) {
  const uid = auth.currentUser?.uid;
  if (!uid || !targetUid || uid === targetUid) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", uid),         { following: arrayUnion(targetUid), followingCount: increment(1) });
  batch.update(doc(db, "users", targetUid),   { followers: arrayUnion(uid),       followerCount:  increment(1) });
  await batch.commit();
}

export async function unfollow(targetUid) {
  const uid = auth.currentUser?.uid;
  if (!uid || !targetUid) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", uid),         { following: arrayRemove(targetUid), followingCount: increment(-1) });
  batch.update(doc(db, "users", targetUid),   { followers: arrayRemove(uid),       followerCount:  increment(-1) });
  await batch.commit();
}

export async function isFollowing(targetUid) {
  const uid = auth.currentUser?.uid;
  if (!uid || !targetUid) return false;
  const snap = await getDoc(doc(db, "users", uid));
  return (snap.data()?.following || []).includes(targetUid);
}

// =========================================================================
// SEARCH (feed-side wrapper, separate from couple invite-code lookup)
// =========================================================================
export async function searchUsers(prefix, max = 10) {
  const cleaned = (prefix || "").trim().toLowerCase();
  if (!cleaned) return [];
  const q = query(
    collection(db, "users"),
    orderBy("username"),
    startAt(cleaned),
    endAt(cleaned + "\uf8ff"),
    limit(max)
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.username);
  } catch (e) {
    console.warn("[feed] searchUsers", e);
    return [];
  }
}

// =========================================================================
// USER PROFILE LIVE
// =========================================================================
export function subscribeUserDoc(targetUid, cb) {
  if (!targetUid) return () => {};
  return onSnapshot(doc(db, "users", targetUid), (s) => {
    cb(s.exists() ? { uid: s.id, ...s.data() } : null);
  });
}
