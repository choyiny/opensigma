import type Stripe from 'stripe';
import { sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { balanceTransactions } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertBalanceTransaction(
  db: DB,
  bt: Stripe.BalanceTransaction,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: bt.id,
    object: bt.object,
    amount: bt.amount,
    availableOn: bt.available_on,
    created: bt.created,
    currency: bt.currency,
    description: bt.description ?? null,
    exchangeRate: bt.exchange_rate ?? null,
    fee: bt.fee,
    feeDetails: bt.fee_details ?? null,
    net: bt.net,
    reportingCategory: bt.reporting_category,
    source: strOrNull(bt.source),
    status: bt.status,
    type: bt.type,
    lastEventAt: eventCreated,
  };

  await db.insert(balanceTransactions).values(row).onConflictDoUpdate({
    target: balanceTransactions.id,
    set: {
      object: sql`excluded.object`,
      amount: sql`excluded.amount`,
      availableOn: sql`excluded.available_on`,
      created: sql`excluded.created`,
      currency: sql`excluded.currency`,
      description: sql`excluded.description`,
      exchangeRate: sql`excluded.exchange_rate`,
      fee: sql`excluded.fee`,
      feeDetails: sql`excluded.fee_details`,
      net: sql`excluded.net`,
      reportingCategory: sql`excluded.reporting_category`,
      source: sql`excluded.source`,
      status: sql`excluded.status`,
      type: sql`excluded.type`,
      lastEventAt: sql`excluded.last_event_at`,
    },
    setWhere: sql`balance_transactions.last_event_at < ${eventCreated}`,
  });
}

/**
 * Helper for webhook handlers: given a BT reference that may be a string ID,
 * an expanded object, or null, fetch and upsert it. Stripe doesn't emit
 * `balance_transaction.*` webhooks, so we piggyback on parent events
 * (charge.succeeded, refund.created, payout.created, etc.) to keep BTs fresh.
 */
export async function upsertBalanceTransactionRef(
  db: DB,
  stripe: Stripe,
  ref: string | Stripe.BalanceTransaction | null | undefined,
  eventCreated: number,
): Promise<void> {
  if (!ref) return;
  if (typeof ref === 'string') {
    const bt = await stripe.balanceTransactions.retrieve(ref);
    await upsertBalanceTransaction(db, bt, eventCreated);
  } else {
    await upsertBalanceTransaction(db, ref, eventCreated);
  }
}
