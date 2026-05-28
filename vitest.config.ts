import path from 'path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(path.join(__dirname, 'drizzle'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        d1Databases: ['DB'],
        queueProducers: { BACKLOAD_QUEUE: 'stripe-sync-backload' },
        queueConsumers: ['stripe-sync-backload'],
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {},
});
