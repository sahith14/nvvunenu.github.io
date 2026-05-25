// =====================================================================
// Memory Service — CRUD for couple timeline.
// Media goes to Supabase Storage; Firestore stores the URL + metadata.
// =====================================================================
import {
  collection, doc, addDoc, deleteDoc, updateDoc, query, orderBy, onSnapshot,
  limit, startAfter, getDocs, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "../firebase.js";
import { uploadMedia, compressImage, removeMedia } from "./storageService.js";

const PAGE = 20;

const path = (coupleId) => collection(db, "memories", coupleId, "entries");

export async function addMemory({ coupleId, title, description, date, file, onProgress }) {
  const uid = auth.currentUser?.uid;
  if (!uid || !coupleId) throw new Error("NO_AUTH_OR_COUPLE");
  if (!title?.trim()) throw new Error("NO_TITLE");

  let media = null;
  if (file) {
    const optimized = await compressImage(file);
    media = await uploadMedia(optimized, {
      folder: `memories/${coupleId}`,
      onProgress
    });
  }

  await addDoc(path(coupleId), {
    title:       title.trim(),
    description: (description || "").trim(),
    date:        date || new Date().toISOString().split("T")[0],
    mediaUrl:    media?.url  || null,
    mediaPath:   media?.path || null,  // for future delete
    mediaType:   media?.type || null,
    createdBy:   uid,
    createdAt:   serverTimestamp()
  });
}

export function subscribeRecent(coupleId, cb, pageSize = PAGE) {
  const q = query(path(coupleId), orderBy("date", "desc"), limit(pageSize));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(rows, snap.docs[snap.docs.length - 1] || null);
  });
}

export async function fetchOlderMemories(coupleId, afterDoc, pageSize = PAGE) {
  if (!afterDoc) return { rows: [], cursor: null };
  const q = query(path(coupleId), orderBy("date", "desc"), startAfter(afterDoc), limit(pageSize));
  const snap = await getDocs(q);
  return {
    rows:   snap.docs.map(d => ({ id: d.id, ...d.data() })),
    cursor: snap.docs[snap.docs.length - 1] || null
  };
}

export async function deleteMemory(coupleId, memory) {
  if (memory.mediaPath) await removeMedia(memory.mediaPath);
  await deleteDoc(doc(db, "memories", coupleId, "entries", memory.id));
}


// =====================================================================
// Toggle favorite for the calling user. Stored as favoriteByUids: [uid].
// Either partner can favorite a shared memory.
// =====================================================================
export async function toggleFavoriteMemory(coupleId, memoryId, isFavoriteNow) {
  const uid = auth.currentUser?.uid;
  if (!uid || !coupleId || !memoryId) return;
  const ref = doc(db, "memories", coupleId, "entries", memoryId);
  await updateDoc(ref, {
    favoriteByUids: isFavoriteNow ? arrayRemove(uid) : arrayUnion(uid),
  });
}
