import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import type { DB } from '../db/client';
import { backloadState } from '../db/schema';
import { processEvent, type StripeEventLike } from './process';

export const EVENTS_STATE_KEY = '__events__';

const PAGE_LIMIT = 100;

// Incremental catch-up poll over the Stripe Events API. Webhooks remain the
// real-time path; this fills any gaps. Idempotent via the stripe_events PK.
export async function processEventsPoll(db: DB, env: Env, stripe: Stripe): Promise<void> {
  const state = await db.select().from(backloadState).where(eq(backloadState.resource, EVENTS_STATE_KEY)).get();
  const checkpoint = state?.cursor ?? null;

  // Bootstrap: adopt the newest event id and dispatch nothing. The object
  // backload owns historical seeding, so the poll must not replay the window.
  if (checkpoint === null) {
    const latest = await stripe.events.list({ limit: 1 });
    const newestId = latest.data[0]?.id ?? null;
    await db.update(backloadState)
      .set({ cursor: newestId, status: 'idle', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, EVENTS_STATE_KEY));
    return;
  }

  // Page newest-first until we reach the checkpoint (or exhaust the window).
  const collected: Stripe.Event[] = [];
  let startingAfter: string | undefined = undefined;
  let reachedCheckpoint = false;
  while (!reachedCheckpoint) {
    const page = await stripe.events.list({ limit: PAGE_LIMIT, starting_after: startingAfter });
    for (const ev of page.data) {
      if (ev.id === checkpoint) { reachedCheckpoint = true; break; }
      collected.push(ev);
    }
    if (reachedCheckpoint || !page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]!.id;
  }

  const newestId = collected.length > 0 ? collected[0]!.id : checkpoint;

  // Apply oldest-first so the lastEventAt guard resolves ordering correctly.
  collected.reverse();
  for (const ev of collected) {
    await processEvent({ db, stripe, env }, ev as unknown as StripeEventLike);
  }

  await db.update(backloadState)
    .set({ cursor: newestId, status: 'idle', updatedAt: Date.now(), lastSyncedAt: Date.now() })
    .where(eq(backloadState.resource, EVENTS_STATE_KEY));
}
