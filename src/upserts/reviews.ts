import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { reviews } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertReview(
  db: DB,
  r: Stripe.Review,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: r.id,
    object: r.object,
    billingZip: r.billing_zip ?? null,
    charge: strOrNull(r.charge),
    closedReason: r.closed_reason ?? null,
    created: r.created,
    ipAddress: r.ip_address ?? null,
    ipAddressLocation: r.ip_address_location ?? null,
    livemode: r.livemode,
    open: r.open,
    openedReason: r.opened_reason ?? null,
    paymentIntent: strOrNull(r.payment_intent),
    reason: r.reason,
    session: r.session ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(reviews).values(row).onConflictDoUpdate({
    target: reviews.id,
    set: row,
    setWhere: lt(reviews.lastEventAt, eventCreated),
  });
}
