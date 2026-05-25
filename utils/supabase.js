// =====================================================================
// utils/supabase.js — Supabase client for STORAGE ONLY.
// Auth + Firestore stay on Firebase.
//
// Configure by setting BEFORE this module loads (e.g. in app.html <head>):
//   window.__SUPABASE_URL__       = "https://YOUR.supabase.co";
//   window.__SUPABASE_ANON_KEY__  = "YOUR_ANON_KEY";
//
// If those globals are missing, this module returns `null` and callers must
// fall back to Firebase Storage (services/storageService.js handles this).
// =====================================================================

let _client = null;
let _initPromise = null;

export const MEDIA_BUCKET =
  (typeof window !== "undefined" && window.__SUPABASE_BUCKET__) || "bondsync-media";

export function isSupabaseConfigured() {
  return Boolean(
    typeof window !== "undefined" &&
    window.__SUPABASE_URL__ &&
    window.__SUPABASE_ANON_KEY__ &&
    /^https:\/\/.+\.supabase\.co$/i.test(window.__SUPABASE_URL__)
  );
}

/**
 * Lazily create the Supabase client. Returns null if not configured.
 * Loads the SDK from CDN only when first needed.
 */
export async function getSupabase() {
  if (_client) return _client;
  if (!isSupabaseConfigured()) return null;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const mod = await import("https://esm.sh/@supabase/supabase-js@2");
      const { createClient } = mod;
      _client = createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, {
        auth: { persistSession: false },
        global: { headers: { "x-nuvvunenu-client": "web" } }
      });
      return _client;
    } catch (e) {
      console.warn("[supabase] failed to init:", e);
      _client = null;
      return null;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}
