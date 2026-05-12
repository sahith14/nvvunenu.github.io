-- =====================================================================
-- BondSync — Chat Module Schema (Supabase / Postgres)
-- Run in order. Safe to re-run (uses IF NOT EXISTS).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- COUPLES  (1 active pairing per user enforced via partial unique idx)
-- ---------------------------------------------------------------------
create table if not exists couples (
  id          uuid primary key default gen_random_uuid(),
  user1_id    uuid not null,
  user2_id    uuid not null,
  status      text not null default 'active'
              check (status in ('pending','active','ended')),
  created_at  timestamptz not null default now(),
  constraint  couple_order check (user1_id < user2_id),
  unique (user1_id, user2_id)
);

-- ---------------------------------------------------------------------
-- CONVERSATIONS  (one per couple; future-proofed for group extensions)
-- ---------------------------------------------------------------------
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references couples(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (couple_id)
);

-- Seq counter (monotonic, per-conversation) for deterministic client ordering.
create table if not exists conversation_seq (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  next_seq        bigint not null default 1
);

-- ---------------------------------------------------------------------
-- USER KEYS  (RSA-OAEP-2048 public key; private stays on device)
-- ---------------------------------------------------------------------
create table if not exists user_keys (
  user_id      uuid primary key,
  public_key   text not null,              -- SPKI base64
  key_version  int  not null default 1,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CONVERSATION KEYS  (AES-256-GCM conv key, wrapped per participant)
-- rotated on compromise or device change -> key_version increments.
-- ---------------------------------------------------------------------
create table if not exists conversation_keys (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null,
  key_version     int  not null,
  wrapped_key     text not null,           -- base64(RSA-OAEP(AES key))
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id, key_version)
);

-- ---------------------------------------------------------------------
-- MESSAGES  (server never sees plaintext)
-- ---------------------------------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null,
  client_msg_id   text not null,           -- idempotency key from client
  seq             bigint not null,         -- per-conversation monotonic
  type            text not null default 'text'
                  check (type in ('text','voice','image','system')),
  ciphertext      text not null,           -- base64 AES-GCM ciphertext+tag
  iv              text not null,           -- base64 12-byte IV
  key_version     int  not null default 1,
  reply_to        uuid references messages(id) on delete set null,
  reactions       jsonb not null default '{}'::jsonb,  -- { "🔥": ["uid1"], ... }
  expires_at      timestamptz,             -- PRO: disappearing messages
  scheduled_at    timestamptz,             -- PRO: scheduled send
  delivered_at    timestamptz,
  read_at         timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (conversation_id, client_msg_id),
  unique (conversation_id, seq)
);

create index if not exists messages_conv_seq_idx
  on messages (conversation_id, seq desc);

create index if not exists messages_unread_idx
  on messages (conversation_id, read_at)
  where read_at is null;

-- ---------------------------------------------------------------------
-- OUTBOX  (pending events for offline recipients: read receipts,
-- reactions, typing-ended, etc. Messages themselves don't need this —
-- they're persisted in `messages` and streamed on reconnect.)
-- ---------------------------------------------------------------------
create table if not exists outbox (
  id          bigserial primary key,
  user_id     uuid not null,
  event_type  text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists outbox_user_idx on outbox (user_id, id);

-- ---------------------------------------------------------------------
-- SEQ ALLOCATOR  (atomic next_seq for ordering)
-- ---------------------------------------------------------------------
create or replace function next_message_seq(p_conv uuid)
returns bigint
language plpgsql
as $$
declare
  v_seq bigint;
begin
  insert into conversation_seq (conversation_id, next_seq)
  values (p_conv, 1)
  on conflict (conversation_id) do nothing;

  update conversation_seq
  set next_seq = next_seq + 1
  where conversation_id = p_conv
  returning next_seq - 1 into v_seq;

  return v_seq;
end;
$$;

-- ---------------------------------------------------------------------
-- CRON: purge expired disappearing messages (PRO).
-- Schedule via pg_cron or external worker every 1min.
-- ---------------------------------------------------------------------
-- select cron.schedule('bondsync_purge_expired','* * * * *',
--   $$ update messages set ciphertext='', iv='', deleted_at=now()
--      where expires_at < now() and deleted_at is null $$);
