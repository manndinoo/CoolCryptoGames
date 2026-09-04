-- CoolCryptoGames identity + abuse schema.
--
-- Privacy note: raw IP addresses are never stored. Each IP is kept as a peppered
-- hash (exact match, for bans) plus a truncated display form (/24 for IPv4, /48
-- for IPv6) so an operator can reason about a ban without holding the address.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- identities

CREATE TABLE IF NOT EXISTS wallets (
  address     TEXT PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash TEXT NOT NULL UNIQUE,
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ip_records (
  ip_hash     TEXT PRIMARY KEY,
  prefix_hash TEXT NOT NULL,
  ip_display  TEXT NOT NULL,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ip_records_prefix_idx ON ip_records (prefix_hash);

-- Every (wallet, device, ip) triple ever seen. This is the clustering table:
-- it answers "what else has this device touched" when investigating abuse.
CREATE TABLE IF NOT EXISTS identity_links (
  wallet     TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id)      ON DELETE CASCADE,
  ip_hash    TEXT NOT NULL REFERENCES ip_records(ip_hash) ON DELETE CASCADE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits       BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (wallet, device_id, ip_hash)
);
CREATE INDEX IF NOT EXISTS identity_links_device_idx ON identity_links (device_id);
CREATE INDEX IF NOT EXISTS identity_links_ip_idx     ON identity_links (ip_hash);

-- --------------------------------------------------------------------- bans

DO $$ BEGIN
  CREATE TYPE ban_subject AS ENUM ('wallet', 'device', 'ip', 'ip_prefix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS bans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type ban_subject NOT NULL,
  -- wallet address | device uuid | ip_hash | prefix_hash
  subject_key  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT NOT NULL,
  -- NULL expires_at means permanent. Prefer an expiry for ip/ip_prefix bans:
  -- addresses get reassigned and CGNAT puts thousands of people behind one.
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT
);
CREATE INDEX IF NOT EXISTS bans_active_idx
  ON bans (subject_type, subject_key)
  WHERE revoked_at IS NULL;

-- --------------------------------------------------------------------- auth

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce       TEXT PRIMARY KEY,
  -- Bound at issue time so the server can rebuild the exact signed message
  -- rather than parsing whatever the client hands back.
  address     TEXT NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry_idx ON auth_challenges (expires_at);

-- ------------------------------------------------------------- play sessions

DO $$ BEGIN
  CREATE TYPE play_status AS ENUM ('active', 'submitted', 'rejected', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS play_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet            TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  game_slug         TEXT NOT NULL,
  -- Server-chosen. The client cannot pre-compute a favourable run.
  seed              TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_count   INT NOT NULL DEFAULT 0,
  -- Largest gap between consecutive heartbeats, in ms. A client that goes
  -- offline mid-run leaves the gap here, and the validator reads it.
  max_gap_ms        BIGINT NOT NULL DEFAULT 0,
  ended_at          TIMESTAMPTZ,
  status            play_status NOT NULL DEFAULT 'active',
  device_id         UUID REFERENCES devices(id),
  ip_hash           TEXT
);
CREATE INDEX IF NOT EXISTS play_sessions_wallet_idx ON play_sessions (wallet, started_at DESC);

CREATE TABLE IF NOT EXISTS scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one score per play session, so a submission cannot be replayed.
  play_session_id UUID NOT NULL UNIQUE REFERENCES play_sessions(id) ON DELETE CASCADE,
  wallet          TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  game_slug       TEXT NOT NULL,
  -- Always the server's own replay result, never a client-reported number.
  score           BIGINT NOT NULL,
  duration_ms     BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_leaderboard_idx ON scores (game_slug, score DESC);

-- Rejected submissions are kept: a wallet accumulating these is the signal
-- that drives a ban decision.
CREATE TABLE IF NOT EXISTS submission_rejections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  play_session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  wallet          TEXT NOT NULL,
  game_slug       TEXT NOT NULL,
  reasons         TEXT[] NOT NULL,
  claimed_score   BIGINT,
  computed_score  BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rejections_wallet_idx ON submission_rejections (wallet, created_at DESC);
