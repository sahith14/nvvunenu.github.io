// services/aiProvider.js — AI integration plumbing.
// =====================================================================
// One place to read window.__AI_PROVIDER__ and check capability.
// All AI features in the app should go through getAIProvider() so we
// can swap a real LLM/STT in later without touching every call site.
//
// Provider shape (every method optional — capability check is required):
//   {
//     transcribe(audioUrl) -> string                     // STT
//     suggestReplies(messages, count) -> string[]        // smart replies
//     recapWeek(summary)   -> string                     // weekly recap
//     coachAdvice(prompt)  -> string                     // future
//     describeImage(url)   -> string                     // memory captions
//     summarizeChat(messages) -> string                  // future
//   }
//
// Each method is fired with await, so providers may return either a
// plain value or a Promise.
// =====================================================================

/**
 * @returns {object|null}
 */
export function getAIProvider() {
  if (typeof window === "undefined") return null;
  const p = window.__AI_PROVIDER__;
  if (!p || typeof p !== "object") return null;
  return p;
}

/**
 * @param {string} method
 * @returns {boolean}
 */
export function hasAICapability(method) {
  const p = getAIProvider();
  return !!(p && typeof p[method] === "function");
}

/**
 * Calls the provider's method if available; resolves to null otherwise.
 * Errors from the provider are swallowed and return null so callers can
 * always fall back to a friendly placeholder.
 *
 * @param {string} method
 * @param {...any} args
 * @returns {Promise<any|null>}
 */
export async function aiCall(method, ...args) {
  const p = getAIProvider();
  if (!p || typeof p[method] !== "function") return null;
  try {
    return await Promise.resolve(p[method](...args));
  } catch (err) {
    console.warn(`[ai] ${method} failed`, err);
    return null;
  }
}

/**
 * Convenience: returns one of the provider methods bound, falling back
 * to a no-op that returns null. Useful when wiring UI surfaces.
 *
 * @param {string} method
 */
export function aiMethod(method) {
  const p = getAIProvider();
  if (p && typeof p[method] === "function") {
    return (...args) => Promise.resolve(p[method](...args)).catch(() => null);
  }
  return async () => null;
}
