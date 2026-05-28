import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { earlyFraudWarnings } from '../../src/db/schema';
import { upsertEarlyFraudWarning } from '../../src/upserts/early_fraud_warnings';

const stripeEFW = (overrides: Partial<any> = {}): Stripe.Radar.EarlyFraudWarning => ({
  id: 'issfr_test_1',
  object: 'radar.early_fraud_warning',
  actionable: true,
  charge: 'ch_test_1',
  created: 1700000000,
  fraud_type: 'made_with_stolen_card',
  livemode: false,
  ...overrides,
}) as unknown as Stripe.Radar.EarlyFraudWarning;

describe('upsertEarlyFraudWarning', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(earlyFraudWarnings);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertEarlyFraudWarning(db, stripeEFW(), 1700000100);
    const row = await db
      .select()
      .from(earlyFraudWarnings)
      .where(eq(earlyFraudWarnings.id, 'issfr_test_1'))
      .get();
    expect(row?.actionable).toBe(true);
    expect(row?.fraudType).toBe('made_with_stolen_card');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertEarlyFraudWarning(db, stripeEFW({ actionable: true }), 100);
    await upsertEarlyFraudWarning(db, stripeEFW({ actionable: false }), 200);
    const row = await db
      .select()
      .from(earlyFraudWarnings)
      .where(eq(earlyFraudWarnings.id, 'issfr_test_1'))
      .get();
    expect(row?.actionable).toBe(false);
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertEarlyFraudWarning(db, stripeEFW({ actionable: false }), 200);
    await upsertEarlyFraudWarning(db, stripeEFW({ actionable: true }), 100);
    const row = await db
      .select()
      .from(earlyFraudWarnings)
      .where(eq(earlyFraudWarnings.id, 'issfr_test_1'))
      .get();
    expect(row?.actionable).toBe(false);
    expect(row?.lastEventAt).toBe(200);
  });
});
