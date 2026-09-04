-- Live chat.
--
-- Open, not anonymous: anyone may join and talk, and every message is bound to
-- a wallet identity so it can be muted, timed out or removed. There is no path
-- to post without an identity, which is what makes moderation possible at all.

CREATE TABLE IF NOT EXISTS chat_channels (
  slug        TEXT PRIMARY KEY,
  chat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Minimum gap between one identity's messages, in ms. 0 is off.
  slow_mode_ms INT NOT NULL DEFAULT 0 CHECK (slow_mode_ms >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_slug TEXT NOT NULL,
  wallet       TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 400),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete. A removed message stays as a row so a moderation decision has
  -- an auditable subject; hard-deleting it would erase the evidence for the
  -- action taken against it.
  removed_at   TIMESTAMPTZ,
  removed_by   TEXT,
  removal_reason TEXT
);

-- Reading a channel's recent messages, and counting one identity's recent
-- messages for the rate limit, are the only two hot queries.
CREATE INDEX IF NOT EXISTS chat_messages_channel_idx
  ON chat_messages (channel_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_wallet_recent_idx
  ON chat_messages (wallet, created_at DESC);

-- Chat sanctions are separate from platform bans: muting someone in chat is a
-- much smaller act than barring them from competing, and conflating the two
-- makes the smaller one too expensive to use.
CREATE TABLE IF NOT EXISTS chat_sanctions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet       TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  -- NULL applies everywhere; a slug scopes it to one channel.
  channel_slug TEXT,
  reason       TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A timeout has an expiry; a ban does not. Prefer timeouts.
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chat_sanctions_active_idx
  ON chat_sanctions (wallet) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reported_by TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One report per person per message; repeat clicks are not extra signal.
  UNIQUE (message_id, reported_by)
);
