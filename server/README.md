# BondSync Server — Real-Time Chat Module

Minimal, production-ready chat system for **BondSync**.
Express + Socket.IO + Supabase (Postgres). E2EE (RSA-OAEP + AES-GCM).
Server is **zero-knowledge**: stores only ciphertext + wrapped keys.

---

## Architecture

```
┌─────────────┐   WSS (Socket.IO)   ┌──────────────┐
│  Web / RN   │◀───────────────────▶│   Node API   │
│   client    │    HTTPS (REST)     │  Express+IO  │
└─────┬───────┘                     └──────┬───────┘
      │ plaintext never leaves device      │
      │ AES key wrapped w/ partner RSA pub │
      ▼                                    ▼
  Keychain / SecureStore              Supabase Postgres
  (private RSA key)                 (ciphertext, iv, keys)
```

Rooms: `conv:<conversationId>`. Presence: in-memory (Redis in Phase 2).

---

## Setup

```bash
cd server
cp .env.example .env     # fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
npm i
# In Supabase SQL editor: paste src/db/schema.sql and run.
npm run dev              # http://localhost:4000
```

Health: `GET /health`.

---

## Database schema (highlights)

- `couples(user1_id, user2_id, status)` — 1 active pair.
- `conversations(couple_id unique)` — 1 per couple.
- `conversation_seq(conversation_id, next_seq)` — monotonic allocator.
- `messages(conversation_id, client_msg_id, seq, ciphertext, iv, key_version, …)`
  unique `(conversation_id, client_msg_id)` and `(conversation_id, seq)`.
- `user_keys(user_id, public_key, key_version)` — RSA-OAEP SPKI.
- `conversation_keys(conversation_id, user_id, key_version, wrapped_key)` — AES-256 wrapped.
- `outbox(user_id, event_type, payload)` — offline event queue.

See `src/db/schema.sql`.

---

## REST API

All routes require `Authorization: Bearer <JWT>`.

| Method | Path                                   | Purpose                                 |
|--------|----------------------------------------|-----------------------------------------|
| GET    | `/health`                              | Liveness                                |
| GET    | `/conversations`                       | List my conversations                   |
| POST   | `/conversations`                       | `{coupleId}` → get/create conv          |
| GET    | `/messages/:convId?before=<seq>&limit` | Paginated history (desc by `seq`)       |
| DELETE | `/messages/:id`                        | Soft-delete own message                 |
| PUT    | `/keys/me`                             | `{publicKey}` publish/rotate RSA pub    |
| GET    | `/keys/:userId`                        | Fetch user's RSA public key             |
| POST   | `/keys/conversation/:convId`           | Upload wrapped AES keys per participant |
| GET    | `/keys/conversation/:convId`           | My wrapped AES key for this conv        |

---

## Socket.IO events

Auth: `io(url, { auth: { token } })`. Server `socketAuth` attaches `socket.data.userId`.

### Client → Server

| Event            | Payload                                                           | Ack                                        |
|------------------|-------------------------------------------------------------------|--------------------------------------------|
| `chat:join`      | `{conversationId, lastSeq}`                                       | `{ok, backlog[], outbox[], partnerOnline}` |
| `chat:leave`     | `{conversationId}`                                                | –                                          |
| `chat:send`      | `{conversationId, clientMsgId, type, ciphertext, iv, keyVersion, replyTo?, expiresAt?, scheduledAt?}` | `{ok, messageId, seq, createdAt, duplicate?}` |
| `chat:typing`    | `{conversationId, isTyping}`                                      | –                                          |
| `chat:delivered` | `{messageId}`                                                     | `{ok}`                                     |
| `chat:read`      | `{conversationId, upToSeq}`                                       | `{ok, count, readAt}`                      |
| `chat:react`     | `{conversationId, messageId, emoji}`                              | `{ok}`                                     |

### Server → Client

| Event            | Payload                                                           |
|------------------|-------------------------------------------------------------------|
| `chat:message`   | full `messages` row                                               |
| `chat:typing`    | `{userId, isTyping}`                                              |
| `chat:delivered` | `{messageId, userId, ts}`                                         |
| `chat:read`      | `{conversationId, readerId, upToSeq, readAt, count}`              |
| `chat:reaction`  | `{messageId, userId, emoji, reactions}`                           |
| `chat:presence`  | `{userId, online}`                                                |

Error ack shape: `{ok:false, error:"RATE_LIMIT"|"FORBIDDEN"|"PRO_REQUIRED"|"BAD_PAYLOAD"|…}`.

---

## E2EE flow (zero-knowledge server)

1. **On signup**: client generates RSA-OAEP-2048 keypair.
   `PUT /keys/me` with base64 SPKI. Private key → device secure storage.
2. **Create conversation**: initiator
   - `GET /keys/:partnerId`
   - generates AES-256-GCM conv key locally
   - wraps conv key with **each** participant's RSA pub key (incl. self)
   - `POST /keys/conversation/:convId` with `wrappedKeys[]`
3. **On open**: client `GET /keys/conversation/:convId` → unwrap with private RSA key → AES key in memory.
4. **Send**: `AES-GCM.encrypt(plaintext)` → `{ciphertext, iv}` → `chat:send`.
5. **Receive**: `AES-GCM.decrypt({ciphertext, iv})` locally. Server has zero plaintext.

Key rotation: re-run step 2 with `keyVersion+1`. Old messages decrypt with their stored `key_version`.

Helpers: `src/client-sdk/e2ee.js`, `src/client-sdk/chatClient.js`.

---

## Edge cases handled

- **Ordering**: server-assigned `seq` via `next_message_seq()` RPC (atomic). Clients sort by `seq`.
- **Idempotency**: `(conversation_id, client_msg_id)` unique. Retries (same id) return the original row — no duplicates.
- **Retries**: client SDK retries `chat:send` 3x with backoff unless error is `FORBIDDEN` / `PRO_REQUIRED`.
- **Offline send**: Socket.IO buffers during disconnect; on reconnect, pending sends flush. Client persists `lastSeq`.
- **Offline receive**:
  - Messages: pulled via backlog on `chat:join` (`seq > lastSeq`).
  - Receipts/reactions: queued in `outbox`, drained on join.
  - Push hint queued when sender is online but recipient is offline.
- **Rate limit**: 30 msgs / 10s per user (configurable). Ack returns `RATE_LIMIT`.
- **Large payloads**: `maxHttpBufferSize: 1 MB`; voice/image ciphertext chunked via signed upload URL (Phase 2).
- **Disappearing / scheduled** (PRO): `expires_at` / `scheduled_at`. Gated by `socket.data.tier==='pro'`. Worker purges / flushes.
- **Multi-device**: presence tracks **any** active socket per user. Every device decrypts independently (each has the same wrapped AES key).
- **Abuse / spam**: soft-delete via `DELETE /messages/:id` (sender-only); future: report route + moderation flag.
- **Partner unpaired**: `assertMember` rejects with `FORBIDDEN`.

---

## Next steps (not in this module)

- Redis adapter for Socket.IO (horizontal scale).
- Push notifications (FCM/APNs) consuming `outbox`.
- Voice note upload pipeline (signed URLs + chunked ciphertext).
- AI routes (`/ai/suggest-reply`, `/ai/date-idea`) with PRO gating.
- Mood, memories, safety, gamification modules.
