import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { paymentIntents } from '../../src/db/schema';
import { upsertPaymentIntent } from '../../src/upserts/payment_intents';

const stripePI = (overrides: Partial<any> = {}): Stripe.PaymentIntent => ({
  id: 'pi_test_1',
  object: 'payment_intent',
  amount: 1000,
  amount_capturable: 0,
  amount_received: 1000,
  capture_method: 'automatic',
  confirmation_method: 'automatic',
  created: 1700000000,
  currency: 'usd',
  livemode: false,
  metadata: {},
  payment_method_types: ['card'],
  status: 'succeeded',
  ...overrides,
}) as unknown as Stripe.PaymentIntent;

describe('upsertPaymentIntent', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(paymentIntents);
  });

  it('inserts a new payment intent', async () => {
    const db = getDb(env.DB);
    await upsertPaymentIntent(db, stripePI(), 1700000100);
    const row = await db.select().from(paymentIntents).where(eq(paymentIntents.id, 'pi_test_1')).get();
    expect(row?.status).toBe('succeeded');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates when incoming event is newer', async () => {
    const db = getDb(env.DB);
    await upsertPaymentIntent(db, stripePI({ status: 'succeeded' }), 100);
    await upsertPaymentIntent(db, stripePI({ status: 'requires_action' }), 200);
    const row = await db.select().from(paymentIntents).where(eq(paymentIntents.id, 'pi_test_1')).get();
    expect(row?.status).toBe('requires_action');
  });

  it('no-ops when incoming event is older', async () => {
    const db = getDb(env.DB);
    await upsertPaymentIntent(db, stripePI({ status: 'succeeded' }), 200);
    await upsertPaymentIntent(db, stripePI({ status: 'requires_action' }), 100);
    const row = await db.select().from(paymentIntents).where(eq(paymentIntents.id, 'pi_test_1')).get();
    expect(row?.status).toBe('succeeded');
  });
});
