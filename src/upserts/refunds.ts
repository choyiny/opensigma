import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { refunds } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertRefund(
  db: DB,
  r: Stripe.Refund,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: r.id,
    object: r.object,
    amount: r.amount,
    balanceTransaction: strOrNull(r.balance_transaction),
    charge: strOrNull(r.charge),
    created: r.created,
    currency: r.currency,
    destinationDetails: r.destination_details ?? null,
    failureBalanceTransaction: strOrNull((r as any).failure_balance_transaction),
    failureReason: r.failure_reason ?? null,
    instructionsEmail: (r as any).instructions_email ?? null,
    metadata: r.metadata ?? null,
    nextAction: r.next_action ?? null,
    paymentIntent: strOrNull(r.payment_intent),
    reason: r.reason ?? null,
    receiptNumber: r.receipt_number ?? null,
    sourceTransferReversal: strOrNull(r.source_transfer_reversal),
    status: r.status ?? null,
    transferReversal: strOrNull(r.transfer_reversal),
    lastEventAt: eventCreated,
  };

  await db.insert(refunds).values(row).onConflictDoUpdate({
    target: refunds.id,
    set: row,
    setWhere: lt(refunds.lastEventAt, eventCreated),
  });
}
