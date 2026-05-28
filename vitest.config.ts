import path from 'path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(path.join(__dirname, 'drizzle'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        d1Databases: ['DB'],
        queueProducers: { BACKLOAD_QUEUE: 'stripe-sync-backload' },
        queueConsumers: ['stripe-sync-backload'],
        bindings: { TEST_MIGRATIONS: migrations, STRIPE_API_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test' },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
