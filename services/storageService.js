// =====================================================================
// Storage Service — Supabase Storage for all media (images/video/audio).
// Firestore stores ONLY the public URL + metadata. Never the file.
// =====================================================================
import { supabase, MEDIA_BUCKET } from "../supabase.js";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB default

function sanitize(name) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

function randomId() {
  return (crypto.randomUUID?.() || (Date.now() + "_" + Math.random().toString(36).slice(2)));
}

/**
 * Upload a File/Blob to Supabase Storage.
 * @param {File|Blob} file
 * @param {object}   opts
 * @param {string}   opts.folder   e.g. "memories/<coupleId>", "avatars/<uid>"
 * @param {function} opts.onProgress (0..1) — optional
 * @returns {Promise<{ url:string, path:string, size:number, type:string }>}
 */
export async function uploadMedia(file, { folder, onProgress } = {}) {
  if (!file) throw new Error("NO_FILE");
  if (file.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
  if (!folder) throw new Error("NO_FOLDER");

  const ext  = (file.name?.split(".").pop() || "bin").toLowerCase();
  const path = `${folder}/${Date.now()}_${randomId()}_${sanitize(file.name || "file")}.${ext}`.replace(/\.\w+\.(\w+)$/, ".$1");

  onProgress?.(0.05);
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;

  onProgress?.(0.9);
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  onProgress?.(1);
  return { url: data.publicUrl, path, size: file.size, type: file.type };
}

export async function removeMedia(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) console.warn("storage remove failed", error.message);
}

// Client-side image compression before upload (keeps costs + latency low).
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) return file;
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(img.width  * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, "image/webp", quality));
  URL.revokeObjectURL(img.src);
  return new File([blob], (file.name || "image").replace(/\.\w+$/, ".webp"), { type: "image/webp" });
}
