---
name: Bug report
about: Something isn't working as expected
title: ""
labels: bug
---

**What happened**

<!-- A clear description of the bug. -->

**Which path**

<!-- Which side of the sync? Delete what doesn't apply. -->

- [ ] Webhook (`POST /webhooks/stripe`)
- [ ] Cron / backload (`scheduled()` → queue → consumer)
- [ ] Querying the synced data
- [ ] Setup / migrations

**Steps to reproduce**

1.
2.
3.

**Expected**

<!-- What you expected to happen. -->

**Affected resource / table**

<!-- e.g. `invoices`, `charges`, `subscription_items` — and the Stripe event type if relevant. -->

**Logs**

<!-- Relevant `wrangler tail` output. PLEASE REDACT: never paste API keys, webhook signing
     secrets, customer PII, or full Stripe object bodies. Event type and id are usually enough. -->

**Environment**

- wrangler version:
- Node version:
- Stripe mode: test / live
