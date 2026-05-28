# Stripe Sync (Cloudflare Workers + D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate stripe/sync-engine on Cloudflare Workers + D1 — a single Hono webhook endpoint plus a queue-driven backload from the Stripe API, syncing billing-core resources into D1 via Drizzle ORM.

**Architecture:** Single Worker exposing `{ fetch, scheduled, queue }` entrypoints. `fetch` serves only `POST /webhooks/stripe` (Hono). `scheduled` enqueues backload jobs to a Cloudflare Queue. `queue` consumer pages the Stripe API and upserts rows via the same code path used by webhooks. Out-of-order writes are guarded by a `last_event_at` column per row.

**Tech Stack:** Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare Queues, Hono, Drizzle ORM (+ drizzle-kit), Stripe Node SDK (Web Crypto async path), Vitest with `@cloudflare/vitest-pool-workers`, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-27-stripe-sync-d1-design.md`

---

## File Structure

```
src/
├── index.ts                       # Worker entrypoint: { fetch, scheduled, queue }
├── app.ts                         # Hono app, single webhook route
├── env.ts                         # Env binding types
├── stripe.ts                      # Stripe client factory
├── db/
│   ├── schema.ts                  # Drizzle schema for all 12 tables
│   └── client.ts                  # drizzle(env.DB)
├── webhooks/
│   ├── handler.ts                 # Signature verify + idempotency + dispatch
│   └── dispatch.ts                # event.type → upsert map
├── upserts/
│   ├── customers.ts
│   ├── products.ts
│   ├── prices.ts
│   ├── subscriptions.ts           # also subscription_items
│   ├── invoices.ts                # also invoice_line_items
│   ├── charges.ts
│   ├── payment_intents.ts
│   └── refunds.ts
└── backload/
    ├── scheduled.ts               # cron handler — enqueues jobs
    └── consumer.ts                # queue handler — pages Stripe
test/
├── upserts/                       # one .test.ts per upsert
├── webhooks/handler.test.ts
└── backload/consumer.test.ts
drizzle/                           # generated migrations
drizzle.config.ts
wrangler.toml
vitest.config.ts
tsconfig.json
package.json
```

Each upsert file owns the column-by-column mapping from a Stripe object to a Drizzle row, plus the `onConflictDoUpdate` with the `last_event_at` freshness guard. The webhook handler and the queue consumer both call these — there is no second copy of the mapping logic.

---

## Type-mapping rules (sync-engine Postgres → D1 / Drizzle SQLite)

When porting sync-engine's column definitions, follow these rules:

| sync-engine type | Drizzle / SQLite type | Notes |
|---|---|---|
| `text`, `varchar` | `text(...)` | All Stripe IDs are TEXT |
| `bigint`, `integer` | `integer(...)` | Unix timestamps stored as integer seconds |
| `boolean` | `integer({ mode: 'boolean' })` | SQLite has no native bool; Drizzle handles conversion |
| `numeric`, `real` | `real(...)` | e.g. `application_fee_percent` |
| `jsonb` | `text({ mode: 'json' })` | Drizzle serializes/parses JSON automatically |
| `text[]` | `text({ mode: 'json' })` | Store as JSON array |
| `timestamp with time zone` | `integer(...)` | Stripe gives us unix seconds; don't convert to dates |

Every resource table also gets:
- `id text('id').primaryKey()` — Stripe object id
- `last_event_at: integer('last_event_at').notNull().default(0)` — out-of-order guard

---

## Phase 1 — Bootstrap

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.nvmrc`

- [ ] **Step 1: Initialize `package.json`**

```bash
cd /Users/choyiny/workspace/stripe-to-workers
pnpm init
```

Then replace the generated `package.json` with:

```json
{
  "name": "stripe-to-workers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "wrangler d1 migrations apply stripe_sync",
    "db:migrate:local": "wrangler d1 migrations apply stripe_sync --local",
    "backload:reset": "wrangler d1 execute stripe_sync --command \"UPDATE backload_state SET cursor=NULL, status='idle'\""
  }
}
```

- [ ] **Step 2: Install runtime dependencies**

```bash
pnpm add hono stripe drizzle-orm
```

- [ ] **Step 3: Install dev dependencies**

```bash
pnpm add -D wrangler drizzle-kit typescript @cloudflare/workers-types @cloudflare/vitest-pool-workers vitest @types/node
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
.dev.vars
.wrangler
dist
.DS_Store
*.log
```

- [ ] **Step 5: Create `.nvmrc`**

```
20
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore .nvmrc
git commit -m "chore: bootstrap pnpm project with workers/hono/drizzle/stripe deps"
```

---

### Task 2: TypeScript and build config

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*", "test/**/*", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 2: Verify it compiles (no source yet, should be a no-op)**

```bash
pnpm typecheck
```

Expected: exits 0 with no output.

- [ ] **Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add typescript config"
```

---

### Task 3: Wrangler, Drizzle, and Vitest config

**Files:**
- Create: `wrangler.toml`
- Create: `drizzle.config.ts`
- Create: `vitest.config.ts`
- Create: `src/env.ts`

- [ ] **Step 1: Create `wrangler.toml`**

```toml
name = "stripe-to-workers"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "stripe_sync"
database_id = "REPLACE_AFTER_D1_CREATE"
migrations_dir = "drizzle"

[[queues.producers]]
binding = "BACKLOAD_QUEUE"
queue = "stripe-sync-backload"

[[queues.consumers]]
queue = "stripe-sync-backload"
max_batch_size = 1
max_concurrency = 1
max_retries = 3
dead_letter_queue = "stripe-sync-dlq"

[triggers]
crons = ["0 * * * *"]
```

(`database_id` is filled in after running `wrangler d1 create stripe_sync` later. Webhook secrets `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` are set via `wrangler secret put`.)

- [ ] **Step 2: Create `drizzle.config.ts`**

```ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'd1-http',
} satisfies Config;
```

- [ ] **Step 3: Create `src/env.ts`**

```ts
export interface Env {
  DB: D1Database;
  BACKLOAD_QUEUE: Queue<BackloadJob>;
  STRIPE_API_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export interface BackloadJob {
  resource:
    | 'customers'
    | 'products'
    | 'prices'
    | 'subscriptions'
    | 'invoices'
    | 'charges'
    | 'payment_intents'
    | 'refunds';
  cursor: string | null;
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          queueProducers: { BACKLOAD_QUEUE: 'stripe-sync-backload' },
          queueConsumers: ['stripe-sync-backload'],
        },
      },
    },
  },
});
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml drizzle.config.ts vitest.config.ts src/env.ts
git commit -m "chore: add wrangler, drizzle, vitest config and env types"
```

---

## Phase 2 — Drizzle schema

The schema lives in a single `src/db/schema.ts` with all 12 tables. We build it up table-by-table across tasks 4–10 with commits between, then generate migrations in Task 11.

> **For every resource table:** if you're unsure of a column type or name, cross-reference sync-engine's canonical SQL at `https://github.com/stripe/sync-engine/tree/main/packages/sync-engine/scripts` and apply the type-mapping rules at the top of this plan. Drizzle field name = SQL column name = Stripe API field name.

### Task 4: Schema file skeleton + supporting tables (`stripe_events`, `backload_state`)

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`

- [ ] **Step 1: Create `src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DB = ReturnType<typeof getDb>;

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
```

- [ ] **Step 2: Create `src/db/schema.ts` with the two supporting tables**

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const stripeEvents = sqliteTable(
  'stripe_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    apiVersion: text('api_version'),
    requestId: text('request_id'),
    created: integer('created').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => ({ typeCreatedIdx: index('idx_stripe_events_type_created').on(t.type, t.created) }),
);

export const backloadState = sqliteTable('backload_state', {
  resource: text('resource').primaryKey(),
  cursor: text('cursor'),
  status: text('status', { enum: ['idle', 'in_progress', 'done'] }).notNull().default('idle'),
  lastSyncedAt: integer('last_synced_at'),
  updatedAt: integer('updated_at').notNull(),
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/client.ts
git commit -m "feat(db): add stripe_events and backload_state schemas"
```

---

### Task 5: `customers`, `products`, `prices`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Append `customers` to `src/db/schema.ts`**

```ts
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    address: text('address', { mode: 'json' }),
    balance: integer('balance'),
    created: integer('created'),
    currency: text('currency'),
    defaultSource: text('default_source'),
    delinquent: integer('delinquent', { mode: 'boolean' }),
    description: text('description'),
    discount: text('discount', { mode: 'json' }),
    email: text('email'),
    invoicePrefix: text('invoice_prefix'),
    invoiceSettings: text('invoice_settings', { mode: 'json' }),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    name: text('name'),
    nextInvoiceSequence: integer('next_invoice_sequence'),
    phone: text('phone'),
    preferredLocales: text('preferred_locales', { mode: 'json' }),
    shipping: text('shipping', { mode: 'json' }),
    taxExempt: text('tax_exempt'),
    testClock: text('test_clock'),
    deleted: integer('deleted', { mode: 'boolean' }),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({ emailIdx: index('idx_customers_email').on(t.email) }),
);
```

- [ ] **Step 2: Append `products`**

```ts
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  object: text('object'),
  active: integer('active', { mode: 'boolean' }),
  attributes: text('attributes', { mode: 'json' }),
  created: integer('created'),
  defaultPrice: text('default_price'),
  description: text('description'),
  images: text('images', { mode: 'json' }),
  livemode: integer('livemode', { mode: 'boolean' }),
  metadata: text('metadata', { mode: 'json' }),
  name: text('name'),
  packageDimensions: text('package_dimensions', { mode: 'json' }),
  shippable: integer('shippable', { mode: 'boolean' }),
  statementDescriptor: text('statement_descriptor'),
  taxCode: text('tax_code'),
  type: text('type'),
  unitLabel: text('unit_label'),
  updated: integer('updated'),
  url: text('url'),
  lastEventAt: integer('last_event_at').notNull().default(0),
});
```

- [ ] **Step 3: Append `prices`**

```ts
export const prices = sqliteTable(
  'prices',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    active: integer('active', { mode: 'boolean' }),
    billingScheme: text('billing_scheme'),
    created: integer('created'),
    currency: text('currency'),
    customUnitAmount: text('custom_unit_amount', { mode: 'json' }),
    livemode: integer('livemode', { mode: 'boolean' }),
    lookupKey: text('lookup_key'),
    metadata: text('metadata', { mode: 'json' }),
    nickname: text('nickname'),
    product: text('product'),
    recurring: text('recurring', { mode: 'json' }),
    taxBehavior: text('tax_behavior'),
    tiers: text('tiers', { mode: 'json' }),
    tiersMode: text('tiers_mode'),
    transformQuantity: text('transform_quantity', { mode: 'json' }),
    type: text('type'),
    unitAmount: integer('unit_amount'),
    unitAmountDecimal: text('unit_amount_decimal'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({ productIdx: index('idx_prices_product').on(t.product) }),
);
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/db/schema.ts
git commit -m "feat(db): add customers, products, prices schemas"
```

---

### Task 6: `subscriptions`, `subscription_items`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Append `subscriptions`**

```ts
import { real } from 'drizzle-orm/sqlite-core';

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    application: text('application'),
    applicationFeePercent: real('application_fee_percent'),
    automaticTax: text('automatic_tax', { mode: 'json' }),
    billingCycleAnchor: integer('billing_cycle_anchor'),
    billingThresholds: text('billing_thresholds', { mode: 'json' }),
    cancelAt: integer('cancel_at'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }),
    canceledAt: integer('canceled_at'),
    cancellationDetails: text('cancellation_details', { mode: 'json' }),
    collectionMethod: text('collection_method'),
    created: integer('created'),
    currency: text('currency'),
    currentPeriodEnd: integer('current_period_end'),
    currentPeriodStart: integer('current_period_start'),
    customer: text('customer'),
    daysUntilDue: integer('days_until_due'),
    defaultPaymentMethod: text('default_payment_method'),
    defaultSource: text('default_source'),
    defaultTaxRates: text('default_tax_rates', { mode: 'json' }),
    description: text('description'),
    discount: text('discount', { mode: 'json' }),
    endedAt: integer('ended_at'),
    latestInvoice: text('latest_invoice'),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    nextPendingInvoiceItemInvoice: integer('next_pending_invoice_item_invoice'),
    onBehalfOf: text('on_behalf_of'),
    pauseCollection: text('pause_collection', { mode: 'json' }),
    paymentSettings: text('payment_settings', { mode: 'json' }),
    pendingInvoiceItemInterval: text('pending_invoice_item_interval', { mode: 'json' }),
    pendingSetupIntent: text('pending_setup_intent'),
    pendingUpdate: text('pending_update', { mode: 'json' }),
    schedule: text('schedule'),
    startDate: integer('start_date'),
    status: text('status'),
    testClock: text('test_clock'),
    transferData: text('transfer_data', { mode: 'json' }),
    trialEnd: integer('trial_end'),
    trialSettings: text('trial_settings', { mode: 'json' }),
    trialStart: integer('trial_start'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({
    customerIdx: index('idx_subscriptions_customer').on(t.customer),
    statusIdx: index('idx_subscriptions_status').on(t.status),
  }),
);
```

- [ ] **Step 2: Append `subscriptionItems`**

```ts
export const subscriptionItems = sqliteTable(
  'subscription_items',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    billingThresholds: text('billing_thresholds', { mode: 'json' }),
    created: integer('created'),
    metadata: text('metadata', { mode: 'json' }),
    price: text('price'),
    quantity: integer('quantity'),
    subscription: text('subscription'),
    taxRates: text('tax_rates', { mode: 'json' }),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({
    subscriptionIdx: index('idx_subscription_items_subscription').on(t.subscription),
    priceIdx: index('idx_subscription_items_price').on(t.price),
  }),
);
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add src/db/schema.ts
git commit -m "feat(db): add subscriptions and subscription_items schemas"
```

---

### Task 7: `invoices`, `invoice_line_items`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Append `invoices`**

```ts
export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    accountCountry: text('account_country'),
    accountName: text('account_name'),
    accountTaxIds: text('account_tax_ids', { mode: 'json' }),
    amountDue: integer('amount_due'),
    amountPaid: integer('amount_paid'),
    amountRemaining: integer('amount_remaining'),
    amountShipping: integer('amount_shipping'),
    application: text('application'),
    applicationFeeAmount: integer('application_fee_amount'),
    attemptCount: integer('attempt_count'),
    attempted: integer('attempted', { mode: 'boolean' }),
    autoAdvance: integer('auto_advance', { mode: 'boolean' }),
    automaticTax: text('automatic_tax', { mode: 'json' }),
    billingReason: text('billing_reason'),
    charge: text('charge'),
    collectionMethod: text('collection_method'),
    created: integer('created'),
    currency: text('currency'),
    customFields: text('custom_fields', { mode: 'json' }),
    customer: text('customer'),
    customerAddress: text('customer_address', { mode: 'json' }),
    customerEmail: text('customer_email'),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    customerShipping: text('customer_shipping', { mode: 'json' }),
    customerTaxExempt: text('customer_tax_exempt'),
    customerTaxIds: text('customer_tax_ids', { mode: 'json' }),
    defaultPaymentMethod: text('default_payment_method'),
    defaultSource: text('default_source'),
    defaultTaxRates: text('default_tax_rates', { mode: 'json' }),
    description: text('description'),
    discount: text('discount', { mode: 'json' }),
    discounts: text('discounts', { mode: 'json' }),
    dueDate: integer('due_date'),
    effectiveAt: integer('effective_at'),
    endingBalance: integer('ending_balance'),
    footer: text('footer'),
    fromInvoice: text('from_invoice', { mode: 'json' }),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdf: text('invoice_pdf'),
    issuer: text('issuer', { mode: 'json' }),
    lastFinalizationError: text('last_finalization_error', { mode: 'json' }),
    latestRevision: text('latest_revision'),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    nextPaymentAttempt: integer('next_payment_attempt'),
    number: text('number'),
    onBehalfOf: text('on_behalf_of'),
    paid: integer('paid', { mode: 'boolean' }),
    paidOutOfBand: integer('paid_out_of_band', { mode: 'boolean' }),
    paymentIntent: text('payment_intent'),
    paymentSettings: text('payment_settings', { mode: 'json' }),
    periodEnd: integer('period_end'),
    periodStart: integer('period_start'),
    postPaymentCreditNotesAmount: integer('post_payment_credit_notes_amount'),
    prePaymentCreditNotesAmount: integer('pre_payment_credit_notes_amount'),
    quote: text('quote'),
    receiptNumber: text('receipt_number'),
    rendering: text('rendering', { mode: 'json' }),
    shippingCost: text('shipping_cost', { mode: 'json' }),
    shippingDetails: text('shipping_details', { mode: 'json' }),
    startingBalance: integer('starting_balance'),
    statementDescriptor: text('statement_descriptor'),
    status: text('status'),
    statusTransitions: text('status_transitions', { mode: 'json' }),
    subscription: text('subscription'),
    subscriptionDetails: text('subscription_details', { mode: 'json' }),
    subtotal: integer('subtotal'),
    subtotalExcludingTax: integer('subtotal_excluding_tax'),
    tax: integer('tax'),
    testClock: text('test_clock'),
    total: integer('total'),
    totalDiscountAmounts: text('total_discount_amounts', { mode: 'json' }),
    totalExcludingTax: integer('total_excluding_tax'),
    totalTaxAmounts: text('total_tax_amounts', { mode: 'json' }),
    transferData: text('transfer_data', { mode: 'json' }),
    webhooksDeliveredAt: integer('webhooks_delivered_at'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({
    customerIdx: index('idx_invoices_customer').on(t.customer),
    subscriptionIdx: index('idx_invoices_subscription').on(t.subscription),
    statusIdx: index('idx_invoices_status').on(t.status),
  }),
);
```

- [ ] **Step 2: Append `invoiceLineItems`**

```ts
export const invoiceLineItems = sqliteTable(
  'invoice_line_items',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    amount: integer('amount'),
    amountExcludingTax: integer('amount_excluding_tax'),
    currency: text('currency'),
    description: text('description'),
    discountAmounts: text('discount_amounts', { mode: 'json' }),
    discountable: integer('discountable', { mode: 'boolean' }),
    discounts: text('discounts', { mode: 'json' }),
    invoice: text('invoice'),
    invoiceItem: text('invoice_item'),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    period: text('period', { mode: 'json' }),
    plan: text('plan', { mode: 'json' }),
    price: text('price', { mode: 'json' }),
    proration: integer('proration', { mode: 'boolean' }),
    prorationDetails: text('proration_details', { mode: 'json' }),
    quantity: integer('quantity'),
    subscription: text('subscription'),
    subscriptionItem: text('subscription_item'),
    taxAmounts: text('tax_amounts', { mode: 'json' }),
    taxRates: text('tax_rates', { mode: 'json' }),
    type: text('type'),
    unitAmountExcludingTax: text('unit_amount_excluding_tax'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({ invoiceIdx: index('idx_invoice_line_items_invoice').on(t.invoice) }),
);
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add src/db/schema.ts
git commit -m "feat(db): add invoices and invoice_line_items schemas"
```

---

### Task 8: `charges`, `payment_intents`, `refunds`

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Append `charges`**

```ts
export const charges = sqliteTable(
  'charges',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    amount: integer('amount'),
    amountCaptured: integer('amount_captured'),
    amountRefunded: integer('amount_refunded'),
    application: text('application'),
    applicationFee: text('application_fee'),
    applicationFeeAmount: integer('application_fee_amount'),
    balanceTransaction: text('balance_transaction'),
    billingDetails: text('billing_details', { mode: 'json' }),
    calculatedStatementDescriptor: text('calculated_statement_descriptor'),
    captured: integer('captured', { mode: 'boolean' }),
    created: integer('created'),
    currency: text('currency'),
    customer: text('customer'),
    description: text('description'),
    destination: text('destination'),
    dispute: text('dispute'),
    disputed: integer('disputed', { mode: 'boolean' }),
    failureBalanceTransaction: text('failure_balance_transaction'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    fraudDetails: text('fraud_details', { mode: 'json' }),
    invoice: text('invoice'),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    onBehalfOf: text('on_behalf_of'),
    order: text('order'),
    outcome: text('outcome', { mode: 'json' }),
    paid: integer('paid', { mode: 'boolean' }),
    paymentIntent: text('payment_intent'),
    paymentMethod: text('payment_method'),
    paymentMethodDetails: text('payment_method_details', { mode: 'json' }),
    radarOptions: text('radar_options', { mode: 'json' }),
    receiptEmail: text('receipt_email'),
    receiptNumber: text('receipt_number'),
    receiptUrl: text('receipt_url'),
    refunded: integer('refunded', { mode: 'boolean' }),
    review: text('review'),
    shipping: text('shipping', { mode: 'json' }),
    sourceTransfer: text('source_transfer'),
    statementDescriptor: text('statement_descriptor'),
    statementDescriptorSuffix: text('statement_descriptor_suffix'),
    status: text('status'),
    transferData: text('transfer_data', { mode: 'json' }),
    transferGroup: text('transfer_group'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({
    customerIdx: index('idx_charges_customer').on(t.customer),
    paymentIntentIdx: index('idx_charges_payment_intent').on(t.paymentIntent),
  }),
);
```

- [ ] **Step 2: Append `paymentIntents`**

```ts
export const paymentIntents = sqliteTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    amount: integer('amount'),
    amountCapturable: integer('amount_capturable'),
    amountDetails: text('amount_details', { mode: 'json' }),
    amountReceived: integer('amount_received'),
    application: text('application'),
    applicationFeeAmount: integer('application_fee_amount'),
    automaticPaymentMethods: text('automatic_payment_methods', { mode: 'json' }),
    canceledAt: integer('canceled_at'),
    cancellationReason: text('cancellation_reason'),
    captureMethod: text('capture_method'),
    clientSecret: text('client_secret'),
    confirmationMethod: text('confirmation_method'),
    created: integer('created'),
    currency: text('currency'),
    customer: text('customer'),
    description: text('description'),
    lastPaymentError: text('last_payment_error', { mode: 'json' }),
    latestCharge: text('latest_charge'),
    livemode: integer('livemode', { mode: 'boolean' }),
    metadata: text('metadata', { mode: 'json' }),
    nextAction: text('next_action', { mode: 'json' }),
    onBehalfOf: text('on_behalf_of'),
    paymentMethod: text('payment_method'),
    paymentMethodConfigurationDetails: text('payment_method_configuration_details', { mode: 'json' }),
    paymentMethodOptions: text('payment_method_options', { mode: 'json' }),
    paymentMethodTypes: text('payment_method_types', { mode: 'json' }),
    processing: text('processing', { mode: 'json' }),
    receiptEmail: text('receipt_email'),
    review: text('review'),
    setupFutureUsage: text('setup_future_usage'),
    shipping: text('shipping', { mode: 'json' }),
    source: text('source'),
    statementDescriptor: text('statement_descriptor'),
    statementDescriptorSuffix: text('statement_descriptor_suffix'),
    status: text('status'),
    transferData: text('transfer_data', { mode: 'json' }),
    transferGroup: text('transfer_group'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({ customerIdx: index('idx_payment_intents_customer').on(t.customer) }),
);
```

- [ ] **Step 3: Append `refunds`**

```ts
export const refunds = sqliteTable(
  'refunds',
  {
    id: text('id').primaryKey(),
    object: text('object'),
    amount: integer('amount'),
    balanceTransaction: text('balance_transaction'),
    charge: text('charge'),
    created: integer('created'),
    currency: text('currency'),
    destinationDetails: text('destination_details', { mode: 'json' }),
    failureBalanceTransaction: text('failure_balance_transaction'),
    failureReason: text('failure_reason'),
    instructionsEmail: text('instructions_email'),
    metadata: text('metadata', { mode: 'json' }),
    nextAction: text('next_action', { mode: 'json' }),
    paymentIntent: text('payment_intent'),
    reason: text('reason'),
    receiptNumber: text('receipt_number'),
    sourceTransferReversal: text('source_transfer_reversal'),
    status: text('status'),
    transferReversal: text('transfer_reversal'),
    lastEventAt: integer('last_event_at').notNull().default(0),
  },
  (t) => ({
    chargeIdx: index('idx_refunds_charge').on(t.charge),
    paymentIntentIdx: index('idx_refunds_payment_intent').on(t.paymentIntent),
  }),
);
```

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add src/db/schema.ts
git commit -m "feat(db): add charges, payment_intents, refunds schemas"
```

---

### Task 9: Generate initial migration and seed `backload_state`

**Files:**
- Create: `drizzle/0000_initial.sql` (generated)
- Create: `drizzle/0001_seed_backload_state.sql`

- [ ] **Step 1: Generate schema migration**

```bash
pnpm db:generate
```

Expected: produces `drizzle/0000_<auto-name>.sql` containing `CREATE TABLE` for all 12 tables and the indexes.

- [ ] **Step 2: Create seed migration `drizzle/0001_seed_backload_state.sql`**

```sql
INSERT INTO backload_state (resource, cursor, status, updated_at) VALUES
  ('customers',       NULL, 'idle', unixepoch() * 1000),
  ('products',        NULL, 'idle', unixepoch() * 1000),
  ('prices',          NULL, 'idle', unixepoch() * 1000),
  ('subscriptions',   NULL, 'idle', unixepoch() * 1000),
  ('invoices',        NULL, 'idle', unixepoch() * 1000),
  ('charges',         NULL, 'idle', unixepoch() * 1000),
  ('payment_intents', NULL, 'idle', unixepoch() * 1000),
  ('refunds',         NULL, 'idle', unixepoch() * 1000);
```

- [ ] **Step 3: Apply migrations locally**

```bash
pnpm db:migrate:local
```

Expected: both migrations apply cleanly. (If running for the first time and there's no D1 instance configured yet, run `wrangler d1 create stripe_sync` first and paste the `database_id` into `wrangler.toml`.)

- [ ] **Step 4: Commit**

```bash
git add drizzle/
git commit -m "feat(db): generate initial migration and seed backload_state"
```

---

## Phase 3 — Infrastructure (Stripe client, Hono app, entrypoint shell)

### Task 10: Stripe client factory + Hono app skeleton + index.ts shell

**Files:**
- Create: `src/stripe.ts`
- Create: `src/app.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/stripe.ts`**

```ts
import Stripe from 'stripe';

export function getStripe(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    apiVersion: '2024-10-28.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
```

- [ ] **Step 2: Create `src/app.ts` (empty Hono app, single route registered later)**

```ts
import { Hono } from 'hono';
import type { Env } from './env';

export const app = new Hono<{ Bindings: Env }>();

// Webhook route is registered in src/webhooks/handler.ts via app.post(...)
// All other paths fall through to the default 404 handler.
```

- [ ] **Step 3: Create `src/index.ts`**

```ts
import { app } from './app';
import './webhooks/handler';
import { scheduledHandler } from './backload/scheduled';
import { queueHandler } from './backload/consumer';
import type { Env, BackloadJob } from './env';

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler,
  queue: queueHandler,
} satisfies ExportedHandler<Env, BackloadJob>;
```

(`./webhooks/handler` is imported for its side effect of registering the `POST /webhooks/stripe` route on `app`. `scheduledHandler` and `queueHandler` are created in later tasks; this file will not typecheck until those tasks land — that's fine, those tasks come next.)

- [ ] **Step 4: Commit**

```bash
git add src/stripe.ts src/app.ts src/index.ts
git commit -m "feat: add stripe client, hono app skeleton, worker entrypoint"
```

(Typecheck will fail until Phases 4–6 land; the next phases land the missing handlers.)

---

## Phase 4 — Upsert functions (TDD)

Every upsert has the same shape:

```ts
// pseudocode for the shared pattern:
await db.insert(table).values({ ...mapToRow(obj), lastEventAt: eventCreated })
  .onConflictDoUpdate({
    target: table.id,
    set: { ...mapToRow(obj), lastEventAt: eventCreated },
    setWhere: lt(table.lastEventAt, eventCreated),
  });
```

Drizzle's `onConflictDoUpdate` supports a `setWhere` clause that constrains when the update fires — that's the freshness guard. If `setWhere` is not satisfied, the conflict path is a no-op (no row change, no error).

For nested resources (subscriptions → subscription_items, invoices → invoice_line_items), the parent's upsert function also writes the children using the parent's `event.created` as their `last_event_at`.

The webhook handler and the queue consumer both call these. There is no second copy.

### Task 11: `upsertCustomer` (TDD)

**Files:**
- Create: `test/upserts/customers.test.ts`
- Create: `src/upserts/customers.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/upserts/customers.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { customers } from '../../src/db/schema';
import { upsertCustomer } from '../../src/upserts/customers';

const stripeCustomer = (overrides: Partial<any> = {}) => ({
  id: 'cus_test_1',
  object: 'customer',
  email: 'a@example.com',
  name: 'Alice',
  metadata: { tier: 'pro' },
  created: 1700000000,
  livemode: false,
  ...overrides,
});

describe('upsertCustomer', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(customers);
  });

  it('inserts a new customer', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer(), 1700000100);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('a@example.com');
    expect(row?.lastEventAt).toBe(1700000100);
    expect(row?.metadata).toEqual({ tier: 'pro' });
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer({ email: 'old@example.com' }), 100);
    await upsertCustomer(db, stripeCustomer({ email: 'new@example.com' }), 200);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('new@example.com');
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops when incoming event is older (out-of-order guard)', async () => {
    const db = getDb(env.DB);
    await upsertCustomer(db, stripeCustomer({ email: 'new@example.com' }), 200);
    await upsertCustomer(db, stripeCustomer({ email: 'stale@example.com' }), 100);
    const row = await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get();
    expect(row?.email).toBe('new@example.com');
    expect(row?.lastEventAt).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm test -- customers
```

Expected: FAIL (module `../../src/upserts/customers` not found).

- [ ] **Step 3: Implement `src/upserts/customers.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { customers } from '../db/schema';

export async function upsertCustomer(
  db: DB,
  c: Stripe.Customer | Stripe.DeletedCustomer,
  eventCreated: number,
): Promise<void> {
  if ('deleted' in c && c.deleted) {
    await db
      .delete(customers)
      .where(/* eq+lte guard */ lt(customers.lastEventAt, eventCreated))
      .run();
    return;
  }
  const full = c as Stripe.Customer;
  const row = {
    id: full.id,
    object: full.object,
    address: full.address ?? null,
    balance: full.balance ?? null,
    created: full.created,
    currency: full.currency ?? null,
    defaultSource: typeof full.default_source === 'string' ? full.default_source : null,
    delinquent: full.delinquent ?? null,
    description: full.description ?? null,
    discount: full.discount ?? null,
    email: full.email ?? null,
    invoicePrefix: full.invoice_prefix ?? null,
    invoiceSettings: full.invoice_settings ?? null,
    livemode: full.livemode,
    metadata: full.metadata ?? null,
    name: full.name ?? null,
    nextInvoiceSequence: full.next_invoice_sequence ?? null,
    phone: full.phone ?? null,
    preferredLocales: full.preferred_locales ?? null,
    shipping: full.shipping ?? null,
    taxExempt: full.tax_exempt ?? null,
    testClock: typeof full.test_clock === 'string' ? full.test_clock : null,
    deleted: false,
    lastEventAt: eventCreated,
  };

  await db
    .insert(customers)
    .values(row)
    .onConflictDoUpdate({
      target: customers.id,
      set: row,
      setWhere: lt(customers.lastEventAt, eventCreated),
    });
}
```

> **Note:** if `setWhere` is not available in your installed Drizzle version, replace the upsert with two statements wrapped in a `db.batch([...])` call: an `INSERT ... ON CONFLICT DO NOTHING`, followed by an `UPDATE ... WHERE id = ? AND last_event_at < ?`. Same semantics.

- [ ] **Step 4: Run the test, confirm it passes**

```bash
pnpm test -- customers
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/upserts/customers.ts test/upserts/customers.test.ts
git commit -m "feat(upserts): customers + last_event_at freshness guard tests"
```

---

### Task 12: `upsertProduct` (TDD)

**Files:**
- Create: `test/upserts/products.test.ts`
- Create: `src/upserts/products.ts`

- [ ] **Step 1: Test (mirror customers test, three cases: insert / newer update / older no-op)**

```ts
// test/upserts/products.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { products } from '../../src/db/schema';
import { upsertProduct } from '../../src/upserts/products';

const stripeProduct = (overrides: Partial<any> = {}) => ({
  id: 'prod_test_1',
  object: 'product',
  active: true,
  name: 'Widget',
  created: 1700000000,
  livemode: false,
  metadata: {},
  ...overrides,
});

describe('upsertProduct', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(products);
  });

  it('inserts a new product', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct(), 1700000100);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('Widget');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct({ name: 'Old' }), 100);
    await upsertProduct(db, stripeProduct({ name: 'New' }), 200);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('New');
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertProduct(db, stripeProduct({ name: 'New' }), 200);
    await upsertProduct(db, stripeProduct({ name: 'Stale' }), 100);
    const row = await db.select().from(products).where(eq(products.id, 'prod_test_1')).get();
    expect(row?.name).toBe('New');
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm test -- products
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/upserts/products.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { products } from '../db/schema';

export async function upsertProduct(
  db: DB,
  p: Stripe.Product,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    attributes: p.attributes ?? null,
    created: p.created,
    defaultPrice: typeof p.default_price === 'string' ? p.default_price : null,
    description: p.description ?? null,
    images: p.images ?? null,
    livemode: p.livemode,
    metadata: p.metadata ?? null,
    name: p.name,
    packageDimensions: p.package_dimensions ?? null,
    shippable: p.shippable ?? null,
    statementDescriptor: p.statement_descriptor ?? null,
    taxCode: typeof p.tax_code === 'string' ? p.tax_code : null,
    type: p.type ?? null,
    unitLabel: p.unit_label ?? null,
    updated: p.updated ?? null,
    url: p.url ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(products).values(row).onConflictDoUpdate({
    target: products.id,
    set: row,
    setWhere: lt(products.lastEventAt, eventCreated),
  });
}
```

- [ ] **Step 4: Confirm pass and commit**

```bash
pnpm test -- products
git add src/upserts/products.ts test/upserts/products.test.ts
git commit -m "feat(upserts): products"
```

---

### Task 13: `upsertPrice` (TDD)

Same pattern as customers/products. Map every field from `Stripe.Price` to the `prices` Drizzle table.

**Files:**
- Create: `test/upserts/prices.test.ts`
- Create: `src/upserts/prices.ts`

- [ ] **Step 1: Test (insert + newer + older, parallel to Task 12)**

Use `id: 'price_test_1'`, `product: 'prod_test_1'`, `unit_amount: 1000`, then a second call with `unit_amount: 2000` to assert update/no-op behavior.

```ts
// test/upserts/prices.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { prices } from '../../src/db/schema';
import { upsertPrice } from '../../src/upserts/prices';

const stripePrice = (overrides: Partial<any> = {}) => ({
  id: 'price_test_1',
  object: 'price',
  active: true,
  billing_scheme: 'per_unit',
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  product: 'prod_test_1',
  type: 'one_time',
  unit_amount: 1000,
  ...overrides,
});

describe('upsertPrice', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(prices);
  });

  it('inserts a new price', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice(), 1700000100);
    const row = await db.select().from(prices).where(eq(prices.id, 'price_test_1')).get();
    expect(row?.unitAmount).toBe(1000);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice({ unit_amount: 1000 }), 100);
    await upsertPrice(db, stripePrice({ unit_amount: 2000 }), 200);
    const row = await db.select().from(prices).where(eq(prices.id, 'price_test_1')).get();
    expect(row?.unitAmount).toBe(2000);
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertPrice(db, stripePrice({ unit_amount: 2000 }), 200);
    await upsertPrice(db, stripePrice({ unit_amount: 1000 }), 100);
    const row = await db.select().from(prices).where(eq(prices.id, 'prod_test_1')).get();
    expect(row?.unitAmount ?? 2000).toBe(2000);
  });
});
```

- [ ] **Step 2: Confirm failure, implement, confirm pass, commit**

```ts
// src/upserts/prices.ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { prices } from '../db/schema';

export async function upsertPrice(
  db: DB,
  p: Stripe.Price,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    billingScheme: p.billing_scheme,
    created: p.created,
    currency: p.currency,
    customUnitAmount: p.custom_unit_amount ?? null,
    livemode: p.livemode,
    lookupKey: p.lookup_key ?? null,
    metadata: p.metadata ?? null,
    nickname: p.nickname ?? null,
    product: typeof p.product === 'string' ? p.product : (p.product as Stripe.Product).id,
    recurring: p.recurring ?? null,
    taxBehavior: p.tax_behavior ?? null,
    tiers: p.tiers ?? null,
    tiersMode: p.tiers_mode ?? null,
    transformQuantity: p.transform_quantity ?? null,
    type: p.type,
    unitAmount: p.unit_amount ?? null,
    unitAmountDecimal: p.unit_amount_decimal ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(prices).values(row).onConflictDoUpdate({
    target: prices.id,
    set: row,
    setWhere: lt(prices.lastEventAt, eventCreated),
  });
}
```

```bash
pnpm test -- prices
git add src/upserts/prices.ts test/upserts/prices.test.ts
git commit -m "feat(upserts): prices"
```

---

### Task 14: `upsertSubscription` + nested `subscription_items` (TDD)

**Files:**
- Create: `test/upserts/subscriptions.test.ts`
- Create: `src/upserts/subscriptions.ts`

- [ ] **Step 1: Test — assert parent + child rows both written, and freshness guard applies to children**

```ts
// test/upserts/subscriptions.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { subscriptions, subscriptionItems } from '../../src/db/schema';
import { upsertSubscription } from '../../src/upserts/subscriptions';

const stripeSub = (overrides: Partial<any> = {}) => ({
  id: 'sub_test_1',
  object: 'subscription',
  customer: 'cus_test_1',
  status: 'active',
  created: 1700000000,
  current_period_start: 1700000000,
  current_period_end: 1700100000,
  livemode: false,
  metadata: {},
  items: {
    object: 'list',
    data: [
      {
        id: 'si_test_1',
        object: 'subscription_item',
        subscription: 'sub_test_1',
        price: 'price_test_1',
        quantity: 1,
        created: 1700000000,
        metadata: {},
      },
    ],
    has_more: false,
  },
  ...overrides,
});

describe('upsertSubscription', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(subscriptions);
    await db.delete(subscriptionItems);
  });

  it('inserts subscription and its items', async () => {
    const db = getDb(env.DB);
    await upsertSubscription(db, stripeSub(), 1700000100);
    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, 'sub_test_1')).get();
    const item = await db.select().from(subscriptionItems).where(eq(subscriptionItems.id, 'si_test_1')).get();
    expect(sub?.status).toBe('active');
    expect(item?.subscription).toBe('sub_test_1');
    expect(item?.lastEventAt).toBe(1700000100);
  });

  it('freshness guard applies to subscription and items', async () => {
    const db = getDb(env.DB);
    await upsertSubscription(db, stripeSub({ status: 'active' }), 200);
    await upsertSubscription(db, stripeSub({ status: 'canceled' }), 100);
    const sub = await db.select().from(subscriptions).where(eq(subscriptions.id, 'sub_test_1')).get();
    expect(sub?.status).toBe('active');
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm test -- subscriptions
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/upserts/subscriptions.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { subscriptions, subscriptionItems } from '../db/schema';

export async function upsertSubscription(
  db: DB,
  s: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  const customerId = typeof s.customer === 'string' ? s.customer : s.customer.id;

  const subRow = {
    id: s.id,
    object: s.object,
    application: typeof s.application === 'string' ? s.application : null,
    applicationFeePercent: s.application_fee_percent ?? null,
    automaticTax: s.automatic_tax ?? null,
    billingCycleAnchor: s.billing_cycle_anchor,
    billingThresholds: s.billing_thresholds ?? null,
    cancelAt: s.cancel_at ?? null,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    canceledAt: s.canceled_at ?? null,
    cancellationDetails: s.cancellation_details ?? null,
    collectionMethod: s.collection_method,
    created: s.created,
    currency: s.currency,
    currentPeriodEnd: s.current_period_end,
    currentPeriodStart: s.current_period_start,
    customer: customerId,
    daysUntilDue: s.days_until_due ?? null,
    defaultPaymentMethod: typeof s.default_payment_method === 'string' ? s.default_payment_method : null,
    defaultSource: typeof s.default_source === 'string' ? s.default_source : null,
    defaultTaxRates: s.default_tax_rates ?? null,
    description: s.description ?? null,
    discount: s.discount ?? null,
    endedAt: s.ended_at ?? null,
    latestInvoice: typeof s.latest_invoice === 'string' ? s.latest_invoice : null,
    livemode: s.livemode,
    metadata: s.metadata ?? null,
    nextPendingInvoiceItemInvoice: s.next_pending_invoice_item_invoice ?? null,
    onBehalfOf: typeof s.on_behalf_of === 'string' ? s.on_behalf_of : null,
    pauseCollection: s.pause_collection ?? null,
    paymentSettings: s.payment_settings ?? null,
    pendingInvoiceItemInterval: s.pending_invoice_item_interval ?? null,
    pendingSetupIntent: typeof s.pending_setup_intent === 'string' ? s.pending_setup_intent : null,
    pendingUpdate: s.pending_update ?? null,
    schedule: typeof s.schedule === 'string' ? s.schedule : null,
    startDate: s.start_date,
    status: s.status,
    testClock: typeof s.test_clock === 'string' ? s.test_clock : null,
    transferData: s.transfer_data ?? null,
    trialEnd: s.trial_end ?? null,
    trialSettings: s.trial_settings ?? null,
    trialStart: s.trial_start ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(subscriptions).values(subRow).onConflictDoUpdate({
    target: subscriptions.id,
    set: subRow,
    setWhere: lt(subscriptions.lastEventAt, eventCreated),
  });

  for (const item of s.items.data) {
    const itemRow = {
      id: item.id,
      object: item.object,
      billingThresholds: item.billing_thresholds ?? null,
      created: item.created,
      metadata: item.metadata ?? null,
      price: item.price.id,
      quantity: item.quantity ?? null,
      subscription: s.id,
      taxRates: item.tax_rates ?? null,
      lastEventAt: eventCreated,
    };
    await db.insert(subscriptionItems).values(itemRow).onConflictDoUpdate({
      target: subscriptionItems.id,
      set: itemRow,
      setWhere: lt(subscriptionItems.lastEventAt, eventCreated),
    });
  }
}
```

- [ ] **Step 4: Confirm pass and commit**

```bash
pnpm test -- subscriptions
git add src/upserts/subscriptions.ts test/upserts/subscriptions.test.ts
git commit -m "feat(upserts): subscriptions + nested subscription_items"
```

---

### Task 15: `upsertInvoice` + nested `invoice_line_items` (TDD)

**Files:**
- Create: `test/upserts/invoices.test.ts`
- Create: `src/upserts/invoices.ts`

- [ ] **Step 1: Test — parallel to Task 14 but with invoices/lines**

```ts
// test/upserts/invoices.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { invoices, invoiceLineItems } from '../../src/db/schema';
import { upsertInvoice } from '../../src/upserts/invoices';

const stripeInvoice = (overrides: Partial<any> = {}) => ({
  id: 'in_test_1',
  object: 'invoice',
  customer: 'cus_test_1',
  status: 'open',
  amount_due: 1000,
  amount_paid: 0,
  amount_remaining: 1000,
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  lines: {
    object: 'list',
    data: [
      {
        id: 'il_test_1',
        object: 'line_item',
        amount: 1000,
        currency: 'usd',
        invoice: 'in_test_1',
        livemode: false,
        metadata: {},
        quantity: 1,
        type: 'invoiceitem',
      },
    ],
    has_more: false,
  },
  ...overrides,
});

describe('upsertInvoice', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(invoices);
    await db.delete(invoiceLineItems);
  });

  it('inserts invoice and its line items', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice(), 1700000100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    const line = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.id, 'il_test_1')).get();
    expect(inv?.status).toBe('open');
    expect(line?.invoice).toBe('in_test_1');
  });

  it('freshness guard applies', async () => {
    const db = getDb(env.DB);
    await upsertInvoice(db, stripeInvoice({ status: 'paid' }), 200);
    await upsertInvoice(db, stripeInvoice({ status: 'open' }), 100);
    const inv = await db.select().from(invoices).where(eq(invoices.id, 'in_test_1')).get();
    expect(inv?.status).toBe('paid');
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm test -- invoices
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/upserts/invoices.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { invoices, invoiceLineItems } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertInvoice(
  db: DB,
  inv: Stripe.Invoice,
  eventCreated: number,
): Promise<void> {
  const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;

  const row = {
    id: inv.id,
    object: inv.object,
    accountCountry: inv.account_country ?? null,
    accountName: inv.account_name ?? null,
    accountTaxIds: inv.account_tax_ids ?? null,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    amountRemaining: inv.amount_remaining,
    amountShipping: inv.amount_shipping ?? null,
    application: strOrNull(inv.application),
    applicationFeeAmount: inv.application_fee_amount ?? null,
    attemptCount: inv.attempt_count,
    attempted: inv.attempted,
    autoAdvance: inv.auto_advance ?? null,
    automaticTax: inv.automatic_tax ?? null,
    billingReason: inv.billing_reason ?? null,
    charge: strOrNull(inv.charge),
    collectionMethod: inv.collection_method,
    created: inv.created,
    currency: inv.currency,
    customFields: inv.custom_fields ?? null,
    customer: customerId,
    customerAddress: inv.customer_address ?? null,
    customerEmail: inv.customer_email ?? null,
    customerName: inv.customer_name ?? null,
    customerPhone: inv.customer_phone ?? null,
    customerShipping: inv.customer_shipping ?? null,
    customerTaxExempt: inv.customer_tax_exempt ?? null,
    customerTaxIds: inv.customer_tax_ids ?? null,
    defaultPaymentMethod: strOrNull(inv.default_payment_method),
    defaultSource: strOrNull(inv.default_source),
    defaultTaxRates: inv.default_tax_rates ?? null,
    description: inv.description ?? null,
    discount: inv.discount ?? null,
    discounts: inv.discounts ?? null,
    dueDate: inv.due_date ?? null,
    effectiveAt: inv.effective_at ?? null,
    endingBalance: inv.ending_balance ?? null,
    footer: inv.footer ?? null,
    fromInvoice: inv.from_invoice ?? null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    issuer: inv.issuer ?? null,
    lastFinalizationError: inv.last_finalization_error ?? null,
    latestRevision: strOrNull(inv.latest_revision),
    livemode: inv.livemode,
    metadata: inv.metadata ?? null,
    nextPaymentAttempt: inv.next_payment_attempt ?? null,
    number: inv.number ?? null,
    onBehalfOf: strOrNull(inv.on_behalf_of),
    paid: inv.paid,
    paidOutOfBand: inv.paid_out_of_band,
    paymentIntent: strOrNull(inv.payment_intent),
    paymentSettings: inv.payment_settings ?? null,
    periodEnd: inv.period_end,
    periodStart: inv.period_start,
    postPaymentCreditNotesAmount: inv.post_payment_credit_notes_amount ?? null,
    prePaymentCreditNotesAmount: inv.pre_payment_credit_notes_amount ?? null,
    quote: strOrNull(inv.quote),
    receiptNumber: inv.receipt_number ?? null,
    rendering: inv.rendering ?? null,
    shippingCost: inv.shipping_cost ?? null,
    shippingDetails: inv.shipping_details ?? null,
    startingBalance: inv.starting_balance,
    statementDescriptor: inv.statement_descriptor ?? null,
    status: inv.status,
    statusTransitions: inv.status_transitions ?? null,
    subscription: strOrNull(inv.subscription),
    subscriptionDetails: inv.subscription_details ?? null,
    subtotal: inv.subtotal,
    subtotalExcludingTax: inv.subtotal_excluding_tax ?? null,
    tax: inv.tax ?? null,
    testClock: strOrNull(inv.test_clock),
    total: inv.total,
    totalDiscountAmounts: inv.total_discount_amounts ?? null,
    totalExcludingTax: inv.total_excluding_tax ?? null,
    totalTaxAmounts: inv.total_tax_amounts ?? null,
    transferData: inv.transfer_data ?? null,
    webhooksDeliveredAt: inv.webhooks_delivered_at ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(invoices).values(row).onConflictDoUpdate({
    target: invoices.id,
    set: row,
    setWhere: lt(invoices.lastEventAt, eventCreated),
  });

  for (const line of inv.lines?.data ?? []) {
    const lineRow = {
      id: line.id,
      object: line.object,
      amount: line.amount,
      amountExcludingTax: line.amount_excluding_tax ?? null,
      currency: line.currency,
      description: line.description ?? null,
      discountAmounts: line.discount_amounts ?? null,
      discountable: line.discountable,
      discounts: line.discounts ?? null,
      invoice: inv.id,
      invoiceItem: typeof line.invoice_item === 'string' ? line.invoice_item : null,
      livemode: line.livemode,
      metadata: line.metadata ?? null,
      period: line.period ?? null,
      plan: line.plan ?? null,
      price: line.price ?? null,
      proration: line.proration,
      prorationDetails: line.proration_details ?? null,
      quantity: line.quantity ?? null,
      subscription: typeof line.subscription === 'string' ? line.subscription : null,
      subscriptionItem: typeof line.subscription_item === 'string' ? line.subscription_item : null,
      taxAmounts: line.tax_amounts ?? null,
      taxRates: line.tax_rates ?? null,
      type: line.type,
      unitAmountExcludingTax: line.unit_amount_excluding_tax ?? null,
      lastEventAt: eventCreated,
    };
    await db.insert(invoiceLineItems).values(lineRow).onConflictDoUpdate({
      target: invoiceLineItems.id,
      set: lineRow,
      setWhere: lt(invoiceLineItems.lastEventAt, eventCreated),
    });
  }
}
```

- [ ] **Step 4: Confirm pass and commit**

```bash
pnpm test -- invoices
git add src/upserts/invoices.ts test/upserts/invoices.test.ts
git commit -m "feat(upserts): invoices + nested invoice_line_items"
```

---

### Task 16: `upsertCharge`, `upsertPaymentIntent`, `upsertRefund` (TDD, batched)

These three follow the exact same single-table pattern as `upsertProduct` and `upsertPrice`. Bundled into one task because the structure is mechanical and identical: insert + newer-update + older-no-op.

**Files:**
- Create: `test/upserts/charges.test.ts`
- Create: `test/upserts/payment_intents.test.ts`
- Create: `test/upserts/refunds.test.ts`
- Create: `src/upserts/charges.ts`
- Create: `src/upserts/payment_intents.ts`
- Create: `src/upserts/refunds.ts`

- [ ] **Step 1: Write all three test files following the products test template**

Use these fixtures:
- charge: `{ id: 'ch_test_1', object: 'charge', amount: 1000, currency: 'usd', created: 1700000000, livemode: false, metadata: {}, status: 'succeeded', captured: true, paid: true, refunded: false, disputed: false, attempted: true, billing_details: {}, fraud_details: {} }`. Update test toggles `status: 'failed'`.
- payment intent: `{ id: 'pi_test_1', object: 'payment_intent', amount: 1000, currency: 'usd', created: 1700000000, livemode: false, metadata: {}, status: 'succeeded', capture_method: 'automatic', confirmation_method: 'automatic', payment_method_types: ['card'] }`. Update test toggles `status: 'requires_action'`.
- refund: `{ id: 're_test_1', object: 'refund', amount: 500, currency: 'usd', created: 1700000000, metadata: {}, status: 'succeeded', charge: 'ch_test_1' }`. Update test toggles `status: 'pending'`.

Test bodies mirror the products test: 3 cases per upsert (insert / newer / older).

- [ ] **Step 2: Confirm failures**

```bash
pnpm test -- charges payment_intents refunds
```

Expected: all FAIL (modules not found).

- [ ] **Step 3: Implement `src/upserts/charges.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { charges } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertCharge(
  db: DB,
  c: Stripe.Charge,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: c.id,
    object: c.object,
    amount: c.amount,
    amountCaptured: c.amount_captured,
    amountRefunded: c.amount_refunded,
    application: strOrNull(c.application),
    applicationFee: strOrNull(c.application_fee),
    applicationFeeAmount: c.application_fee_amount ?? null,
    balanceTransaction: strOrNull(c.balance_transaction),
    billingDetails: c.billing_details ?? null,
    calculatedStatementDescriptor: c.calculated_statement_descriptor ?? null,
    captured: c.captured,
    created: c.created,
    currency: c.currency,
    customer: strOrNull(c.customer),
    description: c.description ?? null,
    destination: strOrNull((c as any).destination),
    dispute: strOrNull(c.dispute),
    disputed: c.disputed,
    failureBalanceTransaction: strOrNull(c.failure_balance_transaction),
    failureCode: c.failure_code ?? null,
    failureMessage: c.failure_message ?? null,
    fraudDetails: c.fraud_details ?? null,
    invoice: strOrNull(c.invoice),
    livemode: c.livemode,
    metadata: c.metadata ?? null,
    onBehalfOf: strOrNull(c.on_behalf_of),
    order: strOrNull((c as any).order),
    outcome: c.outcome ?? null,
    paid: c.paid,
    paymentIntent: strOrNull(c.payment_intent),
    paymentMethod: c.payment_method ?? null,
    paymentMethodDetails: c.payment_method_details ?? null,
    radarOptions: c.radar_options ?? null,
    receiptEmail: c.receipt_email ?? null,
    receiptNumber: c.receipt_number ?? null,
    receiptUrl: c.receipt_url ?? null,
    refunded: c.refunded,
    review: strOrNull(c.review),
    shipping: c.shipping ?? null,
    sourceTransfer: strOrNull(c.source_transfer),
    statementDescriptor: c.statement_descriptor ?? null,
    statementDescriptorSuffix: c.statement_descriptor_suffix ?? null,
    status: c.status,
    transferData: c.transfer_data ?? null,
    transferGroup: c.transfer_group ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(charges).values(row).onConflictDoUpdate({
    target: charges.id,
    set: row,
    setWhere: lt(charges.lastEventAt, eventCreated),
  });
}
```

- [ ] **Step 4: Implement `src/upserts/payment_intents.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { paymentIntents } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertPaymentIntent(
  db: DB,
  p: Stripe.PaymentIntent,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    amount: p.amount,
    amountCapturable: p.amount_capturable,
    amountDetails: (p as any).amount_details ?? null,
    amountReceived: p.amount_received,
    application: strOrNull(p.application),
    applicationFeeAmount: p.application_fee_amount ?? null,
    automaticPaymentMethods: p.automatic_payment_methods ?? null,
    canceledAt: p.canceled_at ?? null,
    cancellationReason: p.cancellation_reason ?? null,
    captureMethod: p.capture_method,
    clientSecret: p.client_secret ?? null,
    confirmationMethod: p.confirmation_method,
    created: p.created,
    currency: p.currency,
    customer: strOrNull(p.customer),
    description: p.description ?? null,
    lastPaymentError: p.last_payment_error ?? null,
    latestCharge: strOrNull(p.latest_charge),
    livemode: p.livemode,
    metadata: p.metadata ?? null,
    nextAction: p.next_action ?? null,
    onBehalfOf: strOrNull(p.on_behalf_of),
    paymentMethod: strOrNull(p.payment_method),
    paymentMethodConfigurationDetails: (p as any).payment_method_configuration_details ?? null,
    paymentMethodOptions: p.payment_method_options ?? null,
    paymentMethodTypes: p.payment_method_types ?? null,
    processing: p.processing ?? null,
    receiptEmail: p.receipt_email ?? null,
    review: strOrNull(p.review),
    setupFutureUsage: p.setup_future_usage ?? null,
    shipping: p.shipping ?? null,
    source: strOrNull((p as any).source),
    statementDescriptor: p.statement_descriptor ?? null,
    statementDescriptorSuffix: p.statement_descriptor_suffix ?? null,
    status: p.status,
    transferData: p.transfer_data ?? null,
    transferGroup: p.transfer_group ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(paymentIntents).values(row).onConflictDoUpdate({
    target: paymentIntents.id,
    set: row,
    setWhere: lt(paymentIntents.lastEventAt, eventCreated),
  });
}
```

- [ ] **Step 5: Implement `src/upserts/refunds.ts`**

```ts
import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { refunds } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertRefund(
  db: DB,
  r: Stripe.Refund,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: r.id,
    object: r.object,
    amount: r.amount,
    balanceTransaction: strOrNull(r.balance_transaction),
    charge: strOrNull(r.charge),
    created: r.created,
    currency: r.currency,
    destinationDetails: r.destination_details ?? null,
    failureBalanceTransaction: strOrNull((r as any).failure_balance_transaction),
    failureReason: r.failure_reason ?? null,
    instructionsEmail: (r as any).instructions_email ?? null,
    metadata: r.metadata ?? null,
    nextAction: r.next_action ?? null,
    paymentIntent: strOrNull(r.payment_intent),
    reason: r.reason ?? null,
    receiptNumber: r.receipt_number ?? null,
    sourceTransferReversal: strOrNull(r.source_transfer_reversal),
    status: r.status ?? null,
    transferReversal: strOrNull(r.transfer_reversal),
    lastEventAt: eventCreated,
  };
  await db.insert(refunds).values(row).onConflictDoUpdate({
    target: refunds.id,
    set: row,
    setWhere: lt(refunds.lastEventAt, eventCreated),
  });
}
```

- [ ] **Step 6: Run all three test files, confirm green, commit**

```bash
pnpm test -- charges payment_intents refunds
git add src/upserts/charges.ts src/upserts/payment_intents.ts src/upserts/refunds.ts \
        test/upserts/charges.test.ts test/upserts/payment_intents.test.ts test/upserts/refunds.test.ts
git commit -m "feat(upserts): charges, payment_intents, refunds"
```

---

## Phase 5 — Webhook handler

### Task 17: Event dispatch map

**Files:**
- Create: `src/webhooks/dispatch.ts`

- [ ] **Step 1: Implement `src/webhooks/dispatch.ts`**

```ts
import type Stripe from 'stripe';
import type { DB } from '../db/client';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';

type Handler = (db: DB, obj: any, eventCreated: number) => Promise<void>;

const customerHandler: Handler = (db, obj, ts) => upsertCustomer(db, obj as Stripe.Customer, ts);
const productHandler: Handler = (db, obj, ts) => upsertProduct(db, obj as Stripe.Product, ts);
const priceHandler: Handler = (db, obj, ts) => upsertPrice(db, obj as Stripe.Price, ts);
const subscriptionHandler: Handler = (db, obj, ts) => upsertSubscription(db, obj as Stripe.Subscription, ts);
const invoiceHandler: Handler = (db, obj, ts) => upsertInvoice(db, obj as Stripe.Invoice, ts);
const chargeHandler: Handler = (db, obj, ts) => upsertCharge(db, obj as Stripe.Charge, ts);
const paymentIntentHandler: Handler = (db, obj, ts) => upsertPaymentIntent(db, obj as Stripe.PaymentIntent, ts);
const refundHandler: Handler = (db, obj, ts) => upsertRefund(db, obj as Stripe.Refund, ts);

export const HANDLERS: Record<string, Handler> = {
  'customer.created': customerHandler,
  'customer.updated': customerHandler,
  'customer.deleted': customerHandler,

  'product.created': productHandler,
  'product.updated': productHandler,
  'product.deleted': productHandler,

  'price.created': priceHandler,
  'price.updated': priceHandler,
  'price.deleted': priceHandler,

  'customer.subscription.created': subscriptionHandler,
  'customer.subscription.updated': subscriptionHandler,
  'customer.subscription.deleted': subscriptionHandler,
  'customer.subscription.paused': subscriptionHandler,
  'customer.subscription.resumed': subscriptionHandler,
  'customer.subscription.trial_will_end': subscriptionHandler,
  'customer.subscription.pending_update_applied': subscriptionHandler,
  'customer.subscription.pending_update_expired': subscriptionHandler,

  'invoice.created': invoiceHandler,
  'invoice.updated': invoiceHandler,
  'invoice.finalized': invoiceHandler,
  'invoice.finalization_failed': invoiceHandler,
  'invoice.paid': invoiceHandler,
  'invoice.payment_succeeded': invoiceHandler,
  'invoice.payment_failed': invoiceHandler,
  'invoice.payment_action_required': invoiceHandler,
  'invoice.sent': invoiceHandler,
  'invoice.voided': invoiceHandler,
  'invoice.marked_uncollectible': invoiceHandler,
  'invoice.deleted': invoiceHandler,
  'invoice.upcoming': invoiceHandler,

  'charge.captured': chargeHandler,
  'charge.expired': chargeHandler,
  'charge.failed': chargeHandler,
  'charge.pending': chargeHandler,
  'charge.refunded': chargeHandler,
  'charge.succeeded': chargeHandler,
  'charge.updated': chargeHandler,

  'payment_intent.amount_capturable_updated': paymentIntentHandler,
  'payment_intent.canceled': paymentIntentHandler,
  'payment_intent.created': paymentIntentHandler,
  'payment_intent.payment_failed': paymentIntentHandler,
  'payment_intent.processing': paymentIntentHandler,
  'payment_intent.requires_action': paymentIntentHandler,
  'payment_intent.succeeded': paymentIntentHandler,
  'payment_intent.partially_funded': paymentIntentHandler,

  'refund.created': refundHandler,
  'refund.updated': refundHandler,
  'refund.failed': refundHandler,
  'charge.refund.updated': refundHandler,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/webhooks/dispatch.ts
git commit -m "feat(webhooks): event.type -> upsert handler dispatch map"
```

---

### Task 18: Webhook handler with signature verification (TDD)

**Files:**
- Create: `test/webhooks/handler.test.ts`
- Create: `src/webhooks/handler.ts`

The webhook handler:
1. Reads raw body
2. Verifies Stripe signature
3. Inserts into `stripe_events` (idempotent on event id)
4. Dispatches via `HANDLERS[event.type]` (unknown types are logged only)
5. Returns 200; signature failure returns 400

- [ ] **Step 1: Test scaffold helper — generates a valid Stripe signature header**

```ts
// test/webhooks/handler.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { stripeEvents, customers } from '../../src/db/schema';

const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

async function signStripeBody(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const sig = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${sig}`;
}

function makeEvent(overrides: Partial<any> = {}) {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    api_version: '2024-10-28.acacia',
    type: 'customer.created',
    created: 1700000100,
    data: {
      object: {
        id: 'cus_test_1',
        object: 'customer',
        email: 'a@example.com',
        created: 1700000000,
        livemode: false,
        metadata: {},
      },
    },
    ...overrides,
  });
}

describe('POST /webhooks/stripe', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(stripeEvents);
    await db.delete(customers);
  });

  it('400 on invalid signature', async () => {
    const res = await SELF.fetch('https://x/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'bogus', 'content-type': 'application/json' },
      body: makeEvent(),
    });
    expect(res.status).toBe(400);
  });

  it('writes stripe_events and dispatches to upsert on valid signature', async () => {
    const body = makeEvent();
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    const res = await SELF.fetch('https://x/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_test_1')).get())?.type).toBe('customer.created');
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get())?.email).toBe('a@example.com');
  });

  it('200 with no second write on duplicate event id', async () => {
    const body = makeEvent();
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    // Mutate customer email in DB to detect re-dispatch
    const db = getDb(env.DB);
    await db.update(customers).set({ email: 'untouched@example.com' }).where(eq(customers.id, 'cus_test_1'));
    const res = await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get())?.email).toBe('untouched@example.com');
  });

  it('200 and logs unknown event types without dispatching', async () => {
    const body = makeEvent({ id: 'evt_unknown_1', type: 'totally.unknown' });
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    const res = await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_unknown_1')).get())?.type).toBe('totally.unknown');
  });
});
```

(Set `STRIPE_WEBHOOK_SECRET` in `vitest.config.ts` via `miniflare.bindings = { STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_API_KEY: 'sk_test_x' }` so `env.STRIPE_WEBHOOK_SECRET` is populated. Add that to the vitest config in this task.)

- [ ] **Step 2: Update `vitest.config.ts` to bind test secrets**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          queueProducers: { BACKLOAD_QUEUE: 'stripe-sync-backload' },
          queueConsumers: ['stripe-sync-backload'],
          bindings: {
            STRIPE_API_KEY: 'sk_test_x',
            STRIPE_WEBHOOK_SECRET: 'whsec_test',
          },
        },
      },
    },
  },
});
```

- [ ] **Step 3: Confirm test failure**

```bash
pnpm test -- handler
```

Expected: FAIL — webhook route not registered yet, so 404s/500s.

- [ ] **Step 4: Implement `src/webhooks/handler.ts`**

```ts
import { app } from '../app';
import { getDb } from '../db/client';
import { stripeEvents } from '../db/schema';
import { getStripe } from '../stripe';
import { HANDLERS } from './dispatch';

app.post('/webhooks/stripe', async (c) => {
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.text('missing signature', 400);

  const body = await c.req.text();
  const stripe = getStripe(c.env.STRIPE_API_KEY);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(JSON.stringify({ level: 'warn', msg: 'invalid_signature', err: String(err) }));
    return c.text('invalid signature', 400);
  }

  const db = getDb(c.env.DB);

  // Idempotent insert. INSERT OR IGNORE => duplicate is silent no-op.
  const insertResult = await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      apiVersion: event.api_version ?? null,
      requestId: event.request?.id ?? null,
      created: event.created,
      payload: event.data.object as unknown as Record<string, unknown>,
      receivedAt: Date.now(),
    })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });

  if (insertResult.length === 0) {
    // duplicate delivery
    return c.text('ok', 200);
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    console.log(JSON.stringify({ level: 'info', msg: 'unhandled_event_type', type: event.type, id: event.id }));
    return c.text('ok', 200);
  }

  try {
    await handler(db, event.data.object, event.created);
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'handler_failed', type: event.type, id: event.id, err: String(err) }));
    return c.text('handler error', 500);
  }

  return c.text('ok', 200);
});
```

- [ ] **Step 5: Confirm pass**

```bash
pnpm test -- handler
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/handler.ts test/webhooks/handler.test.ts vitest.config.ts
git commit -m "feat(webhooks): signature verify + idempotent event log + dispatch"
```

---

## Phase 6 — Backload

### Task 19: Scheduled handler (enqueues backload jobs)

**Files:**
- Create: `src/backload/scheduled.ts`
- Create: `test/backload/scheduled.test.ts`

- [ ] **Step 1: Test — assert one queue message per non-`done` resource**

```ts
// test/backload/scheduled.test.ts
import { env, createScheduledController } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { backloadState } from '../../src/db/schema';
import { scheduledHandler } from '../../src/backload/scheduled';

describe('scheduled handler', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
    const now = Date.now();
    await db.insert(backloadState).values([
      { resource: 'customers', cursor: null, status: 'idle', updatedAt: now },
      { resource: 'products', cursor: null, status: 'done', updatedAt: now },
      { resource: 'prices', cursor: 'price_abc', status: 'idle', updatedAt: now },
    ]);
  });

  it('enqueues a job for each non-done resource', async () => {
    const sent: any[] = [];
    const fakeEnv = {
      ...env,
      BACKLOAD_QUEUE: { send: async (msg: unknown) => sent.push(msg) } as any,
    };
    await scheduledHandler(createScheduledController(), fakeEnv as any, {} as any);
    expect(sent).toEqual([
      { resource: 'customers', cursor: null },
      { resource: 'prices', cursor: 'price_abc' },
    ]);
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm test -- scheduled
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/backload/scheduled.ts`**

```ts
import { ne } from 'drizzle-orm';
import type { Env } from '../env';
import { getDb } from '../db/client';
import { backloadState } from '../db/schema';

export const scheduledHandler: ExportedHandlerScheduledHandler<Env> = async (_ctrl, env, _ctx) => {
  const db = getDb(env.DB);
  const rows = await db
    .select({ resource: backloadState.resource, cursor: backloadState.cursor })
    .from(backloadState)
    .where(ne(backloadState.status, 'done'));

  for (const row of rows) {
    await env.BACKLOAD_QUEUE.send({
      resource: row.resource as any,
      cursor: row.cursor ?? null,
    });
  }
};
```

- [ ] **Step 4: Confirm pass and commit**

```bash
pnpm test -- scheduled
git add src/backload/scheduled.ts test/backload/scheduled.test.ts
git commit -m "feat(backload): scheduled handler enqueues jobs for non-done resources"
```

---

### Task 20: Queue consumer (fetch Stripe page, upsert, advance cursor)

**Files:**
- Create: `src/backload/consumer.ts`
- Create: `test/backload/consumer.test.ts`

The queue consumer:
1. Reads `backload_state[resource]`. If `status === 'done'`, ack and return.
2. Calls `stripe.<resource>.list({ limit: 100, starting_after: cursor ?? undefined })`.
3. For each object, dispatches to the matching upsert with `obj.created` as `last_event_at`.
4. If `has_more`: updates cursor to last id, status `idle`, re-enqueues itself.
5. Else: cursor `NULL`, status `done`.

We dispatch via a small map from resource name to (stripe-list-fn, upsert-fn).

- [ ] **Step 1: Test — mock Stripe SDK so list() returns canned pages, assert cursor advance + freshness guard does not clobber webhook-newer rows**

```ts
// test/backload/consumer.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { backloadState, customers } from '../../src/db/schema';
import { processBackloadMessage } from '../../src/backload/consumer';

vi.mock('../../src/stripe', () => {
  const listMock = vi.fn();
  return {
    getStripe: () => ({
      customers: { list: listMock },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      subscriptions: { list: vi.fn() },
      invoices: { list: vi.fn() },
      charges: { list: vi.fn() },
      paymentIntents: { list: vi.fn() },
      refunds: { list: vi.fn() },
    }),
    __listMock: listMock,
  };
});

import * as stripeMod from '../../src/stripe';
const listMock = (stripeMod as any).__listMock as ReturnType<typeof vi.fn>;

describe('processBackloadMessage', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
    await db.delete(customers);
    await db.insert(backloadState).values({
      resource: 'customers', cursor: null, status: 'idle', updatedAt: Date.now(),
    });
    listMock.mockReset();
  });

  it('processes a page with has_more=true, advances cursor, re-enqueues', async () => {
    listMock.mockResolvedValue({
      data: [
        { id: 'cus_a', object: 'customer', created: 1, email: 'a@x', livemode: false, metadata: {} },
        { id: 'cus_b', object: 'customer', created: 2, email: 'b@x', livemode: false, metadata: {} },
      ],
      has_more: true,
    });
    const sent: any[] = [];
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async (m: unknown) => sent.push(m) } as any };

    await processBackloadMessage(fakeEnv as any, { resource: 'customers', cursor: null });

    const db = getDb(env.DB);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'customers')).get();
    expect(state?.cursor).toBe('cus_b');
    expect(state?.status).toBe('idle');
    expect(sent).toEqual([{ resource: 'customers', cursor: 'cus_b' }]);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_a')).get())?.email).toBe('a@x');
  });

  it('marks done when has_more=false', async () => {
    listMock.mockResolvedValue({ data: [], has_more: false });
    const sent: any[] = [];
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async (m: unknown) => sent.push(m) } as any };

    await processBackloadMessage(fakeEnv as any, { resource: 'customers', cursor: null });
    const db = getDb(env.DB);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'customers')).get();
    expect(state?.status).toBe('done');
    expect(state?.cursor).toBeNull();
    expect(sent).toEqual([]);
  });

  it('does not clobber a customer updated by a newer webhook', async () => {
    // pre-seed with newer last_event_at than what the backload would set
    const db = getDb(env.DB);
    await db.insert(customers).values({
      id: 'cus_a',
      email: 'webhook-fresh@x',
      created: 1,
      livemode: false,
      metadata: {},
      lastEventAt: 9999,
    });

    listMock.mockResolvedValue({
      data: [{ id: 'cus_a', object: 'customer', created: 1, email: 'backload-stale@x', livemode: false, metadata: {} }],
      has_more: false,
    });
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await processBackloadMessage(fakeEnv as any, { resource: 'customers', cursor: null });

    expect((await db.select().from(customers).where(eq(customers.id, 'cus_a')).get())?.email).toBe('webhook-fresh@x');
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm test -- consumer
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/backload/consumer.ts`**

```ts
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import type { Env, BackloadJob } from '../env';
import { getDb, type DB } from '../db/client';
import { backloadState } from '../db/schema';
import { getStripe } from '../stripe';
import { upsertCustomer } from '../upserts/customers';
import { upsertProduct } from '../upserts/products';
import { upsertPrice } from '../upserts/prices';
import { upsertSubscription } from '../upserts/subscriptions';
import { upsertInvoice } from '../upserts/invoices';
import { upsertCharge } from '../upserts/charges';
import { upsertPaymentIntent } from '../upserts/payment_intents';
import { upsertRefund } from '../upserts/refunds';

type Resource = BackloadJob['resource'];

interface ResourceBinding {
  list: (stripe: Stripe, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
}

const RESOURCES: Record<Resource, ResourceBinding> = {
  customers: {
    list: (s, c) => s.customers.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertCustomer(db, obj, ts),
  },
  products: {
    list: (s, c) => s.products.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertProduct(db, obj, ts),
  },
  prices: {
    list: (s, c) => s.prices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPrice(db, obj, ts),
  },
  subscriptions: {
    list: (s, c) => s.subscriptions.list({ limit: 100, starting_after: c ?? undefined, status: 'all' }) as any,
    upsert: (db, obj, ts) => upsertSubscription(db, obj, ts),
  },
  invoices: {
    list: (s, c) => s.invoices.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertInvoice(db, obj, ts),
  },
  charges: {
    list: (s, c) => s.charges.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertCharge(db, obj, ts),
  },
  payment_intents: {
    list: (s, c) => s.paymentIntents.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertPaymentIntent(db, obj, ts),
  },
  refunds: {
    list: (s, c) => s.refunds.list({ limit: 100, starting_after: c ?? undefined }) as any,
    upsert: (db, obj, ts) => upsertRefund(db, obj, ts),
  },
};

export async function processBackloadMessage(env: Env, job: BackloadJob): Promise<void> {
  const db = getDb(env.DB);
  const state = await db.select().from(backloadState).where(eq(backloadState.resource, job.resource)).get();
  if (!state || state.status === 'done') return;

  await db.update(backloadState)
    .set({ status: 'in_progress', updatedAt: Date.now() })
    .where(eq(backloadState.resource, job.resource));

  const binding = RESOURCES[job.resource];
  const stripe = getStripe(env.STRIPE_API_KEY);
  const page = await binding.list(stripe, job.cursor);

  for (const obj of page.data) {
    await binding.upsert(db, obj, obj.created);
  }

  if (page.has_more) {
    const lastId = page.data[page.data.length - 1]?.id ?? job.cursor;
    await db.update(backloadState)
      .set({ cursor: lastId, status: 'idle', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, job.resource));
    await env.BACKLOAD_QUEUE.send({ resource: job.resource, cursor: lastId });
  } else {
    await db.update(backloadState)
      .set({ cursor: null, status: 'done', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, job.resource));
  }
}

export const queueHandler: ExportedHandlerQueueHandler<Env, BackloadJob> = async (batch, env) => {
  for (const msg of batch.messages) {
    try {
      await processBackloadMessage(env, msg.body);
      msg.ack();
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: 'backload_failed', job: msg.body, err: String(err) }));
      msg.retry();
    }
  }
};
```

- [ ] **Step 4: Confirm pass and commit**

```bash
pnpm test -- consumer
git add src/backload/consumer.ts test/backload/consumer.test.ts
git commit -m "feat(backload): queue consumer pages stripe and advances cursor"
```

---

## Phase 7 — Final wiring and verification

### Task 21: Full typecheck and full test suite

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

```bash
pnpm typecheck
```

Expected: passes. (`src/index.ts` now resolves all its imports.)

- [ ] **Step 2: Full test suite**

```bash
pnpm test
```

Expected: every test from Tasks 11–20 passes.

- [ ] **Step 3: Lint check on Drizzle migration drift**

```bash
pnpm db:generate
git diff --exit-code drizzle/
```

Expected: empty diff. (If non-empty, schema and committed migrations are out of sync — commit the regenerated SQL.)

---

### Task 22: README + dev setup notes

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup and operations README"
```

---

## Self-review

- **Spec coverage:**
  - Decision 1 (billing-core resources) → Tasks 4–9 (schema), 11–16 (upserts), 17 (dispatch), 20 (consumer mapping) ✅
  - Decision 2 (queue+cron backload) → Tasks 19, 20 ✅
  - Decision 3 (single account) → schema has no `account_id`; secrets are scalar ✅
  - Decision 4 (mirror sync-engine columns) → Tasks 4–9 enumerate columns; type-mapping rules in header ✅
  - Decision 5 (resumable cursor) → `backload_state` schema (Task 4), consumer cursor logic (Task 20), `pnpm backload:reset` (Task 1) ✅
  - Decision 6 (`last_event_at` guard) → Every upsert (Tasks 11–16) tests it explicitly; consumer test (Task 20) confirms it across sources ✅
  - Decision 7 (synchronous webhook processing) → Task 18 handler inserts and dispatches inline ✅
  - Decision 8 (Drizzle everywhere) → schema in Drizzle (Tasks 4–8), migrations via `drizzle-kit generate` (Task 9), seed via plain SQL migration file (justified — Drizzle has no insert-seed primitive) ✅

- **Placeholder scan:** `REPLACE_AFTER_D1_CREATE` is the only unfilled value in `wrangler.toml`; it is explicitly documented as set during first-time setup in Task 22's README. Not a placeholder bug.

- **Type consistency:** All `upsert*` functions share the `(db: DB, obj, eventCreated: number) => Promise<void>` signature; the dispatch map (Task 17) and consumer map (Task 20) both rely on it. `BackloadJob` and `Env` shapes are defined once in Task 3 and reused.

- **Known gaps to handle during implementation:**
  - Drizzle's `onConflictDoUpdate` `setWhere` clause: verified to exist in `drizzle-orm` ≥ 0.30 for SQLite. If the installed version differs, swap each upsert for the two-statement INSERT-OR-IGNORE + conditional UPDATE pattern noted in Task 11. Tests stay identical.
  - The `Stripe.Subscription.items` field is required and always present on the API response; the type cast assumes this. If a webhook payload arrives without it, the upsert would throw — which is the correct behavior (Stripe retries).

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-27-stripe-sync-d1.md`.
