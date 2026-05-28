import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { earlyFraudWarnings } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertEarlyFraudWarning(
  db: DB,
  e: Stripe.Radar.EarlyFraudWarning,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: e.id,
    object: e.object,
    actionable: e.actionable,
    charge: strOrNull(e.charge),
    created: e.created,
    fraudType: e.fraud_type,
    livemode: e.livemode,
    paymentIntent: strOrNull(e.payment_intent),
    lastEventAt: eventCreated,
  };
  await db.insert(earlyFraudWarnings).values(row).onConflictDoUpdate({
    target: earlyFraudWarnings.id,
    set: row,
    setWhere: lt(earlyFraudWarnings.lastEventAt, eventCreated),
  });
}
