-- Purchases, entitlements, and wallet-bound game saves.
--
-- Two rules shape every table here.
--
-- No custodial balance. There is no column anywhere that holds a player's SOL.
-- A purchase is a single disclosed transfer from the player's own wallet to the
-- platform treasury, verified on chain after the fact. The platform never holds
-- funds on anyone's behalf and never has an amount to return.
--
-- Nothing purchasable affects competition. The catalogue in lib/store/catalogue.ts
-- carries cosmetic and content items only; there are no lives, attempts, boosts
-- or ranked entries for sale, and `kind` below is constrained so the database
-- refuses to store one.

-- ------------------------------------------------------------------ intents

-- A purchase the player has been quoted but not yet paid for. Created before
-- the wallet is ever asked to sign, so the price and the recipient are fixed by
-- the server and cannot be edited by the client between quote and payment.
CREATE TABLE IF NOT EXISTS purchase_intents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet        TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  game_slug     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  -- Quoted at issue time and never re-read from the client.
  lamports      BIGINT NOT NULL CHECK (lamports > 0),
  treasury      TEXT NOT NULL,
  -- A throwaway public key included in the transfer's account list. It is what
  -- ties one specific on-chain transaction to this one intent, so a single
  -- payment cannot be presented against two different purchases.
  reference     TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  settled_at    TIMESTAMPTZ,
  -- Why a settlement attempt was refused, when one was.
  rejected_reason TEXT
);
CREATE INDEX IF NOT EXISTS purchase_intents_wallet_idx
  ON purchase_intents (wallet, created_at DESC);

-- ------------------------------------------------------------- entitlements

-- What a wallet owns. Bound to the wallet and to one game: an item bought for
-- one game grants nothing in another, and it does not move between wallets.
CREATE TABLE IF NOT EXISTS entitlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet        TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  game_slug     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('cosmetic', 'content')),
  lamports_paid BIGINT NOT NULL CHECK (lamports_paid >= 0),
  -- The on-chain transaction that paid for it. UNIQUE, so one payment can never
  -- be replayed into a second entitlement.
  signature     TEXT NOT NULL UNIQUE,
  intent_id     UUID REFERENCES purchase_intents(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One of each item per wallet per game. Buying twice is not a thing to sell.
  UNIQUE (wallet, game_slug, item_id)
);
CREATE INDEX IF NOT EXISTS entitlements_wallet_idx ON entitlements (wallet, game_slug);

-- --------------------------------------------------------------- game saves

-- Progress, bound to the wallet rather than to the browser.
--
-- One row per wallet per game. The payload is the same shape the sandbox save
-- bridge already validates — a flat map of short strings — and it is capped by
-- the same limits, checked again here rather than trusted from the client.
CREATE TABLE IF NOT EXISTS game_saves (
  wallet      TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  game_slug   TEXT NOT NULL,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Monotonic per (wallet, game). Lets a client detect that another device
  -- has written since it last read, instead of silently overwriting it.
  version     BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, game_slug)
);
