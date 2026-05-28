# Stripe Sync Engine on Cloudflare Workers + D1

**Status:** Draft
**Date:** 2026-05-27
**Goal:** Replicate the core behavior of [stripe/sync-engine](https://github.com/stripe/sync-engine) — mirror a Stripe account's data into a local relational database — on the Cloudflare Workers stack (Workers + D1 + Queues + Hono + Drizzle), with no UI and no public HTTP surface beyond the Stripe webhook endpoint.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Resource scope | Billing core: `customers`, `products`, `prices`, `subscriptions`, `subscription_items`, `invoices`, `invoice_line_items`, `charges`, `payment_intents`, `refunds` |
| 2 | Backload mechanism | Cloudflare Queue, dispatched by a cron-triggered scheduled handler |
| 3 | Account model | Single Stripe account (no Connect) |
| 4 | Schema shape | Mirror sync-engine columns exactly — every documented Stripe field gets its own typed column |
| 5 | Backload range | Resumable cursor in `backload_state` table; full account by default |
| 6 | Out-of-order handling | Per-row `last_event_at` column; updates no-op when incoming event is older |
| 7 | Webhook processing | Synchronous within the `fetch` handler (no queue between webhook and D1) |
| 8 | ORM / migrations | Drizzle ORM for schema, queries, and migrations (no raw SQL) |

## Architecture

```
                 ┌────────────────────────────┐
   Stripe ──▶    │  fetch():                  │
   webhooks      │   POST /webhooks/stripe    │──┐
                 │   (Hono)                   │  │
                 └────────────────────────────┘  │
                                                 │ write
                 ┌────────────────────────────┐  │
   Cloudflare ──▶│  scheduled(cron):          │  │  ┌──────────┐
   cron          │   enqueue backload jobs    │  ├─▶│  D1 DB   │
                 └────────────────────────────┘  │  └──────────┘
                              │ enqueue            │
                              ▼                    │
                 ┌────────────────────────────┐    │
   Queue ──────▶ │  queue():                  │────┘
                 │   fetch Stripe page,       │
                 │   upsert, advance cursor   │
                 └────────────────────────────┘
```

Three Worker entrypoints, one D1 database, one Cloudflare Queue:

- **`fetch`** — single Hono route `POST /webhooks/stripe`. Verifies signature, inserts into `stripe_events`, dispatches by event type to a per-resource upsert. Synchronous; D1 writes complete in single-digit ms. Any other path returns 404.
- **`scheduled`** — runs hourly. For each backloadable resource, reads `backload_state` and enqueues a "backload next page" job unless that resource's status is `done`.
- **`queue`** — consumes backload jobs. Each message processes one Stripe API page (100 objects) via `stripe.<resource>.list({ starting_after })`, upserts using the same code path the webhook handler uses, updates the cursor, re-enqueues itself if `has_more`.

The webhook handler and the queue consumer share the same `upsert<Resource>` functions, so out-of-order semantics and `last_event_at` behavior are identical regardless of source.

## Database schema

All schema is defined in Drizzle (`src/db/schema.ts`). Migrations are produced with `drizzle-kit generate` and applied with `wrangler d1 migrations apply`.

### Supporting tables

#### `stripe_events`
Raw event log for audit and replay.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Stripe event id (`evt_...`) — natural idempotency key |
| `type` | TEXT NOT NULL | e.g. `customer.updated` |
| `api_version` | TEXT | |
| `request_id` | TEXT | Stripe request id, when present |
| `created` | INTEGER NOT NULL | `event.created` (unix seconds) |
| `payload` | TEXT NOT NULL | JSON of `event.data.object` |
| `received_at` | INTEGER NOT NULL | unix ms, set by the Worker |

Index: `(type, created)` for replay queries.

#### `backload_state`
Per-resource cursor for resumable backfill.

| Column | Type | Notes |
|---|---|---|
| `resource` | TEXT PK | One of: `customers`, `products`, `prices`, `subscriptions`, `invoices`, `charges`, `payment_intents`, `refunds` |
| `cursor` | TEXT NULLABLE | Stripe `starting_after` id; `NULL` means "start from the beginning" or "done" |
| `status` | TEXT NOT NULL | `idle` \| `in_progress` \| `done` |
| `last_synced_at` | INTEGER | unix ms |
| `updated_at` | INTEGER NOT NULL | unix ms |

Seeded by an initial migration with one `(resource, NULL, 'idle', NULL, now)` row per backloadable resource.

`subscription_items` and `invoice_line_items` are not in `backload_state` — they ride along on their parent's page response (`subscriptions.list` returns `items.data` inline; `invoices.list` returns `lines.data` inline).

### Resource tables

Each table mirrors the corresponding Stripe object **column-for-column**. Scalars use TEXT/INTEGER/REAL; nested objects and arrays are stored as TEXT containing JSON. Every table has:

- `id TEXT PRIMARY KEY` — Stripe object id
- `last_event_at INTEGER NOT NULL DEFAULT 0` — `event.created` of the most recent event applied to this row; used as the out-of-order guard

Foreign keys are declared in the Drizzle schema (for documentation and index hinting) but **`PRAGMA foreign_keys` is left off** so out-of-order arrivals don't fail. A `customer.subscription.created` event landing before its `customer.created` must still insert; references can be reconciled later.

| Table | Foreign-key columns | Non-PK indexes |
|---|---|---|
| `customers` | — | `email` |
| `products` | — | — |
| `prices` | `product` | `product` |
| `subscriptions` | `customer` | `customer`, `status` |
| `subscription_items` | `subscription`, `price` | `subscription`, `price` |
| `invoices` | `customer`, `subscription` | `customer`, `subscription`, `status` |
| `invoice_line_items` | `invoice` | `invoice` |
| `charges` | `customer`, `payment_intent`, `invoice` | `customer`, `payment_intent` |
| `payment_intents` | `customer` | `customer` |
| `refunds` | `charge`, `payment_intent` | `charge`, `payment_intent` |

The canonical column list per resource matches sync-engine's published schema. The Drizzle definitions in `src/db/schema.ts` are the source of truth for this project; sync-engine's Postgres DDL is consulted when authoring them.

## Webhook handler

**Endpoint:** `POST /webhooks/stripe` (Hono). No other routes are exposed; any other path returns 404.

### Flow

1. Read the raw body via `c.req.text()` *before* any parsing.
2. Verify signature via `Stripe.webhooks.constructEventAsync(body, signatureHeader, env.STRIPE_WEBHOOK_SECRET)` — the async variant uses Web Crypto and works on Workers; the sync variant requires Node crypto and does not.
3. Insert into `stripe_events` with `INSERT ... ON CONFLICT(id) DO NOTHING`. If a duplicate, return 200 immediately — Stripe occasionally redelivers.
4. Dispatch on `event.type` via a static `Record<EventType, (obj, eventCreated) => Promise<void>>` map → calls the matching `upsert<Resource>`.
5. Return 200.

### Upsert pattern (Drizzle)

Every `upsert<Resource>` does, in pseudocode:

```ts
await db.insert(table).values({ ...row, last_event_at: eventCreated })
  .onConflictDoUpdate({
    target: table.id,
    set: { ...row, last_event_at: eventCreated },
    where: lt(table.last_event_at, eventCreated),
  });
```

The `where` clause on the conflict path is the **out-of-order guard**: a webhook for a stale `event.created` silently no-ops on the update path.

`event.created` (Stripe's timestamp) — never `Date.now()` — is what gets written to `last_event_at`, so the comparison reflects Stripe's view of ordering rather than delivery order.

### Event-type → upsert map

| Event prefix | Target table(s) |
|---|---|
| `customer.created/updated/deleted` | `customers` |
| `product.created/updated/deleted` | `products` |
| `price.created/updated/deleted` | `prices` |
| `customer.subscription.*` | `subscriptions` (+ `subscription_items` from `items.data`) |
| `invoice.*` | `invoices` (+ `invoice_line_items` from `lines.data`) |
| `charge.created/updated/captured/refunded/...` | `charges` |
| `payment_intent.*` | `payment_intents` |
| `charge.refund.updated`, `refund.*` | `refunds` |

Events outside this set are logged to `stripe_events` and otherwise ignored (HTTP 200, no retry incentive for Stripe).

For nested resources, the upsert is two writes in sequence within the same handler invocation — first the parent (`subscriptions`), then each child (`subscription_items`), each using the parent event's `event.created` as `last_event_at`.

### Delete handling

For `*.deleted` events, the row is hard-deleted via `DELETE FROM <table> WHERE id = ? AND last_event_at <= ?`. The condition prevents an out-of-order delete from removing a row a newer event has touched.

## Backload flow

### Cron handler (`scheduled.ts`)

Schedule: `0 * * * *` (hourly). Configurable in `wrangler.toml`.

```
for each resource in BACKLOADABLE_RESOURCES:
    row = SELECT * FROM backload_state WHERE resource = ?
    if row.status === 'done': continue
    queue.send({ resource, cursor: row.cursor })
```

The cron handler does no Stripe API work itself — it only enqueues. This keeps it well under the scheduled-handler CPU budget.

### Queue consumer (`consumer.ts`)

One message = one page. Per message:

1. Read `backload_state[resource]`.
2. If `status === 'done'`, ack and exit (handles a race where the resource finished between enqueue and consume).
3. Set `status = 'in_progress'`.
4. Call `stripe.<resource>.list({ limit: 100, starting_after: cursor ?? undefined })`.
5. For each object in `response.data`: call `upsert<Resource>(obj, /* last_event_at = */ obj.created)`. Backload-sourced rows always use `obj.created` as their `last_event_at`, so any future webhook with a newer `event.created` will win.
6. If `response.has_more`:
   - `UPDATE backload_state SET cursor = <last_id>, status = 'idle', updated_at = now, last_synced_at = now`
   - `queue.send({ resource, cursor: last_id })` to continue
7. Otherwise (final page):
   - `UPDATE backload_state SET cursor = NULL, status = 'done', updated_at = now, last_synced_at = now`

### Queue config (`wrangler.toml`)

- `max_batch_size = 1` — one page per invocation; D1 statement size and Stripe page size give us natural chunking
- `max_concurrency = 1` per consumer — prevents two pages of the same resource from racing on the cursor. Different resources run in parallel because they're independent messages.
- `max_retries = 3`
- Dead-letter queue: `stripe-sync-dlq` — failures are surfaced via Cloudflare Logs and inspected manually; no auto-replay

### Reset from scratch

`pnpm backload:reset` runs:

```
wrangler d1 execute <db-name> --command "UPDATE backload_state SET cursor=NULL, status='idle'"
```

The next cron tick re-fetches the entire account. Rows touched by recent webhooks are protected by `last_event_at`.

## Project layout

```
stripe-to-workers/
├── src/
│   ├── index.ts                   # Worker entrypoint: { fetch, scheduled, queue }
│   ├── app.ts                     # Hono app with the one webhook route
│   ├── env.ts                     # Env binding types (D1, Queue, secrets)
│   ├── stripe.ts                  # Stripe client factory
│   ├── db/
│   │   ├── schema.ts              # Drizzle schema — all 12 tables
│   │   └── client.ts              # drizzle(env.DB) wrapper
│   ├── webhooks/
│   │   ├── handler.ts             # signature verify + dispatch
│   │   └── dispatch.ts            # event.type → upsert function map
│   ├── upserts/
│   │   ├── customers.ts
│   │   ├── products.ts
│   │   ├── prices.ts
│   │   ├── subscriptions.ts       # also handles nested subscription_items
│   │   ├── invoices.ts            # also handles nested invoice_line_items
│   │   ├── charges.ts
│   │   ├── payment_intents.ts
│   │   └── refunds.ts
│   └── backload/
│       ├── scheduled.ts           # cron handler — enqueues jobs
│       └── consumer.ts            # queue handler — pages Stripe, calls upserts
├── drizzle/                       # generated migrations
├── drizzle.config.ts
├── wrangler.toml                  # D1 binding, Queue producer+consumer, cron trigger
├── package.json                   # scripts: dev, deploy, db:generate, db:migrate, backload:reset
├── tsconfig.json
└── README.md
```

### Key code-organization points

- Each `upserts/<resource>.ts` exports one function used by both the webhook dispatcher and the backload consumer — single code path for "write a Stripe object to D1."
- `webhooks/dispatch.ts` is a `Record<event.type, handler>` map. Adding a new event type is one line.
- `src/index.ts` is ≤20 lines: wires the three entrypoints to their handlers and nothing else.
- No `auth/`, no `routes/` beyond webhooks, no client folder. BetterAuth and other project-skeleton scaffolding is dropped.

## Testing strategy

Use `vitest` with `@cloudflare/vitest-pool-workers` — real D1 + real Queue bindings in tests, no mocking of the storage layer. Drizzle migrations are applied to the test D1 instance via the standard pool config.

| Layer | Tests |
|---|---|
| `upserts/<resource>.ts` (each) | (a) insert when row missing; (b) update when incoming `event.created` > stored `last_event_at`; (c) **no-op when incoming is older** (the critical out-of-order guard); (d) delete respects `last_event_at` |
| `webhooks/handler.ts` | (a) valid signature + valid event → row written; (b) invalid signature → 400; (c) duplicate event id → 200, no second write; (d) unknown `event.type` → 200, logged only |
| `backload/consumer.ts` | with the Stripe SDK's `list` mocked: (a) page with `has_more: true` re-enqueues with new cursor; (b) final page sets `status='done'`; (c) backloaded row does **not** clobber a row updated by a more recent webhook event |
| `db/schema.ts` | `drizzle-kit generate` produces no diff after a clean run (catches schema drift between schema definitions and committed migrations) |

`scheduled.ts` gets a single smoke test: invoke the handler, assert N messages enqueued.

Implementation follows `superpowers:test-driven-development` — write the failing test before each upsert/handler.

## Error handling

| Situation | Response | Why |
|---|---|---|
| Invalid Stripe signature | HTTP 400, log | Don't pretend success; Stripe surfaces signature failures in the dashboard |
| Duplicate event id (`stripe_events` PK conflict) | HTTP 200, skip processing | Idempotent — Stripe occasionally redelivers |
| Unknown `event.type` | HTTP 200, log to `stripe_events` only | We only care about billing-core. Returning success prevents Stripe from retrying events we'll never process. |
| Upsert throws (D1 error) | HTTP 500 | Stripe retries with exponential backoff for up to 3 days |
| Backload Stripe API call fails | Throw → queue retry (max 3) → dead-letter queue | Transient errors recover; persistent ones get manual inspection |
| Backload upsert fails | Throw → same retry path | Same |

Every handler logs structured JSON (`{ event_id, type, resource, action, ms }`) via `console.log` — surfaced via `wrangler tail` and Cloudflare Logs.

## Configuration

### Secrets (`wrangler secret put`)
- `STRIPE_API_KEY` — restricted key with read access to billing-core resources
- `STRIPE_WEBHOOK_SECRET` — from the Stripe Dashboard webhook endpoint

### `wrangler.toml` bindings
- `[[d1_databases]]` — production D1 instance, binding `DB`
- `[[queues.producers]]` — binding `BACKLOAD_QUEUE`
- `[[queues.consumers]]` — same queue name; `max_batch_size=1`, `max_concurrency=1`, `max_retries=3`, `dead_letter_queue="stripe-sync-dlq"`
- `[triggers]` `crons = ["0 * * * *"]`

### `package.json` scripts
- `dev` — `wrangler dev`
- `deploy` — `wrangler deploy`
- `db:generate` — `drizzle-kit generate`
- `db:migrate` — `wrangler d1 migrations apply <db-name>`
- `db:migrate:local` — `wrangler d1 migrations apply <db-name> --local`
- `backload:reset` — `wrangler d1 execute <db-name> --command "UPDATE backload_state SET cursor=NULL, status='idle'"`
- `test` — `vitest run`
- `typecheck` — `tsc --noEmit`

## Out of scope

- Querying or exposing data over HTTP (no read endpoints)
- Frontends, dashboards, admin UI
- Stripe Connect / multi-account support
- Resources outside billing-core (e.g. `disputes`, `payouts`, `credit_notes`, `checkout.sessions`, `setup_intents`, `payment_methods`, `coupons`, `promotion_codes`, `tax_ids`, `subscription_schedules`, `reviews`, `early_fraud_warnings`)
- Authentication (no public API surface beyond the Stripe-signed webhook)
- Real-time fan-out to downstream consumers
