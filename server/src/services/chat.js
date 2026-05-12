import { supabase } from "../db/supabase.js";

/** Verify user is a member of conversation. Returns couple row or null. */
export async function assertMember(userId, conversationId) {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, couple:couples!inner(user1_id,user2_id)")
    .eq("id", conversationId)
    .single();
  if (error || !data) return null;
  const { user1_id, user2_id } = data.couple;
  if (userId !== user1_id && userId !== user2_id) return null;
  return { conversationId, user1_id, user2_id, partnerId: userId === user1_id ? user2_id : user1_id };
}

/**
 * Insert message idempotently.
 * Returns { message, duplicate:boolean }.
 */
export async function insertMessage({
  conversationId, senderId, clientMsgId, type, ciphertext, iv, keyVersion, replyTo, expiresAt, scheduledAt
}) {
  // Idempotency: check first
  const existing = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("client_msg_id", clientMsgId)
    .maybeSingle();
  if (existing.data) return { message: existing.data, duplicate: true };

  // Allocate seq atomically
  const seqRes = await supabase.rpc("next_message_seq", { p_conv: conversationId });
  if (seqRes.error) throw seqRes.error;
  const seq = seqRes.data;

  const insert = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id:       senderId,
      client_msg_id:   clientMsgId,
      seq,
      type,
      ciphertext,
      iv,
      key_version:     keyVersion ?? 1,
      reply_to:        replyTo || null,
      expires_at:      expiresAt || null,
      scheduled_at:    scheduledAt || null
    })
    .select("*")
    .single();

  if (insert.error) {
    // Concurrent retry: return existing
    if (insert.error.code === "23505") {
      const again = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("client_msg_id", clientMsgId)
        .single();
      return { message: again.data, duplicate: true };
    }
    throw insert.error;
  }
  return { message: insert.data, duplicate: false };
}

/** Backlog since client's lastSeq. Excludes scheduled (future) and soft-deleted. */
export async function backlogSince({ conversationId, lastSeq = 0, limit = 200 }) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
    .gt("seq", lastSeq)
    .order("seq", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Mark delivered for a single message (first time recipient sees it). */
export async function markDelivered(messageId) {
  const { data, error } = await supabase
    .from("messages")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", messageId)
    .is("delivered_at", null)
    .select("id, conversation_id, sender_id, delivered_at")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Mark all messages in conv up to a seq as read (by partner). */
export async function markReadUpTo({ conversationId, readerId, upToSeq }) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages")
    .update({ read_at: now })
    .eq("conversation_id", conversationId)
    .neq("sender_id", readerId)
    .is("read_at", null)
    .lte("seq", upToSeq)
    .select("id");
  if (error) throw error;
  return { count: data?.length || 0, readAt: now };
}

/** Toggle reaction atomically via RPC would be ideal; simple read-modify-write here. */
export async function toggleReaction({ messageId, userId, emoji }) {
  const m = await supabase.from("messages").select("reactions").eq("id", messageId).single();
  if (m.error) throw m.error;
  const reactions = m.data.reactions || {};
  const list = new Set(reactions[emoji] || []);
  list.has(userId) ? list.delete(userId) : list.add(userId);
  if (list.size === 0) delete reactions[emoji];
  else reactions[emoji] = [...list];
  const upd = await supabase.from("messages").update({ reactions }).eq("id", messageId).select("id, reactions").single();
  if (upd.error) throw upd.error;
  return upd.data;
}

/** Queue an event for an offline user. */
export async function enqueueOutbox(userId, eventType, payload) {
  await supabase.from("outbox").insert({ user_id: userId, event_type: eventType, payload });
}

/** Drain and return outbox for user (call on connect). */
export async function drainOutbox(userId) {
  const { data, error } = await supabase
    .from("outbox").select("*").eq("user_id", userId).order("id", { ascending: true }).limit(500);
  if (error) throw error;
  if (data?.length) {
    const ids = data.map(r => r.id);
    await supabase.from("outbox").delete().in("id", ids);
  }
  return data || [];
}
