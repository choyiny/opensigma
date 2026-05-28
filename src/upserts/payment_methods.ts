import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { paymentMethods } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertPaymentMethod(
  db: DB,
  m: Stripe.PaymentMethod,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: m.id,
    object: m.object,
    allowRedisplay: (m as any).allow_redisplay ?? null,
    billingDetails: m.billing_details ?? null,
    card: (m as any).card ?? null,
    cardPresent: (m as any).card_present ?? null,
    created: m.created,
    customer: strOrNull(m.customer),
    livemode: m.livemode,
    metadata: m.metadata ?? null,
    type: m.type ?? null,
    usBankAccount: (m as any).us_bank_account ?? null,
    paypal: (m as any).paypal ?? null,
    link: (m as any).link ?? null,
    sepaDebit: (m as any).sepa_debit ?? null,
    cashapp: (m as any).cashapp ?? null,
    afterpayClearpay: (m as any).afterpay_clearpay ?? null,
    klarna: (m as any).klarna ?? null,
    radarOptions: (m as any).radar_options ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(paymentMethods).values(row).onConflictDoUpdate({
    target: paymentMethods.id,
    set: row,
    setWhere: lt(paymentMethods.lastEventAt, eventCreated),
  });
}
