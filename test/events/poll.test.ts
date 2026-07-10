// test/events/poll.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { getDb } from '../../src/db/client';
import { backloadState, stripeEvents, customers } from '../../src/db/schema';
import { processEventsPoll, EVENTS_STATE_KEY } from '../../src/events/poll';

// Fake stripe.events.list that serves a fixed newest-first list and honours
// { limit, starting_after } paging the same way the real API does.
function fakeStripe(all: any[]): Stripe {
  return {
    events: {
      list: async ({ limit = 100, starting_after }: { limit?: number; starting_after?: string } = {}) => {
        let start = 0;
        if (starting_after) {
          const idx = all.findIndex((e) => e.id === starting_after);
          start = idx === -1 ? all.length : idx + 1;
        }
        const slice = all.slice(start, start + limit);
        return { data: slice, has_more: start + limit < all.length };
      },
    },
  } as any;
}

function custEvent(id: string, created: number, email: string): any {
  return {
    id,
    type: 'customer.updated',
    created,
    data: { object: { id: 'cus_poll', object: 'customer', email, created: 1, livemode: false, metadata: {} } },
  };
}

describe('processEventsPoll', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
    await db.delete(stripeEvents);
    await db.delete(customers);
    await db.insert(backloadState).values({ resource: EVENTS_STATE_KEY, cursor: null, status: 'idle', updatedAt: Date.now() });
  });

  it('bootstraps to the latest event id and dispatches nothing when cursor is NULL', async () => {
    const stripe = fakeStripe([custEvent('evt_3', 300, 'newest@x'), custEvent('evt_2', 200, 'mid@x')]);
    await processEventsPoll(getDb(env.DB), env as any, stripe);
    const db = getDb(env.DB);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, EVENTS_STATE_KEY)).get();
    expect(state?.cursor).toBe('evt_3');
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_3')).get())).toBeUndefined();
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_poll')).get())).toBeUndefined();
  });

  it('applies new events oldest-first and advances the cursor', async () => {
    const db = getDb(env.DB);
    await db.update(backloadState).set({ cursor: 'evt_1' }).where(eq(backloadState.resource, EVENTS_STATE_KEY));
    // newest-first list; evt_1 is the checkpoint and must not be re-applied.
    const stripe = fakeStripe([
      custEvent('evt_3', 300, 'newest@x'),
      custEvent('evt_2', 200, 'older@x'),
      custEvent('evt_1', 100, 'checkpoint@x'),
    ]);
    await processEventsPoll(db, env as any, stripe);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_poll')).get())?.email).toBe('newest@x');
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, EVENTS_STATE_KEY)).get();
    expect(state?.cursor).toBe('evt_3');
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_1')).get())).toBeUndefined();
  });

  it('skips an event already recorded by a webhook (applied exactly once)', async () => {
    const db = getDb(env.DB);
    await db.update(backloadState).set({ cursor: 'evt_1' }).where(eq(backloadState.resource, EVENTS_STATE_KEY));
    // Simulate the webhook having already processed evt_2.
    await db.insert(stripeEvents).values({ id: 'evt_2', type: 'customer.updated', created: 200, payload: {}, receivedAt: Date.now() } as any);
    await db.insert(customers).values({ id: 'cus_poll', email: 'from-webhook@x', created: 1, livemode: false, metadata: {}, lastEventAt: 200 } as any);
    const stripe = fakeStripe([custEvent('evt_2', 200, 'from-poll@x'), custEvent('evt_1', 100, 'checkpoint@x')]);
    await processEventsPoll(db, env as any, stripe);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_poll')).get())?.email).toBe('from-webhook@x');
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, EVENTS_STATE_KEY)).get();
    expect(state?.cursor).toBe('evt_2');
  });
});
