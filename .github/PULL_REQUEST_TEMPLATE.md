## What & why

<!-- What does this change, and why? Link any related issue. -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] Added/updated tests for behaviour changes
- [ ] No hand-written migrations — schema changes go through `pnpm db:generate`, with the generated
      file in `drizzle/` committed

If this adds a synced Stripe resource, all four touchpoints are covered:

- [ ] Table in `src/db/schema.ts` (with the `last_event_at` guard column)
- [ ] Upsert in `src/upserts/`
- [ ] Event mapping in `src/webhooks/dispatch.ts`
- [ ] Registry entry in `src/backload/registry.ts`
