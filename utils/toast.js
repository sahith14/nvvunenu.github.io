// =====================================================================
// utils/toast.js — non-blocking toast. Replaces every alert() call.
// Uses the existing #toast element from app.html (styled in styles/core.css).
// =====================================================================

const DEFAULT_MS = 2800;
const ERROR_MS   = 4200;

function ensureToastEl() {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{ type?: "info"|"success"|"error"|"warn", duration?: number }} [opts]
 */
export function toast(message, opts = {}) {
  const { type = "info", duration } = opts;
  const el = ensureToastEl();
  el.textContent = message;
  el.dataset.type = type; // styled by [data-type] selectors
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(
    () => el.classList.remove("show"),
    duration ?? (type === "error" ? ERROR_MS : DEFAULT_MS)
  );
}

export const toastSuccess = (m, o) => toast(m, { ...o, type: "success" });
export const toastError   = (m, o) => toast(m, { ...o, type: "error"   });
export const toastWarn    = (m, o) => toast(m, { ...o, type: "warn"    });

/** Wrap a promise → toast on error, never throws. Returns null on failure. */
export async function safe(fn, errMsg = "Something went wrong") {
  try { return await fn(); }
  catch (e) { console.error(e); toastError(errMsg); return null; }
}

// Keep legacy global usage working (app.js + older modules call window.showToast).
if (typeof window !== "undefined") {
  // Don't overwrite if app.js already defined it (it does the same thing).
  if (typeof window.showToast !== "function") {
    window.showToast = (msg, durationMs) => toast(msg, { duration: durationMs });
  }
}
