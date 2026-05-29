# stripe-to-workers

A **free, open-source replacement for [Stripe Data Pipeline](https://stripe.com/data-pipeline)** that mirrors your Stripe account into a Cloudflare D1 database. Query your own data, build dashboards, run analytics — no extra Stripe fees, no Snowflake/Redshift contract required.

Replicates the core behavior of [stripe/sync-engine](https://github.com/stripe/sync-engine), but runs entirely on Cloudflare Workers + D1 + Queues instead of Postgres + a long-lived server.

## Why

Stripe Data Pipeline starts at **$0.04 per event** and requires a data warehouse you already pay for. If you just want to JOIN your invoices against your customers without paying twice, this gives you:

- Every billing-core object as a queryable SQLite row in D1.
- Webhook-driven updates, so the warehouse stays fresh in seconds.
- A historical backload via the Stripe REST API on a cron.
- Free tier–friendly: D1, Queues, and Workers cover most accounts at $0/mo.

## Architecture

```
                                    ┌──────────────────────────┐
                                    │  Cloudflare Worker       │
   Stripe webhook  ─────────────▶   │  POST /webhooks/stripe   │──┐
                                    └──────────────────────────┘  │
                                                                  │ upsert row
                                    ┌──────────────────────────┐  │ (last_event_at guard)
   Cron (hourly)   ─────────────▶   │  scheduled() handler     │  │
                                    │  enqueues backload jobs  │  ▼
                                    └──────────┬───────────────┘  ┌──────────────┐
                                               │                  │   D1         │
                                               ▼                  │  stripe_sync │
                                    ┌──────────────────────────┐  │              │
                                    │  Queue consumer          │──┤  27 tables   │
                                    │  pages Stripe REST API   │  └──────────────┘
                                    │  with restricted key     │
                                    └──────────────────────────┘
```

- **Webhooks** keep rows fresh in real time. Out-of-order deliveries are dropped via a per-row `last_event_at` guard.
- **Cron + Queue** backfills historical data and retries anything webhooks missed.
- **D1** is the only datastore. Query it from any Worker, or via `wrangler d1 execute`.

## Stripe restricted API key

Create a **read-only restricted key** at [dashboard.stripe.com/apikeys/create?name=stripe-to-workers](https://dashboard.stripe.com/apikeys/create?name=stripe-to-workers).

You want **Read** access on **every resource**, not just Billing Core — this project syncs charges, payouts, balance transactions, disputes, checkout sessions, payment methods, radar, etc. The fastest way:

1. Click **Select all permissions** at the top of the permissions list.
2. Switch the bulk selector from **None** → **Read**.
3. Scroll through and confirm everything is **Read** (leave **Write** unchecked).
4. Create the key and copy the `rk_live_…` (or `rk_test_…`) value.

A read-only key means a compromised Worker can't move money, refund anyone, or mutate your Stripe account — it can only read.

Then set it as a Worker secret:

```bash
wrangler secret put STRIPE_API_KEY
```

## First-time setup

```bash
pnpm install

# Copy the example config (wrangler.jsonc is gitignored)
cp wrangler.jsonc.example wrangler.jsonc

# Create the D1 database
wrangler d1 create stripe_sync
# Paste the printed database_id into wrangler.jsonc

# Create the queues
wrangler queues create stripe-sync-backload
wrangler queues create stripe-sync-dlq

# Set secrets
wrangler secret put STRIPE_API_KEY        # the read-only restricted key from above
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

27 tables in total. Bookkeeping: `stripe_events`, `backload_state`, `backload_parent_progress`. Synced Stripe resources: `customers`, `products`, `prices`, `subscriptions`, `subscription_items`, `subscription_schedules`, `invoices`, `invoice_line_items`, `charges`, `balance_transactions`, `payment_intents`, `payment_methods`, `setup_intents`, `refunds`, `disputes`, `payouts`, `credit_notes`, `credit_note_line_items`, `checkout_sessions`, `checkout_session_line_items`, `coupons`, `promotion_codes`, `tax_ids`, `reviews`, `early_fraud_warnings`. Each resource mirrors sync-engine's Postgres column set, ported to SQLite.

## Querying your data

Once synced, query D1 like any SQLite database:

```bash
wrangler d1 execute stripe_sync --command \
  "SELECT COUNT(*) FROM invoices WHERE status = 'paid' AND created > strftime('%s', '2026-01-01')"
```

Or wire it into a Worker / dashboard / BI tool of your choice. Nothing here phones home to Stripe for analytics — once the data is in D1, it's yours.

### Natural-language queries

This repo ships with a Claude Code skill at [`.claude/skills/stripe-schema-query/`](.claude/skills/stripe-schema-query/SKILL.md) that lets you ask analytics questions in plain English — it reads the Drizzle schema, generates the SQL, runs it through `wrangler`, and renders a table (with an optional chart). Works with any agent that supports skills.

```
/stripe-schema-query top 10 products by revenue last quarter
/stripe-schema-query MRR by month for the last year
/stripe-schema-query churn rate by plan, in-store vs online
```

Bring whichever model you like — Claude, GPT, Gemini, a local model. The skill is just a prompt + workflow, so the AI itself is your choice.

## Tests

```bash
pnpm test
```

Uses `@cloudflare/vitest-pool-workers` so D1 and Queues are real bindings in tests.
