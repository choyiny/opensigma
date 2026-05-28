/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BACKLOAD_QUEUE: Queue;
      STRIPE_API_KEY: string;
      STRIPE_WEBHOOK_SECRET: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
