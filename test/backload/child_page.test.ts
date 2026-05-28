import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { backloadParentProgress, backloadState, paymentMethods } from '../../src/db/schema';
import { processBackloadMessage } from '../../src/backload/consumer';
import { scheduledHandler } from '../../src/backload/scheduled';
import type Stripe from 'stripe';

const fakeStripe = (data: any[], has_more = false): Stripe => ({
  customers: {
    listPaymentMethods: () => Promise.resolve({ data, has_more }),
  },
} as any);

describe('child-page flow', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadParentProgress);
    await db.delete(paymentMethods);
    await db.update(backloadState).set({ status: 'done', cursor: null, updatedAt: Date.now() }).where(eq(backloadState.resource, 'customers'));
    await db.update(backloadState).set({ status: 'idle', cursor: null, updatedAt: Date.now() }).where(eq(backloadState.resource, 'payment_methods'));
    await db.insert(backloadParentProgress).values({
      resource: 'payment_methods', parentId: 'cus_1', status: 'idle', updatedAt: Date.now(),
    });
  });

  it('processes a child-page and marks per-parent done', async () => {
    const stripe = fakeStripe([
      { id: 'pm_a', object: 'payment_method', type: 'card', created: 1, customer: 'cus_1', livemode: false, metadata: {} },
    ]);
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await processBackloadMessage(fakeEnv as any, { kind: 'child-page', resource: 'payment_methods', parent_id: 'cus_1', cursor: null }, stripe);
    const db = getDb(env.DB);
    const row = await db.select().from(backloadParentProgress).where(and(eq(backloadParentProgress.resource, 'payment_methods'), eq(backloadParentProgress.parentId, 'cus_1'))).get();
    expect(row?.status).toBe('done');
    expect((await db.select().from(paymentMethods).where(eq(paymentMethods.id, 'pm_a')).get())?.customer).toBe('cus_1');
  });

  it('promotes per-parent backload_state from idle to in_progress when a child-page starts', async () => {
    const stripe = fakeStripe([
      { id: 'pm_a', object: 'payment_method', type: 'card', created: 1, customer: 'cus_1', livemode: false, metadata: {} },
    ], true);
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await processBackloadMessage(fakeEnv as any, { kind: 'child-page', resource: 'payment_methods', parent_id: 'cus_1', cursor: null }, stripe);
    const db = getDb(env.DB);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'payment_methods')).get();
    expect(state?.status).toBe('in_progress');
  });

  it('does not downgrade per-parent backload_state from done back to in_progress', async () => {
    const db = getDb(env.DB);
    await db.update(backloadState)
      .set({ status: 'done', updatedAt: Date.now() })
      .where(eq(backloadState.resource, 'payment_methods'));
    const stripe = fakeStripe([
      { id: 'pm_a', object: 'payment_method', type: 'card', created: 1, customer: 'cus_1', livemode: false, metadata: {} },
    ]);
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await processBackloadMessage(fakeEnv as any, { kind: 'child-page', resource: 'payment_methods', parent_id: 'cus_1', cursor: null }, stripe);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'payment_methods')).get();
    expect(state?.status).toBe('done');
  });

  it('cron flips per-parent resource to done when all parents done AND parent resource done', async () => {
    const db = getDb(env.DB);
    await db.update(backloadParentProgress).set({ status: 'done' }).where(eq(backloadParentProgress.resource, 'payment_methods'));
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await scheduledHandler({} as any, fakeEnv as any, {} as any);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'payment_methods')).get();
    expect(state?.status).toBe('done');
  });

  it('cron does NOT flip per-parent resource to done while parent is still in progress', async () => {
    const db = getDb(env.DB);
    await db.update(backloadState).set({ status: 'idle' }).where(eq(backloadState.resource, 'customers'));
    await db.update(backloadParentProgress).set({ status: 'done' }).where(eq(backloadParentProgress.resource, 'payment_methods'));
    const fakeEnv = { ...env, BACKLOAD_QUEUE: { send: async () => {} } as any };
    await scheduledHandler({} as any, fakeEnv as any, {} as any);
    const state = await db.select().from(backloadState).where(eq(backloadState.resource, 'payment_methods')).get();
    expect(state?.status).not.toBe('done');
  });
});
