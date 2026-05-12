import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";

const r = Router();

// GET /conversations  -> list user's conversations
r.get("/", authRequired, async (req, res) => {
  const uid = req.user.id;
  const { data, error } = await supabase
    .from("conversations")
    .select("id, created_at, couple:couples!inner(id,user1_id,user2_id,status)")
    .or(`user1_id.eq.${uid},user2_id.eq.${uid}`, { foreignTable: "couples" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data || [] });
});

// POST /conversations  { coupleId }  -> get or create conv for a couple
r.post("/", authRequired, async (req, res) => {
  const uid = req.user.id;
  const { coupleId } = req.body || {};
  if (!coupleId) return res.status(400).json({ error: "MISSING_COUPLE" });

  const couple = await supabase.from("couples").select("*").eq("id", coupleId).single();
  if (couple.error || !couple.data) return res.status(404).json({ error: "COUPLE_NOT_FOUND" });
  if (uid !== couple.data.user1_id && uid !== couple.data.user2_id)
    return res.status(403).json({ error: "FORBIDDEN" });

  const existing = await supabase.from("conversations").select("*").eq("couple_id", coupleId).maybeSingle();
  if (existing.data) return res.json({ conversation: existing.data });

  const created = await supabase.from("conversations").insert({ couple_id: coupleId }).select("*").single();
  if (created.error) return res.status(500).json({ error: created.error.message });
  res.json({ conversation: created.data });
});

export default r;
