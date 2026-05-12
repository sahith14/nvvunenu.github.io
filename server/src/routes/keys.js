// Key exchange endpoints. Server only stores public keys + wrapped AES keys.
// It NEVER sees any private key or AES key plaintext.
import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";
import { assertMember } from "../services/chat.js";

const r = Router();

// PUT /keys/me  { publicKey } -> publish/rotate my RSA public key
r.put("/me", authRequired, async (req, res) => {
  const { publicKey } = req.body || {};
  if (!publicKey) return res.status(400).json({ error: "MISSING_KEY" });

  const cur = await supabase.from("user_keys").select("key_version").eq("user_id", req.user.id).maybeSingle();
  const key_version = (cur.data?.key_version || 0) + 1;

  const { error } = await supabase.from("user_keys").upsert({
    user_id: req.user.id, public_key: publicKey, key_version, updated_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, keyVersion: key_version });
});

// GET /keys/:userId -> fetch partner's RSA public key (for wrapping conv AES key)
r.get("/:userId", authRequired, async (req, res) => {
  const { data, error } = await supabase
    .from("user_keys").select("public_key,key_version,updated_at")
    .eq("user_id", req.params.userId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "NO_KEY" });
  res.json(data);
});

// POST /keys/conversation/:conversationId  { wrappedKeys: [{userId, wrappedKey, keyVersion}] }
// Called by the conversation initiator after generating the AES-256-GCM conv key
// locally and wrapping it with each participant's RSA public key.
r.post("/conversation/:conversationId", authRequired, async (req, res) => {
  const { conversationId } = req.params;
  const { wrappedKeys } = req.body || {};
  if (!Array.isArray(wrappedKeys) || !wrappedKeys.length)
    return res.status(400).json({ error: "MISSING_WRAPPED_KEYS" });

  const m = await assertMember(req.user.id, conversationId);
  if (!m) return res.status(403).json({ error: "FORBIDDEN" });

  const rows = wrappedKeys.map(w => ({
    conversation_id: conversationId,
    user_id:         w.userId,
    key_version:     w.keyVersion || 1,
    wrapped_key:     w.wrappedKey
  }));
  const { error } = await supabase.from("conversation_keys").upsert(rows);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, count: rows.length });
});

// GET /keys/conversation/:conversationId  -> my wrapped AES key for this conv
r.get("/conversation/:conversationId", authRequired, async (req, res) => {
  const { conversationId } = req.params;
  const m = await assertMember(req.user.id, conversationId);
  if (!m) return res.status(403).json({ error: "FORBIDDEN" });

  const { data, error } = await supabase
    .from("conversation_keys")
    .select("key_version,wrapped_key,created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", req.user.id)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "NO_CONV_KEY" });
  res.json(data);
});

export default r;
