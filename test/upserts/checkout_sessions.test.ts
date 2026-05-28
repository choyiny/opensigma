import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { checkoutSessions, checkoutSessionLineItems } from '../../src/db/schema';
import { upsertCheckoutSession, upsertCheckoutSessionLines } from '../../src/upserts/checkout_sessions';

const cs = (overrides: Partial<any> = {}): Stripe.Checkout.Session => ({
  id: 'cs_test_1',
  object: 'checkout.session',
  created: 1700000000,
  mode: 'payment',
  status: 'open',
  livemode: false,
  metadata: {},
  ...overrides,
}) as unknown as Stripe.Checkout.Session;

const fakeStripe = (lines: any[]): Stripe => ({
  checkout: { sessions: { listLineItems: () => Promise.resolve({ data: lines, has_more: false }) } },
} as any);

describe('checkout_sessions', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(checkoutSessions);
    await db.delete(checkoutSessionLineItems);
  });

  it('inserts parent', async () => {
    const db = getDb(env.DB);
    await upsertCheckoutSession(db, cs(), 1700000100);
    const row = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, 'cs_test_1')).get();
    expect(row?.status).toBe('open');
  });

  it('updates parent on newer', async () => {
    const db = getDb(env.DB);
    await upsertCheckoutSession(db, cs({ status: 'open' }), 100);
    await upsertCheckoutSession(db, cs({ status: 'complete' }), 200);
    const row = await db.select().from(checkoutSessions).where(eq(checkoutSessions.id, 'cs_test_1')).get();
    expect(row?.status).toBe('complete');
  });

  it('upserts lines from Stripe API', async () => {
    const db = getDb(env.DB);
    const stripe = fakeStripe([
      { id: 'li_1', object: 'item', amount_total: 100, currency: 'usd', quantity: 1 },
      { id: 'li_2', object: 'item', amount_total: 200, currency: 'usd', quantity: 2 },
    ]);
    await upsertCheckoutSessionLines(stripe, db, 'cs_test_1', 1700000100);
    const lines = await db
      .select()
      .from(checkoutSessionLineItems)
      .where(eq(checkoutSessionLineItems.checkoutSession, 'cs_test_1'));
    expect(lines.length).toBe(2);
  });
});
