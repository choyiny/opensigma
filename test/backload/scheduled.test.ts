// test/backload/scheduled.test.ts
import { env, createScheduledController } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client';
import { backloadState, backloadParentProgress } from '../../src/db/schema';
import { scheduledHandler } from '../../src/backload/scheduled';

describe('scheduled handler', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
    await db.delete(backloadParentProgress);
    const now = Date.now();
    await db.insert(backloadState).values([
      { resource: 'customers', cursor: null, status: 'idle', updatedAt: now },
      { resource: 'products', cursor: null, status: 'done', updatedAt: now },
      { resource: 'prices', cursor: 'price_abc', status: 'idle', updatedAt: now },
    ]);
  });

  it('enqueues a job for each non-done resource', async () => {
    const sent: any[] = [];
    const fakeEnv = {
      ...env,
      BACKLOAD_QUEUE: { send: async (msg: unknown) => sent.push(msg) } as any,
    };
    await scheduledHandler(createScheduledController(), fakeEnv as any, {} as any);
    expect(sent).toEqual([
      { kind: 'events' },
      { kind: 'page', resource: 'customers', cursor: null },
      { kind: 'page', resource: 'prices', cursor: 'price_abc' },
    ]);
  });

  it('forwards the stored cursor when enqueuing child-page jobs for idle per-parent rows', async () => {
    const db = getDb(env.DB);
    const now = Date.now();
    await db.insert(backloadParentProgress).values([
      // Seeded by an inline-expand parent that had has_more=true; resume after the last embedded line.
      { resource: 'invoice_line_items', parentId: 'in_with_cursor', cursor: 'il_last', status: 'idle', updatedAt: now },
      // Seeded the legacy way with no cursor.
      { resource: 'invoice_line_items', parentId: 'in_no_cursor', cursor: null, status: 'idle', updatedAt: now },
    ]);
    const sent: any[] = [];
    const fakeEnv = {
      ...env,
      BACKLOAD_QUEUE: { send: async (msg: unknown) => sent.push(msg) } as any,
    };
    await scheduledHandler(createScheduledController(), fakeEnv as any, {} as any);

    const childJobs = sent.filter((m: any) => m.kind === 'child-page' && m.resource === 'invoice_line_items');
    expect(childJobs).toEqual(expect.arrayContaining([
      { kind: 'child-page', resource: 'invoice_line_items', parent_id: 'in_with_cursor', cursor: 'il_last' },
      { kind: 'child-page', resource: 'invoice_line_items', parent_id: 'in_no_cursor', cursor: null },
    ]));
    expect(childJobs).toHaveLength(2);
  });
});
