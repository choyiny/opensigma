import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// Apply D1 migrations once before all tests
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS as any);
});
