import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";
import { assertMember } from "../services/chat.js";

const r = Router();

// GET /messages/:conversationId?before=<seq>&limit=50
// Paginated history (descending seq). Client reverses for display.
r.get("/:conversationId", authRequired, async (req, res) => {
  const { conversationId } = req.params;
  const before = Number(req.query.before || 0);
  const limit  = Math.min(Number(req.query.limit || 50), 200);

  const member = await assertMember(req.user.id, conversationId);
  if (!member) return res.status(403).json({ error: "FORBIDDEN" });

  let q = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("seq", { ascending: false })
    .limit(limit);

  if (before > 0) q = q.lt("seq", before);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data, hasMore: data.length === limit });
});

// DELETE /messages/:id  (soft-delete by sender)
r.delete("/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const msg = await supabase.from("messages").select("sender_id,conversation_id").eq("id", id).single();
  if (msg.error || !msg.data) return res.status(404).json({ error: "NOT_FOUND" });
  if (msg.data.sender_id !== req.user.id) return res.status(403).json({ error: "FORBIDDEN" });

  const { error } = await supabase.from("messages")
    .update({ deleted_at: new Date().toISOString(), ciphertext: "", iv: "" })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default r;
