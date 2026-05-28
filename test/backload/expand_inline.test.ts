import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import {
  backloadParentProgress,
  checkoutSessionLineItems,
  invoiceLineItems,
  creditNoteLineItems,
  taxIds,
} from '../../src/db/schema';
import { ACCOUNT_RESOURCES } from '../../src/backload/registry';
import type Stripe from 'stripe';

const noopStripe = {} as Stripe;

describe('inline-expanded line items via onObject', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadParentProgress);
    await db.delete(checkoutSessionLineItems);
    await db.delete(invoiceLineItems);
    await db.delete(creditNoteLineItems);
    await db.delete(taxIds);
  });

  describe('checkout_sessions', () => {
    const session = (lines: any) => ({
      id: 'cs_1',
      object: 'checkout.session',
      created: 100,
      livemode: false,
      mode: 'payment',
      status: 'complete',
      line_items: lines,
    });

    it('upserts inline line_items and does NOT seed parent progress when has_more=false', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.checkout_sessions.onObject!;
      await onObject(db, session({
        object: 'list',
        has_more: false,
        data: [
          { id: 'li_a', object: 'item', amount_total: 100, currency: 'usd', quantity: 1 },
          { id: 'li_b', object: 'item', amount_total: 200, currency: 'usd', quantity: 2 },
        ],
      }) as any, noopStripe);

      const lines = await db.select().from(checkoutSessionLineItems);
      expect(lines.map((l) => l.id).sort()).toEqual(['li_a', 'li_b']);
      expect(lines[0]?.checkoutSession).toBe('cs_1');

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'checkout_session_line_items'),
                   eq(backloadParentProgress.parentId, 'cs_1'))).get();
      expect(progress).toBeUndefined();
    });

    it('upserts inline line_items AND seeds parent progress with cursor=lastId when has_more=true', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.checkout_sessions.onObject!;
      await onObject(db, session({
        object: 'list',
        has_more: true,
        data: [
          { id: 'li_a', object: 'item', amount_total: 100, currency: 'usd', quantity: 1 },
          { id: 'li_b', object: 'item', amount_total: 200, currency: 'usd', quantity: 2 },
        ],
      }) as any, noopStripe);

      expect((await db.select().from(checkoutSessionLineItems)).length).toBe(2);

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'checkout_session_line_items'),
                   eq(backloadParentProgress.parentId, 'cs_1'))).get();
      expect(progress?.cursor).toBe('li_b');
      expect(progress?.status).toBe('idle');
    });

    it('seeds an idle row with no cursor when line_items is missing entirely (fallback)', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.checkout_sessions.onObject!;
      await onObject(db, { id: 'cs_2', object: 'checkout.session', created: 1, livemode: false } as any, noopStripe);

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'checkout_session_line_items'),
                   eq(backloadParentProgress.parentId, 'cs_2'))).get();
      expect(progress?.cursor).toBeNull();
      expect(progress?.status).toBe('idle');
    });
  });

  describe('invoices', () => {
    const invoice = (lines: any) => ({
      id: 'in_1',
      object: 'invoice',
      created: 100,
      livemode: false,
      currency: 'usd',
      amount_due: 100,
      attempted: false,
      auto_advance: false,
      attempt_count: 0,
      lines,
    });

    it('upserts inline lines and does NOT seed parent progress when has_more=false', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.invoices.onObject!;
      await onObject(db, invoice({
        object: 'list',
        has_more: false,
        data: [
          { id: 'il_a', object: 'line_item', amount: 50, currency: 'usd', discountable: true, livemode: false, subtotal: 50 },
        ],
      }) as any, noopStripe);

      const lines = await db.select().from(invoiceLineItems);
      expect(lines.map((l) => l.id)).toEqual(['il_a']);
      expect(lines[0]?.invoice).toBe('in_1');

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'invoice_line_items'),
                   eq(backloadParentProgress.parentId, 'in_1'))).get();
      expect(progress).toBeUndefined();
    });

    it('upserts inline lines AND seeds parent progress with cursor=lastId when has_more=true', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.invoices.onObject!;
      await onObject(db, invoice({
        object: 'list',
        has_more: true,
        data: [
          { id: 'il_a', object: 'line_item', amount: 50, currency: 'usd', discountable: true, livemode: false, subtotal: 50 },
          { id: 'il_b', object: 'line_item', amount: 75, currency: 'usd', discountable: true, livemode: false, subtotal: 75 },
        ],
      }) as any, noopStripe);

      expect((await db.select().from(invoiceLineItems)).length).toBe(2);

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'invoice_line_items'),
                   eq(backloadParentProgress.parentId, 'in_1'))).get();
      expect(progress?.cursor).toBe('il_b');
      expect(progress?.status).toBe('idle');
    });
  });

  describe('credit_notes', () => {
    const note = (lines: any) => ({
      id: 'cn_1',
      object: 'credit_note',
      created: 100,
      livemode: false,
      currency: 'usd',
      amount: 100,
      subtotal: 100,
      total: 100,
      status: 'issued',
      type: 'pre_payment',
      lines,
    });

    it('upserts inline lines and does NOT seed parent progress when has_more=false', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.credit_notes.onObject!;
      await onObject(db, note({
        object: 'list',
        has_more: false,
        data: [
          { id: 'cnli_a', object: 'credit_note_line_item', amount: 50, livemode: false, type: 'invoice_line_item' },
        ],
      }) as any, noopStripe);

      const lines = await db.select().from(creditNoteLineItems);
      expect(lines.map((l) => l.id)).toEqual(['cnli_a']);
      expect(lines[0]?.creditNote).toBe('cn_1');

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'credit_note_line_items'),
                   eq(backloadParentProgress.parentId, 'cn_1'))).get();
      expect(progress).toBeUndefined();
    });

    it('upserts inline lines AND seeds parent progress with cursor=lastId when has_more=true', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.credit_notes.onObject!;
      await onObject(db, note({
        object: 'list',
        has_more: true,
        data: [
          { id: 'cnli_a', object: 'credit_note_line_item', amount: 50, livemode: false, type: 'invoice_line_item' },
          { id: 'cnli_b', object: 'credit_note_line_item', amount: 25, livemode: false, type: 'invoice_line_item' },
        ],
      }) as any, noopStripe);

      expect((await db.select().from(creditNoteLineItems)).length).toBe(2);

      const progress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'credit_note_line_items'),
                   eq(backloadParentProgress.parentId, 'cn_1'))).get();
      expect(progress?.cursor).toBe('cnli_b');
      expect(progress?.status).toBe('idle');
    });
  });

  describe('customers', () => {
    const customer = (tax_ids: any) => ({
      id: 'cus_1',
      object: 'customer',
      created: 100,
      livemode: false,
      metadata: {},
      tax_ids,
    });

    it('upserts inline tax_ids and does NOT seed tax_ids parent progress when has_more=false', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.customers.onObject!;
      await onObject(db, customer({
        object: 'list',
        has_more: false,
        data: [
          { id: 'txi_a', object: 'tax_id', country: 'US', created: 1, customer: 'cus_1', livemode: false, type: 'us_ein', value: '12-3' },
          { id: 'txi_b', object: 'tax_id', country: 'CA', created: 2, customer: 'cus_1', livemode: false, type: 'ca_gst_hst', value: '99' },
        ],
      }) as any, noopStripe);

      const rows = await db.select().from(taxIds);
      expect(rows.map((r) => r.id).sort()).toEqual(['txi_a', 'txi_b']);
      expect(rows[0]?.customer).toBe('cus_1');

      const taxProgress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'tax_ids'),
                   eq(backloadParentProgress.parentId, 'cus_1'))).get();
      expect(taxProgress).toBeUndefined();

      // payment_methods is unchanged — still seeded for every customer.
      const pmProgress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'payment_methods'),
                   eq(backloadParentProgress.parentId, 'cus_1'))).get();
      expect(pmProgress?.status).toBe('idle');
    });

    it('upserts inline tax_ids AND seeds tax_ids parent progress with cursor=lastId when has_more=true', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.customers.onObject!;
      await onObject(db, customer({
        object: 'list',
        has_more: true,
        data: [
          { id: 'txi_a', object: 'tax_id', country: 'US', created: 1, customer: 'cus_1', livemode: false, type: 'us_ein', value: '12-3' },
          { id: 'txi_b', object: 'tax_id', country: 'CA', created: 2, customer: 'cus_1', livemode: false, type: 'ca_gst_hst', value: '99' },
        ],
      }) as any, noopStripe);

      expect((await db.select().from(taxIds)).length).toBe(2);

      const taxProgress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'tax_ids'),
                   eq(backloadParentProgress.parentId, 'cus_1'))).get();
      expect(taxProgress?.cursor).toBe('txi_b');
      expect(taxProgress?.status).toBe('idle');
    });

    it('falls back to seeding tax_ids with no cursor when tax_ids field is missing entirely', async () => {
      const db = getDb(env.DB);
      const onObject = ACCOUNT_RESOURCES.customers.onObject!;
      await onObject(db, { id: 'cus_2', object: 'customer', created: 1, livemode: false, metadata: {} } as any, noopStripe);

      const taxProgress = await db.select().from(backloadParentProgress)
        .where(and(eq(backloadParentProgress.resource, 'tax_ids'),
                   eq(backloadParentProgress.parentId, 'cus_2'))).get();
      expect(taxProgress?.cursor).toBeNull();
      expect(taxProgress?.status).toBe('idle');
    });
  });
});
