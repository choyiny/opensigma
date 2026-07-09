-- Custom SQL migration file, put your code below! --
-- Seeds the pseudo-resource cursor row used by the incremental event-polling
-- backstop. cursor stays NULL until the first poll bootstraps it to the latest
-- Stripe event id. INSERT OR IGNORE keeps this idempotent on re-run.
INSERT OR IGNORE INTO backload_state (resource, cursor, status, updated_at) VALUES
  ('__events__', NULL, 'idle', unixepoch() * 1000);