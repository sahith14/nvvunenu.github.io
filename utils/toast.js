// Non-blocking toast. Replaces every `alert()` call.
// Uses existing #globalToast element from app.html.
const DEFAULT_MS = 2800;

function ensureToastEl() {
  let el = document.getElementById("globalToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "globalToast";
    el.className = "global-toast";
    document.body.appendChild(el);
  }
  return el;
}

export function toast(message, { type = "info", duration = DEFAULT_MS } = {}) {
  const el = ensureToastEl();
  el.textContent = message;
  el.dataset.type = type; // info | success | error | warn
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("show"), duration);
}

export const toastSuccess = (m, o) => toast(m, { ...o, type: "success" });
export const toastError   = (m, o) => toast(m, { ...o, type: "error", duration: 4000 });
export const toastWarn    = (m, o) => toast(m, { ...o, type: "warn" });

// Wrap a promise → toast on error, never throws.
export async function safe(fn, errMsg = "Something went wrong") {
  try { return await fn(); }
  catch (e) { console.error(e); toastError(errMsg); return null; }
}
