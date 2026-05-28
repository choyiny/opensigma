import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { subscriptionSchedules } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertSubscriptionSchedule(
  db: DB,
  s: Stripe.SubscriptionSchedule,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: s.id,
    object: s.object,
    application: strOrNull(s.application),
    canceledAt: s.canceled_at ?? null,
    completedAt: s.completed_at ?? null,
    created: s.created,
    currentPhase: s.current_phase ?? null,
    customer: strOrNull(s.customer),
    defaultSettings: s.default_settings ?? null,
    endBehavior: s.end_behavior,
    livemode: s.livemode,
    metadata: s.metadata ?? null,
    phases: s.phases ?? null,
    releasedAt: s.released_at ?? null,
    releasedSubscription: s.released_subscription ?? null,
    status: s.status,
    subscription: strOrNull(s.subscription),
    testClock: strOrNull(s.test_clock),
    lastEventAt: eventCreated,
  };
  await db.insert(subscriptionSchedules).values(row).onConflictDoUpdate({
    target: subscriptionSchedules.id,
    set: row,
    setWhere: lt(subscriptionSchedules.lastEventAt, eventCreated),
  });
}
