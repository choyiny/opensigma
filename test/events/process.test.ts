// test/events/process.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { stripeEvents, customers } from '../../src/db/schema';
import { processEvent, type StripeEventLike } from '../../src/events/process';

function ctx() {
  return { db: getDb(env.DB), stripe: {} as any, env: env as any };
}

function customerEvent(overrides: Partial<StripeEventLike> = {}): StripeEventLike {
  return {
    id: 'evt_p1',
    type: 'customer.created',
    created: 1700000100,
    api_version: '2024-10-28.acacia',
    request: { id: 'req_1' },
    data: { object: { id: 'cus_p1', object: 'customer', email: 'a@x', created: 1700000000, livemode: false, metadata: {} } },
    ...overrides,
  };
}

describe('processEvent', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(stripeEvents);
    await db.delete(customers);
  });

  it('records the event and dispatches to the upsert on a new event', async () => {
    const result = await processEvent(ctx(), customerEvent());
    expect(result).toBe('handled');
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_p1')).get())?.type).toBe('customer.created');
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_p1')).get())?.email).toBe('a@x');
  });

  it('skips a duplicate event id without re-dispatching', async () => {
    const db = getDb(env.DB);
    await processEvent(ctx(), customerEvent());
    await db.update(customers).set({ email: 'untouched@x' }).where(eq(customers.id, 'cus_p1'));
    const result = await processEvent(ctx(), customerEvent());
    expect(result).toBe('skipped');
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_p1')).get())?.email).toBe('untouched@x');
  });

  it('records but skips dispatch for an unknown event type', async () => {
    const result = await processEvent(ctx(), customerEvent({ id: 'evt_unknown', type: 'totally.unknown' }));
    expect(result).toBe('skipped');
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_unknown')).get())?.type).toBe('totally.unknown');
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_p1')).get())).toBeUndefined();
  });
});
