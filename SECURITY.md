# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's
**[Security Advisories](https://github.com/choyiny/opensigma/security/advisories/new)**
("Report a vulnerability"). We'll acknowledge the report, investigate, and coordinate a fix and
disclosure with you.

## Scope

opensigma is a single Cloudflare Worker holding two secrets — a Stripe restricted API key
(`STRIPE_API_KEY`) and a webhook signing secret (`STRIPE_WEBHOOK_SECRET`) — and writing to a D1
database that mirrors your Stripe account.

The surfaces most worth attacking, in order:

- **Webhook signature verification.** `POST /webhooks/stripe` is the only public route; everything
  else falls through to a 404. The route verifies every request with
  `stripe.webhooks.constructEventAsync` against `STRIPE_WEBHOOK_SECRET` and rejects unsigned or
  badly-signed bodies with a 400 before touching the database. Any way to get an unverified payload
  past that check — and therefore write attacker-controlled rows into D1 — is the highest-severity
  bug in this project. Reports here are especially welcome.
- **The `last_event_at` ordering guard.** Rows carry a timestamp so out-of-order deliveries are
  dropped rather than overwriting newer data. A way to force stale data to win, or to corrupt a
  row's guard so future legitimate updates are rejected, is a real bug.
- **Secret handling.** Both secrets are Worker secrets and should never reach logs. The handler logs
  event type and id on failure, never request bodies or key material. Report any path that leaks
  either secret, or a Stripe object's sensitive fields, into logs or a response.
- **The synced data itself.** The database contains customer PII and payment metadata. Access
  control is your Cloudflare account — opensigma exposes no read API of its own. A route or binding
  that exposes synced rows unauthenticated would be a vulnerability.

### Out of scope

- The restricted API key is **read-only by design** (see the setup instructions in the README).
  A compromised Worker cannot move money, issue refunds, or mutate your Stripe account. Reports
  that assume a read-write key are out of scope — but reports of the project *needing* write scope
  anywhere are very much in scope.
- Cloudflare platform vulnerabilities — report those to
  [Cloudflare](https://www.cloudflare.com/disclosure/).
- Stripe API vulnerabilities — report those to [Stripe](https://stripe.com/docs/security).

## Supported versions

This is a rolling project — fixes land on `main`. There are no separately-maintained releases.
