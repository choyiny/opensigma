import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  test: {
    pool: cloudflarePool({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        d1Databases: ['DB'],
        queueProducers: { BACKLOAD_QUEUE: 'stripe-sync-backload' },
        queueConsumers: ['stripe-sync-backload'],
      },
    }),
  },
});
