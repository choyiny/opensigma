import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { products } from '../db/schema';

export async function upsertProduct(
  db: DB,
  pInput: Stripe.Product,
  eventCreated: number,
): Promise<void> {
  // SDK types target the latest Stripe API; we mirror the 2024-10-28.acacia
  // shape (per sync-engine), so widen for field access.
  const p = pInput as Stripe.Product & Record<string, any>;
  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    attributes: p.attributes ?? null,
    created: p.created,
    defaultPrice: typeof p.default_price === 'string' ? p.default_price : null,
    description: p.description ?? null,
    images: p.images ?? null,
    livemode: p.livemode,
    metadata: p.metadata ?? null,
    name: p.name,
    packageDimensions: p.package_dimensions ?? null,
    shippable: p.shippable ?? null,
    statementDescriptor: p.statement_descriptor ?? null,
    taxCode: typeof p.tax_code === 'string' ? p.tax_code : null,
    type: p.type ?? null,
    unitLabel: p.unit_label ?? null,
    updated: p.updated ?? null,
    url: p.url ?? null,
    lastEventAt: eventCreated,
  };

  await db.insert(products).values(row).onConflictDoUpdate({
    target: products.id,
    set: row,
    setWhere: lt(products.lastEventAt, eventCreated),
  });
}
