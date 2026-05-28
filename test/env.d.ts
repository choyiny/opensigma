import type { D1Migration } from 'cloudflare:test';

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BACKLOAD_QUEUE: Queue;
    STRIPE_API_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
