import type Stripe from 'stripe';
import { lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { products } from '../db/schema';

export async function upsertProduct(
  db: DB,
  p: Stripe.Product,
  eventCreated: number,
): Promise<void> {
  const row = {
    id: p.id,
    object: p.object,
    active: p.active,
    created: p.created,
    defaultPrice: typeof p.default_price === 'string' ? p.default_price : null,
    description: p.description ?? null,
    images: p.images ?? null,
    livemode: p.livemode,
    marketingFeatures: p.marketing_features ?? null,
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
