-- Platform secrets.
--
-- Signing keys and hash peppers that must stay stable across every instance and
-- every deploy. Environment variables are still preferred and always win; this
-- table is the fallback so a deployment works the moment it has a database,
-- without a human copying generated values into a dashboard.
--
-- The trade this makes, stated plainly: a secret here shares the blast radius
-- of the database. Anyone who can read this table can forge a session cookie
-- and can recompute the device and network hashes it peppers. Environment
-- variables keep those separate, which is why they take precedence — set them
-- and this table stops being consulted.

CREATE TABLE IF NOT EXISTS platform_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (length(value) >= 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rotating a value here has the same consequence as rotating the environment
-- variable it stands in for: SESSION_SECRET signs every session out, and either
-- pepper invalidates every device or network hash derived from it, dropping the
-- sanctions keyed on them.
COMMENT ON TABLE platform_secrets IS
  'Generated on first use when the matching environment variable is unset. Rotating a row invalidates everything derived from it.';
