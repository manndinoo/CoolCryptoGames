-- Dollar pricing, recorded alongside the SOL amount.
--
-- Items are priced in USD and charged in SOL, so a purchase has two numbers
-- that both matter afterwards: what the item was listed at, and the rate that
-- turned it into lamports. Storing them makes a settled purchase explicable a
-- year later — "0.0043 SOL" alone does not say whether that was the intended
-- dollar or a feed returning nonsense.
--
-- Nullable, because rows written before this migration have neither.

ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS usd_cents INT;
ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS sol_usd_rate NUMERIC(14, 4);

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS usd_cents INT;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS sol_usd_rate NUMERIC(14, 4);

COMMENT ON COLUMN purchase_intents.sol_usd_rate IS
  'SOL/USD at the moment of the quote. The lamport price is derived from it and fixed; this column is the audit trail for how.';
