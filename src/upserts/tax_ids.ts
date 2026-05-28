import type Stripe from 'stripe';
import { and, eq, lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { taxIds } from '../db/schema';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function upsertTaxId(
  db: DB,
  t: Stripe.TaxId | Stripe.DeletedTaxId,
  eventCreated: number,
): Promise<void> {
  if ('deleted' in t && t.deleted) {
    await db.delete(taxIds).where(and(eq(taxIds.id, t.id), lt(taxIds.lastEventAt, eventCreated))).run();
    return;
  }
  const full = t as Stripe.TaxId;
  const row = {
    id: full.id,
    object: full.object,
    country: full.country ?? null,
    created: full.created,
    customer: strOrNull(full.customer),
    livemode: full.livemode,
    type: full.type ?? null,
    value: full.value ?? null,
    verification: full.verification ?? null,
    owner: (full as any).owner ?? null,
    deleted: false,
    lastEventAt: eventCreated,
  };
  await db.insert(taxIds).values(row).onConflictDoUpdate({
    target: taxIds.id,
    set: row,
    setWhere: lt(taxIds.lastEventAt, eventCreated),
  });
}
