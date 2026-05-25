// =====================================================================
// services/storageService.js — Storage abstraction for ALL media uploads.
//
// Backends, in priority order:
//   1. Supabase Storage   — used when window.__SUPABASE_URL__ + ANON_KEY are set
//   2. Firebase Storage   — fallback (always initialized via firebase.js)
//
// Public API (stable, callers don't care which backend ran):
//   uploadMedia(file, { folder, onProgress })
//      -> { url, path, size, type, backend }
//   removeMedia(path, opts?)
//   compressImage(file, maxDim?, quality?)   // image WebP compressor
// =====================================================================
import { getSupabase, MEDIA_BUCKET, isSupabaseConfigured } from "../utils/supabase.js";
import { storage } from "../firebase.js";
import {
  ref as fsRef, uploadBytesResumable, uploadBytes,
  getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function sanitize(name = "") {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
}
function rand() {
  return crypto.randomUUID?.() || (Date.now() + "_" + Math.random().toString(36).slice(2));
}
function buildPath(folder, file) {
  const base = sanitize(file.name || "file");
  const ext  = (file.name?.split(".").pop() || "bin").toLowerCase();
  // collapse double-extensions when the original has both name.ext and we want a single .ext
  return `${folder}/${Date.now()}_${rand()}_${base}.${ext}`.replace(/\.\w+\.(\w+)$/, ".$1");
}

/**
 * Upload a File/Blob.
 * @param {File|Blob} file
 * @param {object} opts
 * @param {string} opts.folder      e.g. "avatars/<uid>", "memories/<coupleId>"
 * @param {(p:number)=>void} [opts.onProgress]   0..1
 * @returns {Promise<{url:string,path:string,size:number,type:string,backend:"supabase"|"firebase"}>}
 */
export async function uploadMedia(file, { folder, onProgress } = {}) {
  if (!file)            throw new Error("NO_FILE");
  if (!folder)          throw new Error("NO_FOLDER");
  if (file.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");

  const path = buildPath(folder, file);

  // Try Supabase first if configured
  if (isSupabaseConfigured()) {
    const sb = await getSupabase();
    if (sb) {
      onProgress?.(0.05);
      const { error } = await sb.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (!error) {
        onProgress?.(0.9);
        const { data } = sb.storage.from(MEDIA_BUCKET).getPublicUrl(path);
        onProgress?.(1);
        return { url: data.publicUrl, path, size: file.size, type: file.type, backend: "supabase" };
      }
      console.warn("[storageService] Supabase upload failed, falling back to Firebase:", error.message);
      // fall through to Firebase
    }
  }

  // Firebase Storage fallback (resumable for progress)
  onProgress?.(0.05);
  const r = fsRef(storage, path);
  // Use resumable upload to support progress callbacks
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(r, file, { contentType: file.type });
    task.on(
      "state_changed",
      (snap) => {
        if (typeof onProgress === "function" && snap.totalBytes) {
          onProgress(0.05 + 0.85 * (snap.bytesTransferred / snap.totalBytes));
        }
      },
      reject,
      resolve
    );
  });
  const url = await getDownloadURL(r);
  onProgress?.(1);
  return { url, path, size: file.size, type: file.type, backend: "firebase" };
}

/**
 * Best-effort delete. Tries the backend that matches the path's prefix,
 * else attempts both. Errors are swallowed.
 */
export async function removeMedia(path, { backend } = {}) {
  if (!path) return;
  // Supabase (if configured)
  if ((backend === "supabase" || !backend) && isSupabaseConfigured()) {
    try {
      const sb = await getSupabase();
      if (sb) {
        const { error } = await sb.storage.from(MEDIA_BUCKET).remove([path]);
        if (error) console.warn("[storageService] supabase remove:", error.message);
        else if (backend === "supabase") return;
      }
    } catch (e) { console.warn(e); }
  }
  // Firebase
  if (backend === "firebase" || !backend) {
    try { await deleteObject(fsRef(storage, path)); }
    catch (e) { /* not found is fine */ }
  }
}

/**
 * Client-side WebP compression. Non-images pass through.
 * @param {File} file
 * @param {number} maxDim  longest-edge cap
 * @param {number} quality 0..1
 */
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  if (!file?.type?.startsWith("image/")) return file;
  let imgUrl = "";
  try {
    const img = await new Promise((res, rej) => {
      imgUrl = URL.createObjectURL(file);
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = imgUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, "image/webp", quality));
    if (!blob) return file;
    const renamed = (file.name || "image").replace(/\.\w+$/, ".webp");
    return new File([blob], renamed, { type: "image/webp" });
  } catch (e) {
    console.warn("[storageService] compress failed, using original:", e);
    return file;
  } finally {
    if (imgUrl) try { URL.revokeObjectURL(imgUrl); } catch {}
  }
}
