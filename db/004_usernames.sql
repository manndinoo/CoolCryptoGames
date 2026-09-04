-- Usernames.
--
-- The wallet address is a credential, not a public identity. Every public
-- surface joins to this column; none of them may emit `wallets.address`.

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS username_set_at TIMESTAMPTZ;

-- Uniqueness is case-insensitive: "Alice" and "alice" would be two accounts
-- that nobody can tell apart on a leaderboard.
CREATE UNIQUE INDEX IF NOT EXISTS wallets_username_key
  ON wallets (lower(username))
  WHERE username IS NOT NULL;

ALTER TABLE wallets
  ADD CONSTRAINT wallets_username_shape
  CHECK (
    username IS NULL
    OR (length(username) BETWEEN 3 AND 20 AND username ~ '^[a-zA-Z][a-zA-Z0-9_]*$')
  );
