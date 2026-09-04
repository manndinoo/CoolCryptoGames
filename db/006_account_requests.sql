-- Account requests: data export and account deletion.
--
-- Deletion is a request, not a button that runs a DELETE.
--
-- The reason is specific rather than bureaucratic: `identity_links`,
-- `play_sessions` and `scores` all cascade from `wallets`, so a self-serve
-- delete would let a wallet under investigation erase the device and network
-- links that connect it to the rest of its ring. The ban rows themselves
-- survive (they key on text, not a foreign key), but the evidence that would
-- justify the next one does not. So the row below records the ask, a person
-- acts on it, and what was removed is auditable afterwards.
--
-- Export is not gated this way — the export route returns the caller's own
-- data immediately, because reading your own record endangers nobody. The
-- 'data_export' kind exists here only for the case where someone wants a
-- reviewed copy on the record.

DO $$ BEGIN
  CREATE TYPE account_request_kind AS ENUM ('data_export', 'deletion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS account_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet       TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  kind         account_request_kind NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'completed', 'declined')),
  -- What the player said, if anything. Trimmed and length-capped by the route.
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT,
  -- The operator's answer, shown back to the player.
  resolution   TEXT,
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- One open request per kind per wallet. Without this a player can queue a
-- hundred deletion requests and the review queue becomes unusable.
CREATE UNIQUE INDEX IF NOT EXISTS account_requests_one_open_idx
  ON account_requests (wallet, kind)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS account_requests_queue_idx
  ON account_requests (status, created_at);
