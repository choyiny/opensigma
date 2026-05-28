import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import type { Env, BackloadJob, AccountListableResource, PerParentResource } from '../env';
import { getDb, type DB } from '../db/client';
import { backloadState, backloadParentProgress } from '../db/schema';
import { getStripe } from '../stripe';
import { ACCOUNT_RESOURCES, PER_PARENT_RESOURCES } from './registry';

export async function processBackloadMessage(
  env: Env,
  job: BackloadJob,
  stripeOverride?: Stripe,
): Promise<void> {
  const db = getDb(env.DB);
  const stripe = stripeOverride ?? getStripe(env.STRIPE_API_KEY);
  if (job.kind === 'page') {
    await processAccountPage(db, env, stripe, job.resource, job.cursor);
  } else {
    await processChildPage(db, stripe, job.resource, job.parent_id, job.cursor, env);
  }
}

async function processAccountPage(
  db: DB,
  env: Env,
  stripe: Stripe,
  resource: AccountListableResource,
  cursor: string | null,
): Promise<void> {
  const state = await db.select().from(backloadState).where(eq(backloadState.resource, resource)).get();
  if (!state || state.status === 'done') return;

  const binding = ACCOUNT_RESOURCES[resource];
  if (!binding) throw new Error(`No registry entry for account resource ${resource}`);

  await db.update(backloadState)
    .set({ status: 'in_progress', updatedAt: Date.now() })
    .where(eq(backloadState.resource, resource));

  console.log(`[backload] endpoint=${resource} page=${cursor ?? 'first'}`);
  const page = await binding.list(stripe, cursor);
  for (const obj of page.data) {
    await binding.upsert(db, obj, obj.created, stripe);
    if (binding.onObject) await binding.onObject(db, obj, stripe);
  }

  if (page.has_more) {
    const lastId = page.data[page.data.length - 1]?.id ?? cursor;
    await db.update(backloadState)
      .set({ cursor: lastId, status: 'idle', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, resource));
    await env.BACKLOAD_QUEUE.send({ kind: 'page', resource, cursor: lastId });
  } else {
    await db.update(backloadState)
      .set({ cursor: null, status: 'done', updatedAt: Date.now(), lastSyncedAt: Date.now() })
      .where(eq(backloadState.resource, resource));
  }
}

async function processChildPage(
  db: DB,
  stripe: Stripe,
  resource: PerParentResource,
  parentId: string,
  cursor: string | null,
  env: Env,
): Promise<void> {
  const row = await db.select().from(backloadParentProgress)
    .where(and(eq(backloadParentProgress.resource, resource), eq(backloadParentProgress.parentId, parentId)))
    .get();
  if (!row || row.status === 'done') return;

  const binding = PER_PARENT_RESOURCES[resource];
  if (!binding) throw new Error(`No registry entry for per-parent resource ${resource}`);

  await db.update(backloadParentProgress)
    .set({ status: 'in_progress', updatedAt: Date.now() })
    .where(and(eq(backloadParentProgress.resource, resource), eq(backloadParentProgress.parentId, parentId)));
  await db.update(backloadState)
    .set({ status: 'in_progress', updatedAt: Date.now() })
    .where(and(eq(backloadState.resource, resource), eq(backloadState.status, 'idle')));

  let page: { data: any[]; has_more: boolean };
  try {
    console.log(`[backload] endpoint=${resource} parent=${parentId} page=${cursor ?? 'first'}`);
    page = await binding.list(stripe, parentId, cursor);
  } catch (err: any) {
    // Parent gone — close out without DLQ noise.
    if (err?.statusCode === 404 || err?.code === 'resource_missing') {
      await db.update(backloadParentProgress)
        .set({ status: 'done', cursor: null, updatedAt: Date.now() })
        .where(and(eq(backloadParentProgress.resource, resource), eq(backloadParentProgress.parentId, parentId)));
      return;
    }
    throw err;
  }

  for (const obj of page.data) {
    await binding.upsert(db, obj, obj.created ?? Math.floor(Date.now() / 1000), stripe);
  }

  if (page.has_more) {
    const lastId = page.data[page.data.length - 1]?.id ?? cursor;
    await db.update(backloadParentProgress)
      .set({ cursor: lastId, status: 'in_progress', updatedAt: Date.now() })
      .where(and(eq(backloadParentProgress.resource, resource), eq(backloadParentProgress.parentId, parentId)));
    await env.BACKLOAD_QUEUE.send({ kind: 'child-page', resource, parent_id: parentId, cursor: lastId });
  } else {
    await db.update(backloadParentProgress)
      .set({ cursor: null, status: 'done', updatedAt: Date.now() })
      .where(and(eq(backloadParentProgress.resource, resource), eq(backloadParentProgress.parentId, parentId)));
  }
}

export const queueHandler: ExportedHandlerQueueHandler<Env, BackloadJob> = async (batch, env) => {
  for (const msg of batch.messages) {
    try {
      await processBackloadMessage(env, msg.body);
      msg.ack();
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: 'backload_failed', job: msg.body, err: String(err) }));
      msg.retry();
    }
  }
};
