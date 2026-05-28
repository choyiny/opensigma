INSERT INTO backload_state (resource, cursor, status, updated_at) VALUES
  ('customers',       NULL, 'idle', unixepoch() * 1000),
  ('products',        NULL, 'idle', unixepoch() * 1000),
  ('prices',          NULL, 'idle', unixepoch() * 1000),
  ('subscriptions',   NULL, 'idle', unixepoch() * 1000),
  ('invoices',        NULL, 'idle', unixepoch() * 1000),
  ('charges',         NULL, 'idle', unixepoch() * 1000),
  ('payment_intents', NULL, 'idle', unixepoch() * 1000),
  ('refunds',         NULL, 'idle', unixepoch() * 1000);
