-- Competition entities.
--
-- Deliberately absent, because the founding product excludes them: entry fees,
-- deposits, stakes, player-funded prize pools, purchasable attempts, and random
-- winner selection. There is no column here that could hold an entrant's money.

CREATE TABLE IF NOT EXISTS tournaments (
  slug            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  game_slug       TEXT NOT NULL,
  -- Bound at open time and immutable thereafter.
  game_build_hash TEXT NOT NULL,
  format          TEXT NOT NULL,
  rules_version   TEXT NOT NULL,
  opens_at        TIMESTAMPTZ NOT NULL,
  closes_at       TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'open', 'closed')),
  direction       TEXT NOT NULL CHECK (direction IN ('higher', 'lower')),
  is_demo         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE TABLE IF NOT EXISTS tournament_rules_versions (
  tournament_slug TEXT NOT NULL REFERENCES tournaments(slug) ON DELETE CASCADE,
  version         TEXT NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_model     TEXT NOT NULL,
  tie_breaker     TEXT NOT NULL,
  eligibility     TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (tournament_slug, version)
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_slug TEXT NOT NULL REFERENCES tournaments(slug) ON DELETE CASCADE,
  wallet          TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  -- Which rules version the entrant accepted, and when. Republishing rules
  -- invalidates entries against the old version rather than silently carrying
  -- consent forward to terms nobody agreed to.
  accepted_rules_version TEXT NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One entry per wallet per event.
  UNIQUE (tournament_slug, wallet)
);

-- Prizes exist only as operator-created, operator-approved records. A
-- tournament with no row here has no prize, which is the default state.
CREATE TABLE IF NOT EXISTS prizes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_slug TEXT NOT NULL REFERENCES tournaments(slug) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  -- Funded by CCG or a named sponsor. Never pooled from entrants.
  funded_by       TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  -- Separate person from created_by: approving and creating a prize are
  -- distinct permissions, so one silent action cannot do both.
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE INDEX IF NOT EXISTS tournament_entries_wallet_idx
  ON tournament_entries (wallet, accepted_at DESC);
