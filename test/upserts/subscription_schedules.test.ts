import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { subscriptionSchedules } from '../../src/db/schema';
import { upsertSubscriptionSchedule } from '../../src/upserts/subscription_schedules';

const stripeSubscriptionSchedule = (overrides: Partial<any> = {}): Stripe.SubscriptionSchedule => ({
  id: 'sub_sched_test_1',
  object: 'subscription_schedule',
  created: 1700000000,
  customer: 'cus_test_1',
  end_behavior: 'release',
  livemode: false,
  metadata: {},
  phases: [],
  status: 'not_started',
  ...overrides,
}) as unknown as Stripe.SubscriptionSchedule;

describe('upsertSubscriptionSchedule', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(subscriptionSchedules);
  });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertSubscriptionSchedule(db, stripeSubscriptionSchedule(), 1700000100);
    const row = await db
      .select()
      .from(subscriptionSchedules)
      .where(eq(subscriptionSchedules.id, 'sub_sched_test_1'))
      .get();
    expect(row?.status).toBe('not_started');
    expect(row?.customer).toBe('cus_test_1');
    expect(row?.lastEventAt).toBe(1700000100);
  });

  it('updates on newer event', async () => {
    const db = getDb(env.DB);
    await upsertSubscriptionSchedule(db, stripeSubscriptionSchedule({ status: 'not_started' }), 100);
    await upsertSubscriptionSchedule(db, stripeSubscriptionSchedule({ status: 'active' }), 200);
    const row = await db
      .select()
      .from(subscriptionSchedules)
      .where(eq(subscriptionSchedules.id, 'sub_sched_test_1'))
      .get();
    expect(row?.status).toBe('active');
    expect(row?.lastEventAt).toBe(200);
  });

  it('no-ops on older event', async () => {
    const db = getDb(env.DB);
    await upsertSubscriptionSchedule(db, stripeSubscriptionSchedule({ status: 'active' }), 200);
    await upsertSubscriptionSchedule(db, stripeSubscriptionSchedule({ status: 'canceled' }), 100);
    const row = await db
      .select()
      .from(subscriptionSchedules)
      .where(eq(subscriptionSchedules.id, 'sub_sched_test_1'))
      .get();
    expect(row?.status).toBe('active');
    expect(row?.lastEventAt).toBe(200);
  });
});
