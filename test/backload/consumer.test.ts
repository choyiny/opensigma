import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { backloadState, customers } from '../../src/db/schema';
import { processBackloadMessage } from '../../src/backload/consumer';
import type Stripe from 'stripe';

function makeFakeStripe(listImpl: () => Promise<{ data: any[]; has_more: boolean }>): Stripe {
  return {
    customers: { list: listImpl },
    products: { list: () => Promise.resolve({ data: [], has_more: false }) },
    prices: { list: () => Promise.resolve({ data: [], has_more: false }) },
    subscriptions: { list: () => Promise.resolve({ data: [], has_more: false }) },
    invoices: { list: () => Promise.resolve({ data: [], has_more: false }) },
    charges: { list: () => Promise.resolve({ data: [], has_more: false }) },
    paymentIntents: { list: () => Promise.resolve({ data: [], has_more: false }) },
    refunds: { list: () => Promise.resolve({ data: [], has_more: false }) },
  } as any;
}

describe('processBackloadMessage', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
    await db.delete(customers);
    await db.insert(backloadState).values({
      resource: 'customers', cursor: null, status: 'idle', updatedAt: Date.now(),
    });
  });

  it('processes a page with has_more=true, advances cursor, re-enqueues', async () => {
    const fakeStripe = makeFakeStripe(() => Promise.resolve({
      data: [
        { id: 'cus_a', object: 'customer', created: 1, email: 'a@x', livemode: false, metadata: {} },
        { id: 'cus_b', object: 'customer', created: 2, email: 'b@x', livemode: false, metadata: {} },
      ],
      has_more: true,
    }));

    const sent: any[] = [];
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async (m: unknown) => sent.push(m) } as any };

    await processBackloadMessage(fakeEnv as any, { kind: 'page', resource: 'customers', cursor: null }, fakeStripe);

    const db = getDb(env.DB);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'customers')).get();
    expect(state?.cursor).toBe('cus_b');
    expect(state?.status).toBe('idle');
    expect(sent).toEqual([{ kind: 'page', resource: 'customers', cursor: 'cus_b' }]);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_a')).get())?.email).toBe('a@x');
  });

  it('marks done when has_more=false', async () => {
    const fakeStripe = makeFakeStripe(() => Promise.resolve({ data: [], has_more: false }));

    const sent: any[] = [];
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async (m: unknown) => sent.push(m) } as any };

    await processBackloadMessage(fakeEnv as any, { kind: 'page', resource: 'customers', cursor: null }, fakeStripe);
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
    } as any);

    const fakeStripe = makeFakeStripe(() => Promise.resolve({
      data: [{ id: 'cus_a', object: 'customer', created: 1, email: 'backload-stale@x', livemode: false, metadata: {} }],
      has_more: false,
    }));

    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await processBackloadMessage(fakeEnv as any, { kind: 'page', resource: 'customers', cursor: null }, fakeStripe);

    expect((await db.select().from(customers).where(eq(customers.id, 'cus_a')).get())?.email).toBe('webhook-fresh@x');
  });
});
