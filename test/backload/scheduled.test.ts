// test/backload/scheduled.test.ts
import { env, createScheduledController } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client';
import { backloadState } from '../../src/db/schema';
import { scheduledHandler } from '../../src/backload/scheduled';

describe('scheduled handler', () => {
  beforeEach(async () => {
    const db = getDb(env.DB);
    await db.delete(backloadState);
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
      { resource: 'customers', cursor: null },
      { resource: 'prices', cursor: 'price_abc' },
    ]);
  });
});
