import { Hono } from 'hono';
import type { Env } from './env';

export const app = new Hono<{ Bindings: Env }>();

// Webhook route is registered in src/webhooks/handler.ts via app.post(...)
// All other paths fall through to the default 404 handler.
