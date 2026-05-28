// test/webhooks/handler.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../src/db/client';
import { stripeEvents, customers } from '../../src/db/schema';

const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

async function signStripeBody(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const sig = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${sig}`;
}

function makeEvent(overrides: Partial<any> = {}) {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    api_version: '2024-10-28.acacia',
    type: 'customer.created',
    created: 1700000100,
    data: {
      object: {
        id: 'cus_test_1',
        object: 'customer',
        email: 'a@example.com',
        created: 1700000000,
        livemode: false,
        metadata: {},
      },
    },
    ...overrides,
  });
}

describe('POST /webhooks/stripe', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(stripeEvents);
    await db.delete(customers);
  });

  it('400 on invalid signature', async () => {
    const res = await SELF.fetch('https://x/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'bogus', 'content-type': 'application/json' },
      body: makeEvent(),
    });
    expect(res.status).toBe(400);
  });

  it('writes stripe_events and dispatches to upsert on valid signature', async () => {
    const body = makeEvent();
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    const res = await SELF.fetch('https://x/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_test_1')).get())?.type).toBe('customer.created');
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get())?.email).toBe('a@example.com');
  });

  it('200 with no second write on duplicate event id', async () => {
    const body = makeEvent();
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    // Mutate customer email in DB to detect re-dispatch
    const db = getDb(env.DB);
    await db.update(customers).set({ email: 'untouched@example.com' }).where(eq(customers.id, 'cus_test_1'));
    const res = await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);
    expect((await db.select().from(customers).where(eq(customers.id, 'cus_test_1')).get())?.email).toBe('untouched@example.com');
  });

  it('200 and logs unknown event types without dispatching', async () => {
    const body = makeEvent({ id: 'evt_unknown_1', type: 'totally.unknown' });
    const sig = await signStripeBody(body, WEBHOOK_SECRET);
    const res = await SELF.fetch('https://x/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);
    const db = getDb(env.DB);
    expect((await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_unknown_1')).get())?.type).toBe('totally.unknown');
  });
});
