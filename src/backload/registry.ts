import type Stripe from 'stripe';
import type { DB } from '../db/client';
import type { AccountListableResource, PerParentResource } from '../env';

export interface AccountListBinding {
  list: (stripe: Stripe, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
  /**
   * Optional hook fired for every object on the page during backload.
   * Used by parents (customers, invoices, credit_notes, checkout_sessions)
   * to seed backload_parent_progress rows for their child resources.
   */
  onObject?: (db: DB, obj: any) => Promise<void>;
}

export interface ChildListBinding {
  /** Identifier of the parent resource whose backload must finish before
   *  this child resource can flip to `done`. */
  parentResource: AccountListableResource;
  list: (stripe: Stripe, parentId: string, cursor: string | null) => Promise<{ data: any[]; has_more: boolean }>;
  upsert: (db: DB, obj: any, ts: number) => Promise<void>;
}

export const ACCOUNT_RESOURCES = {} as Record<AccountListableResource, AccountListBinding>;
export const PER_PARENT_RESOURCES = {} as Record<PerParentResource, ChildListBinding>;
