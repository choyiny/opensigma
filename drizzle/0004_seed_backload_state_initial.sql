-- Custom SQL migration file, put your code below! --
-- Seeds backload_state rows for every resource declared in
-- AccountListableResource / PerParentResource (except balance_transactions,
-- which is seeded by 0003_seed_balance_transactions_backload.sql).
-- INSERT OR IGNORE keeps this idempotent so it can run safely on a remote
-- DB that already has these rows from prior hand-written seed migrations.
INSERT OR IGNORE INTO backload_state (resource, cursor, status, updated_at) VALUES
  ('customers',                   NULL, 'idle', unixepoch() * 1000),
  ('products',                    NULL, 'idle', unixepoch() * 1000),
  ('prices',                      NULL, 'idle', unixepoch() * 1000),
  ('subscriptions',               NULL, 'idle', unixepoch() * 1000),
  ('invoices',                    NULL, 'idle', unixepoch() * 1000),
  ('charges',                     NULL, 'idle', unixepoch() * 1000),
  ('payment_intents',             NULL, 'idle', unixepoch() * 1000),
  ('refunds',                     NULL, 'idle', unixepoch() * 1000),
  ('disputes',                    NULL, 'idle', unixepoch() * 1000),
  ('payouts',                     NULL, 'idle', unixepoch() * 1000),
  ('credit_notes',                NULL, 'idle', unixepoch() * 1000),
  ('checkout_sessions',           NULL, 'idle', unixepoch() * 1000),
  ('setup_intents',               NULL, 'idle', unixepoch() * 1000),
  ('coupons',                     NULL, 'idle', unixepoch() * 1000),
  ('promotion_codes',             NULL, 'idle', unixepoch() * 1000),
  ('subscription_schedules',      NULL, 'idle', unixepoch() * 1000),
  ('reviews',                     NULL, 'idle', unixepoch() * 1000),
  ('early_fraud_warnings',        NULL, 'idle', unixepoch() * 1000),
  ('payment_methods',             NULL, 'idle', unixepoch() * 1000),
  ('tax_ids',                     NULL, 'idle', unixepoch() * 1000),
  ('credit_note_line_items',      NULL, 'idle', unixepoch() * 1000),
  ('checkout_session_line_items', NULL, 'idle', unixepoch() * 1000),
  ('invoice_line_items',          NULL, 'idle', unixepoch() * 1000);
