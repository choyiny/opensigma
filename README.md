# stripe-to-workers

Mirrors a Stripe account into a Cloudflare D1 database. Replicates the core behavior of [stripe/sync-engine](https://github.com/stripe/sync-engine) on Workers.

## What it does

- Listens for Stripe webhooks at `POST /webhooks/stripe` and writes the affected row into D1.
- Runs an hourly cron that enqueues backload jobs, processed by a Cloudflare Queue consumer that pages the Stripe API and fills in historical data.
- Out-of-order webhook deliveries are dropped via a per-row `last_event_at` guard.
- No other HTTP endpoints, no UI.

## First-time setup

```bash
pnpm install

# Create the D1 database
wrangler d1 create stripe_sync
# Paste the printed database_id into wrangler.toml

# Create the queues
wrangler queues create stripe-sync-backload
wrangler queues create stripe-sync-dlq

# Set secrets
wrangler secret put STRIPE_API_KEY        # restricted key with read on billing-core
wrangler secret put STRIPE_WEBHOOK_SECRET # from the Stripe webhook endpoint

# Apply migrations
pnpm db:migrate
```

Point your Stripe webhook at `https://<your-worker-subdomain>/webhooks/stripe` and subscribe to the event types listed in `src/webhooks/dispatch.ts`.

## Local dev

```bash
pnpm db:migrate:local
pnpm dev
```

## Backload

The cron handler runs hourly and enqueues a job per resource that isn't `done`. To force a full re-backload:

```bash
pnpm backload:reset
```

The next cron tick will re-fetch from the start. Webhook-updated rows are protected by `last_event_at`.

## Tables

12 tables: `stripe_events`, `backload_state`, plus billing-core resources: `customers`, `products`, `prices`, `subscriptions`, `subscription_items`, `invoices`, `invoice_line_items`, `charges`, `payment_intents`, `refunds`. Each resource mirrors sync-engine's Postgres column set, ported to SQLite.

## Tests

```bash
pnpm test
```

Uses `@cloudflare/vitest-pool-workers` so D1 and Queues are real bindings in tests.
