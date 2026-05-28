import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { disputes } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertDispute(db: DB, d: Stripe.Dispute, eventCreated: number): Promise<void> {
  const row = {
    id: d.id,
    object: d.object,
    amount: d.amount,
    balanceTransactions: d.balance_transactions ?? null,
    charge: strOrNull(d.charge),
    created: d.created,
    currency: d.currency,
    enhancedEvidence: (d as any).enhanced_evidence ?? null,
    evidence: d.evidence ?? null,
    evidenceDetails: d.evidence_details ?? null,
    isChargeRefundable: d.is_charge_refundable ?? null,
    livemode: d.livemode,
    metadata: d.metadata ?? null,
    paymentIntent: strOrNull(d.payment_intent),
    paymentMethodDetails: (d as any).payment_method_details ?? null,
    reason: d.reason ?? null,
    status: d.status ?? null,
    lastEventAt: eventCreated,
  };
  await db.insert(disputes).values(row).onConflictDoUpdate({
    target: disputes.id,
    set: row,
    setWhere: lt(disputes.lastEventAt, eventCreated),
  });
}
