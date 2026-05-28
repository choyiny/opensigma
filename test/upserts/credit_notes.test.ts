import type Stripe from 'stripe';
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { creditNotes, creditNoteLineItems } from '../../src/db/schema';
import { upsertCreditNote, upsertCreditNoteLines } from '../../src/upserts/credit_notes';

const cn = (overrides: Partial<any> = {}): Stripe.CreditNote => ({
  id: 'cn_test_1',
  object: 'credit_note',
  amount: 500,
  created: 1700000000,
  currency: 'usd',
  customer: 'cus_1',
  invoice: 'in_1',
  livemode: false,
  metadata: {},
  status: 'issued',
  total: 500,
  type: 'pre_payment',
  ...overrides,
}) as unknown as Stripe.CreditNote;

const fakeStripe = (lines: any[]): Stripe => ({
  creditNotes: { listLines: () => Promise.resolve({ data: lines, has_more: false }) },
} as any);

describe('credit_notes', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(creditNotes);
    await db.delete(creditNoteLineItems);
  });

  it('inserts parent', async () => {
    const db = getDb(env.DB);
    await upsertCreditNote(db, cn(), 1700000100);
    const row = await db.select().from(creditNotes).where(eq(creditNotes.id, 'cn_test_1')).get();
    expect(row?.status).toBe('issued');
  });

  it('updates parent on newer', async () => {
    const db = getDb(env.DB);
    await upsertCreditNote(db, cn({ status: 'issued' }), 100);
    await upsertCreditNote(db, cn({ status: 'void' }), 200);
    const row = await db.select().from(creditNotes).where(eq(creditNotes.id, 'cn_test_1')).get();
    expect(row?.status).toBe('void');
  });

  it('upserts lines from Stripe API', async () => {
    const db = getDb(env.DB);
    const stripe = fakeStripe([
      { id: 'cnli_1', object: 'credit_note_line_item', amount: 100, livemode: false, type: 'invoice_line_item' },
      { id: 'cnli_2', object: 'credit_note_line_item', amount: 400, livemode: false, type: 'custom_line_item' },
    ]);
    await upsertCreditNoteLines(stripe, db, 'cn_test_1', 1700000100);
    const lines = await db.select().from(creditNoteLineItems).where(eq(creditNoteLineItems.creditNote, 'cn_test_1'));
    expect(lines.length).toBe(2);
  });
});
