# Contributing to opensigma

Thanks for your interest! opensigma is a single Cloudflare Worker with a Drizzle/D1 schema, so
getting started is mostly a matter of pointing it at a Stripe test account.

## Development setup

```bash
pnpm install

# wrangler.jsonc is gitignored — start from the example
cp wrangler.jsonc.example wrangler.jsonc

wrangler d1 create stripe_sync    # paste the printed database_id into wrangler.jsonc
pnpm db:migrate:local
pnpm dev
```

Requires **Node 20** (see `.nvmrc`) and **pnpm 9**.

Use a Stripe **test-mode** restricted key (`rk_test_…`) for development — read-only, as described in
the README. There is no reason to point a development Worker at live data.

## Before you open a PR

Run the same checks CI does — both must pass:

```bash
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest, via @cloudflare/vitest-pool-workers
```

Tests run inside `workerd` with real D1 and Queue bindings, so they exercise actual SQL rather than
a mock. CI copies `wrangler.jsonc.ci` over `wrangler.jsonc` before running; you don't need to do
that locally.

## Workflow

- Work on a **feature branch**, not `main`.
- Keep changes focused; prefer small, reviewable PRs.
- Add or update tests for behaviour changes.
- **Never hand-write a migration.** Edit `src/db/schema.ts`, then run `pnpm db:generate` and commit
  the generated file in `drizzle/`.
- Humans deploy. Don't add a `deploy` step to CI.

## Adding a synced Stripe resource

Most contributions are "please also sync X". That touches four places:

1. **`src/db/schema.ts`** — add the table, mirroring sync-engine's column set, ported to SQLite.
   Include the `last_event_at` guard column. Then `pnpm db:generate`.
2. **`src/upserts/<resource>.ts`** — the upsert, using `onConflictDoUpdate` with
   `setWhere: lt(table.lastEventAt, eventCreated)` so out-of-order writes are dropped.
3. **`src/webhooks/dispatch.ts`** — map the relevant Stripe event types to the new upsert.
4. **`src/backload/registry.ts`** — register the resource so the cron backload pages it from the
   REST API. Account-listable resources and per-parent resources are registered separately.

Plus a test. A resource missing any one of these four will look like it works and then quietly drift.

## Reporting bugs / requesting features

Use the issue templates. For security issues, follow [SECURITY.md](./SECURITY.md) instead — please
don't open a public issue for those.
