import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { setupIntents } from '../../src/db/schema';
import { upsertSetupIntent } from '../../src/upserts/setup_intents';

const stripeSetupIntent = (overrides: Partial<any> = {}): Stripe.SetupIntent => ({
  id: 'seti_test_1',
  object: 'setup_intent',
  created: 1700000000,
  livemode: false,
  metadata: {},
  payment_method_types: ['card'],
  status: 'requires_payment_method',
  usage: 'off_session',
  ...overrides,
}) as unknown as Stripe.SetupIntent;

describe('upsertSetupIntent', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(setupIntents);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertSetupIntent(db, stripeSetupIntent(), 1700000100);
    const row = await db.select().from(setupIntents).where(eq(setupIntents.id, 'seti_test_1')).get();
    expect(row?.status).toBe('requires_payment_method');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertSetupIntent(db, stripeSetupIntent({ status: 'requires_payment_method' }), 100);
    await upsertSetupIntent(db, stripeSetupIntent({ status: 'succeeded' }), 200);
    const row = await db.select().from(setupIntents).where(eq(setupIntents.id, 'seti_test_1')).get();
    expect(row?.status).toBe('succeeded');
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertSetupIntent(db, stripeSetupIntent({ status: 'succeeded' }), 200);
    await upsertSetupIntent(db, stripeSetupIntent({ status: 'canceled' }), 100);
    const row = await db.select().from(setupIntents).where(eq(setupIntents.id, 'seti_test_1')).get();
    expect(row?.status).toBe('succeeded');
  });
});
