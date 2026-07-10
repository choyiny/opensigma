import { and, eq, ne, sql } from 'drizzle-orm';
import type { Env, AccountListableResource, PerParentResource } from '../env';
import { getDb } from '../db/client';
import { backloadState, backloadParentProgress } from '../db/schema';
import { ACCOUNT_RESOURCES, PER_PARENT_RESOURCES } from './registry';

const CHILD_PAGE_BATCH_CAP = 500;

export const scheduledHandler: ExportedHandlerScheduledHandler<Env> = async (_ctrl, env, _ctx) => {
  const db = getDb(env.DB);

  // 0) Enqueue the incremental event-polling backstop. Runs every cron tick,
  //    independent of object-backload progress.
  await env.BACKLOAD_QUEUE.send({ kind: 'events' });

  // 1) Enqueue page jobs for account-listable resources still in progress.
  const accountRows = await db
    .select({ resource: backloadState.resource, cursor: backloadState.cursor })
    .from(backloadState)
    .where(ne(backloadState.status, 'done'));

  for (const row of accountRows) {
    if (row.resource in ACCOUNT_RESOURCES) {
      await env.BACKLOAD_QUEUE.send({
        kind: 'page',
        resource: row.resource as AccountListableResource,
        cursor: row.cursor ?? null,
      });
    }
  }

  // 2) Enqueue child-page jobs for any idle per-parent rows.
  for (const resource of Object.keys(PER_PARENT_RESOURCES) as PerParentResource[]) {
    const idle = await db
      .select({ parentId: backloadParentProgress.parentId, cursor: backloadParentProgress.cursor })
      .from(backloadParentProgress)
      .where(and(
        eq(backloadParentProgress.resource, resource),
        eq(backloadParentProgress.status, 'idle'),
      ))
      .limit(CHILD_PAGE_BATCH_CAP);

    for (const row of idle) {
      await env.BACKLOAD_QUEUE.send({
        kind: 'child-page',
        resource,
        parent_id: row.parentId,
        cursor: row.cursor ?? null,
      });
    }
  }

  // 3) Flip per-parent resources to `done` when all parents are done AND
  //    the parent resource is itself `done`.
  for (const resource of Object.keys(PER_PARENT_RESOURCES) as PerParentResource[]) {
    const binding = PER_PARENT_RESOURCES[resource];
    const parentState = await db.select().from(backloadState)
      .where(eq(backloadState.resource, binding.parentResource)).get();
    if (parentState?.status !== 'done') continue;

    const remaining = await db.select({ n: sql<number>`count(*)` })
      .from(backloadParentProgress)
      .where(and(
        eq(backloadParentProgress.resource, resource),
        ne(backloadParentProgress.status, 'done'),
      ))
      .get();
    if ((remaining?.n ?? 0) === 0) {
      await db.update(backloadState)
        .set({ status: 'done', cursor: null, updatedAt: Date.now(), lastSyncedAt: Date.now() })
        .where(eq(backloadState.resource, resource));
    }
  }
};
