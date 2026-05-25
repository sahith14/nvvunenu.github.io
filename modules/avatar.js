// =====================================================================
// modules/avatar.js — Cute initial-based avatars (no third-party services).
// Generates SVG data-URLs with gradient backgrounds + the user's first letter.
// Falls through to a real photoURL when present (and not a "pravatar" URL).
// =====================================================================

const PALETTES = [
  ["#ff8fb1", "#a78bfa"], ["#ffc8d8", "#d8c9ff"],
  ["#a78bfa", "#c8f7e2"], ["#ffd2c1", "#ff8fb1"],
  ["#fff3b0", "#ffd2c1"], ["#c8f7e2", "#a78bfa"],
  ["#ff8fb1", "#ffd2c1"], ["#d8c9ff", "#c8f7e2"],
];

function hashSeed(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickPalette(seed) { return PALETTES[hashSeed(seed) % PALETTES.length]; }

function initialOf(name = "") {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "💜";
  const ch = trimmed.match(/[\p{L}\p{N}]/u)?.[0];
  return (ch || trimmed[0] || "💜").toUpperCase();
}

const cache = new Map();

/**
 * @param {string} seed   stable id (uid or username)
 * @param {string} name   display name (initial taken from this)
 * @param {number} size   pixel size (default 100)
 * @returns {string} data:image/svg+xml URL
 */
export function initialAvatar(seed = "user", name = "", size = 100) {
  const key = `${seed}|${name}|${size}`;
  if (cache.has(key)) return cache.get(key);

  const [c1, c2] = pickPalette(seed);
  const letter   = initialOf(name || seed);
  const gradId   = "g" + (hashSeed(seed) % 1000000);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="50" fill="url(#${gradId})"/>
  <text x="50" y="58" text-anchor="middle"
        font-family="Inter, system-ui, sans-serif"
        font-size="44" font-weight="700" fill="#ffffff"
        style="paint-order:stroke;stroke:rgba(255,255,255,0.25);stroke-width:0.5">${escapeXml(letter)}</text>
</svg>`;

  const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  cache.set(key, dataUrl);
  return dataUrl;
}

/**
 * Fallback chain: real avatar if present (and not pravatar), else SVG initial.
 * @param {object} user - { avatar, photoURL, username, name, uid, id }
 * @param {string} seed - fallback seed if user is missing
 */
export function avatarFor(user = {}, seed = "") {
  const real = user?.avatar || user?.photoURL;
  if (real && typeof real === "string" && !/pravatar/i.test(real)) return real;
  const id      = user?.uid || user?.id || seed || "user";
  const display = user?.username || user?.displayName || user?.name || id;
  return initialAvatar(id, display);
}

function escapeXml(s = "") {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
}

// Globally available so inline templates can use it without importing.
if (typeof window !== "undefined") {
  window.initialAvatar = initialAvatar;
  window.avatarFor     = avatarFor;
}

// No render() — this is a utility-style module loaded once at boot.
export function init() { return () => {}; }
