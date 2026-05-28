-- Custom SQL migration file, put your code below! --
INSERT INTO backload_state (resource, cursor, status, updated_at)
VALUES ('balance_transactions', NULL, 'idle', unixepoch() * 1000);
