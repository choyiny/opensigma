import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { taxIds } from '../../src/db/schema';
import { upsertTaxId } from '../../src/upserts/tax_ids';

const txi = (o: Partial<any> = {}): Stripe.TaxId => ({
  id: 'txi_1',
  object: 'tax_id',
  country: 'DE',
  created: 1700000000,
  customer: 'cus_1',
  livemode: false,
  type: 'eu_vat',
  value: 'DE123456789',
  verification: null,
  ...o,
}) as unknown as Stripe.TaxId;

describe('upsertTaxId', () => {
  beforeEach(async () => { await getDb(env.DB).delete(taxIds); });

  it('inserts', async () => {
    const db = getDb(env.DB);
    await upsertTaxId(db, txi(), 1700000100);
    expect((await db.select().from(taxIds).where(eq(taxIds.id, 'txi_1')).get())?.value).toBe('DE123456789');
  });

  it('updates on newer', async () => {
    const db = getDb(env.DB);
    await upsertTaxId(db, txi({ value: 'DE111' }), 100);
    await upsertTaxId(db, txi({ value: 'DE222' }), 200);
    expect((await db.select().from(taxIds).where(eq(taxIds.id, 'txi_1')).get())?.value).toBe('DE222');
  });

  it('no-ops on older', async () => {
    const db = getDb(env.DB);
    await upsertTaxId(db, txi({ value: 'DE111' }), 200);
    await upsertTaxId(db, txi({ value: 'DE222' }), 100);
    expect((await db.select().from(taxIds).where(eq(taxIds.id, 'txi_1')).get())?.value).toBe('DE111');
  });

  it('deletes on incoming deleted=true with newer event', async () => {
    const db = getDb(env.DB);
    await upsertTaxId(db, txi(), 100);
    await upsertTaxId(db, { id: 'txi_1', object: 'tax_id', deleted: true } as Stripe.DeletedTaxId, 200);
    const row = await db.select().from(taxIds).where(eq(taxIds.id, 'txi_1')).get();
    expect(row).toBeUndefined();
  });
});
